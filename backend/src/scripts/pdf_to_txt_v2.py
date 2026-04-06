#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_to_txt_v2.py
================
Conversor PDF → TXT  —  Formato 2: Banca Remota BANDEC (exportado desde navegador)

Características de este formato:
  - PDF generado con "Imprimir/Guardar" desde el browser (Chrome/Firefox)
  - Cada página tiene header con timestamp:  "19/2/26, 2:54 p.m. Banca Remota - BANDEC"
  - Cada página tiene footer URL:            "https://www.bandec.cu/... N/129"
  - Fecha de transacción: dd/mm/yyyy con ceros (ej. 05/01/2026)
  - Las líneas de transacción están limpias en una sola línea principal
  - Las líneas de continuación NO tienen indentación propia — se detectan
    porque no comienzan con una fecha dd/mm/yyyy
  - Tipo al final de línea: "Cr" / "Db" (mixedcase)
  - Prefijos nuevos: KW (formato extendido), C6, H1

Salida compatible con god_extractor_v2.py
"""

import sys
import io
import re
import pdfplumber
from io import StringIO

# Forzar UTF-8 en stdout de forma segura (funciona tanto en consola como en pipe)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
elif hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ─── Ancho de columnas del TXT de salida ─────────────────────────────────────
COL_FECHA    = 0
COL_REF_CORR = 11
COL_REF_ORIG = 27
COL_OBS      = 46
COL_IMPORTE  = 83

def pad_right(s, width): s = str(s); return s[:width].ljust(width)
def rpad(s, width):      s = str(s); return s[:width].rjust(width)

# ─── Patrones de detección ────────────────────────────────────────────────────
# Línea de transacción: empieza con fecha dd/mm/yyyy
TX_RE = re.compile(
    r'^(\d{2}/\d{2}/\d{4})\s+'          # fecha dd/mm/yyyy (con ceros)
    r'([A-Z0-9]{6,})\s+'                 # ref_corriente
    r'([A-Z0-9]{3,})\s+'                 # ref_origen (H1412 puede ser corto)
    r'(.+?)\s+'                          # observación principal
    r'([\d,]+\.\d{2})\s+'               # importe
    r'(Cr|Db)\s*$',                      # tipo
    re.IGNORECASE
)

# Línea que empieza nueva transacción (fecha dd/mm/yyyy)
FECHA_RE = re.compile(r'^\d{2}/\d{2}/\d{4}\s')

# Líneas a descartar (header/footer del navegador)
SKIP_RE = re.compile(
    r'^\d{1,2}/\d{1,2}/\d{2,4},\s*\d'  # timestamp browser: "19/2/26, 2:54"
    r'|^https?://'                       # URLs
    r'|^Banca Remota\s*-\s*BANDEC\s*$', # título
    re.IGNORECASE
)


def _detect_ref_origen_x(page):
    """Detecta la posición X de inicio de la columna Ref_Origen desde el encabezado."""
    try:
        words = page.extract_words(x_tolerance=5, y_tolerance=3)
        for w in words:
            if re.match(r'Ref\.?_?Origen', w['text'], re.IGNORECASE):
                return w['x0']
    except Exception:
        pass
    return 120.0   # valor por defecto para BANDEC


def extract_raw_lines(pdf_path):
    """Extrae líneas del PDF agrupando caracteres en 'runs' por proximidad.

    Problema raíz: las columnas Ref_Corriente y Ref_Origen del PDF BANDEC se
    superponen o tocan físicamente. Casos observados:
      A) gap negativo (−8pt a −0.1pt): Ref_Corriente termina después de donde
         Ref_Origen empieza — overlap real.
      B) gap positivo pequeño (0.008pt a 0.90pt): columnas casi tocándose.
      C) gap = 0.0000 exacto: última letra de Ref_Corriente termina en x=120.00
         y primera de Ref_Origen empieza en x=120.00, sin separación ninguna.

    Solución — "runs" en orden del content stream con dos condiciones de corte:

    1. abs(gap) > 0.001 pt → cualquier separación real (captura casos A y B).
       Los chars del MISMO elemento de texto siempre tienen gap = 0.000000
       exacto (no hay kerning en este PDF); entre columnas el gap ≠ 0.

    2. Corte de columna forzado (caso C, gap=0 exacto):
       Si el char actual empieza en el límite exacto de Ref_Origen (x ≈ 120pt)
       Y el run en curso empezó del lado de Ref_Corriente (x < 120pt),
       forzamos un corte de run aunque el gap sea cero.

    Ambas condiciones trabajan en orden del content stream, donde todos los
    chars de Ref_Corriente vienen ANTES que los de Ref_Origen.
    """
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            chars = page.chars
            if not chars:
                continue

            ref_orig_x = _detect_ref_origen_x(page)

            # Agrupar caracteres por fila (tolerancia vertical ±4pt).
            # Dentro de cada fila se conserva el orden del content stream.
            rows = {}
            for c in chars:
                y_key = round(c['top'] / 4) * 4
                if y_key not in rows:
                    rows[y_key] = []
                rows[y_key].append(c)

            for y_key in sorted(rows.keys()):
                row_chars = rows[y_key]   # orden content stream — NO sort por x0

                # Construir runs
                runs = []
                cur_text = ''
                cur_x1 = None
                cur_start_x = None   # x0 del primer char del run actual

                for c in row_chars:
                    if cur_x1 is not None:
                        gap = c['x0'] - cur_x1

                        # Condición 1: gap real (casos A y B)
                        gap_break = abs(gap) > 0.001

                        # Condición 2: corte forzado en frontera de columna
                        # (caso C, gap=0 exacto entre Ref_Corriente y Ref_Origen)
                        col_break = (
                            abs(c['x0'] - ref_orig_x) < 0.01  # char empieza justo en la frontera
                            and cur_start_x is not None
                            and cur_start_x < ref_orig_x       # run empezó en zona Ref_Corriente
                        )

                        if gap_break or col_break:
                            runs.append(cur_text)
                            cur_text = ''
                            cur_start_x = c['x0']

                    if cur_start_x is None:
                        cur_start_x = c['x0']

                    cur_text += c['text']
                    cur_x1 = c['x1']

                if cur_text:
                    runs.append(cur_text)

                # Unir runs con espacio; descartar runs vacíos o solo espacios
                line = ' '.join(r for r in runs if r.strip()).strip()
                if line and not SKIP_RE.match(line):
                    lines.append(line)
    return lines


def parse_header(lines):
    """Extrae metadatos del encabezado (primeras ~15 líneas)."""
    info = {}
    for line in lines[:20]:
        if line.startswith('Titular:'):
            info['titular'] = line.replace('Titular:', '').strip()
        elif not info.get('titular'):
            # Formato alternativo: "... CI:89120323694 LISANDRA DE LA FLOR ALONSO ..."
            m_ci = re.search(r'CI:\s*\d{11}\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{5,}?)(?:\s+Fecha|\s*$)', line, re.IGNORECASE)
            if m_ci:
                info['titular'] = m_ci.group(1).strip()
        if 'Sucursal y Cuenta:' in line:
            info['sucursal'] = line
        elif re.match(r'Fecha de Emisi[oó]n:', line, re.IGNORECASE):
            info['fecha_emision'] = re.sub(r'Fecha de Emisi[oó]n:\s*','',line,flags=re.IGNORECASE).strip()
        elif 'Rango de Fecha:' in line or 'Período:' in line:
            info['rango'] = line
            m = re.search(r'del?\s+(\d{2}/\d{2}/\d{4})\s+al\s+(\d{2}/\d{2}/\d{4})', line)
            if m:
                info['fecha_inicio'] = m.group(1)
                info['fecha_fin']    = m.group(2)
        elif 'Cantidad de Movimientos:' in line:
            info['movimientos'] = line
    return info


def group_transactions(lines):
    """
    Agrupa las líneas en transacciones.
    Nueva transacción = línea que matchea TX_RE.
    Continuación     = cualquier línea que no empiece con fecha dd/mm/yyyy.
    """
    transactions = []
    current = None

    for line in lines:
        m = TX_RE.match(line)
        if m:
            if current:
                transactions.append(current)
            current = {
                'fecha':      m.group(1),
                'ref_corr':   m.group(2),
                'ref_orig':   m.group(3),
                'obs_first':  m.group(4).strip(),
                'importe':    m.group(5).replace(',', ''),
                'tipo':       m.group(6),
                'cont_lines': [],
            }
        elif current is not None and not FECHA_RE.match(line):
            current['cont_lines'].append(line)

    if current:
        transactions.append(current)
    return transactions


def format_tx(tx):
    out = StringIO()
    line  = pad_right(tx['fecha'],     COL_REF_CORR - COL_FECHA)
    line += pad_right(tx['ref_corr'],  COL_REF_ORIG - COL_REF_CORR)
    line += pad_right(tx['ref_orig'],  COL_OBS      - COL_REF_ORIG)
    line += pad_right(tx['obs_first'], COL_IMPORTE  - COL_OBS)
    line += rpad(f'{float(tx["importe"]):.2f}', 12)
    line += '   ' + tx['tipo']
    out.write(line.rstrip() + '\n')
    indent = ' ' * COL_OBS
    for cl in tx['cont_lines']:
        out.write(indent + cl + '\n')
    return out.getvalue()


def generate_txt(header_info, transactions, saldo_anterior=''):
    out = StringIO()
    cr = sum(1 for t in transactions if t['tipo'].upper() == 'CR')
    db = sum(1 for t in transactions if t['tipo'].upper() == 'DB')

    out.write('Estados de Cuenta\n')
    out.write(f"Titular: {header_info.get('titular','')}\n")
    if 'sucursal' in header_info: out.write(header_info['sucursal'] + '\n')
    if 'fecha_emision' in header_info: out.write(f"Fecha de Emisión: {header_info['fecha_emision']}\n")
    if 'rango' in header_info: out.write(header_info['rango'] + '\n')
    out.write(f"Cantidad de Movimientos: {len(transactions)} (CR:{cr} DB:{db})\n\n\n")

    hdr  = pad_right('Fecha',         COL_REF_CORR)
    hdr += pad_right('Ref_Corriente', COL_REF_ORIG - COL_REF_CORR)
    hdr += pad_right('Ref_Origen',    COL_OBS      - COL_REF_ORIG)
    hdr += pad_right('Observaciones', COL_IMPORTE  - COL_OBS)
    hdr += pad_right('Importe', 10) + ' Tipo'
    out.write(' ' + hdr.rstrip() + '\n\n')

    indent = ' ' * COL_OBS
    if saldo_anterior:
        sa  = indent + pad_right('Saldo Contable Anterior:', COL_IMPORTE - COL_OBS)
        sa += rpad(saldo_anterior, 12) + '   Cr'
        out.write(sa.rstrip() + '\n\n')

    for tx in transactions:
        out.write(format_tx(tx))
        out.write('\n')

    return out.getvalue()


def convert(pdf_path):
    raw_lines   = extract_raw_lines(pdf_path)
    header_info = parse_header(raw_lines)

    saldo_anterior = ''
    for line in raw_lines:
        m = re.match(r'Saldo\s+Contable\s+Anterior:\s*([\d,\.]+)', line, re.IGNORECASE)
        if m:
            saldo_anterior = m.group(1).replace(',','')
            break

    transactions = group_transactions(raw_lines)
    if not transactions:
        raise ValueError(
            'No se encontraron transacciones. '
            '¿Es el formato Banca Remota BANDEC exportado desde el navegador?'
        )
    return generate_txt(header_info, transactions, saldo_anterior)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Uso: python3 pdf_to_txt_v2.py <archivo.pdf> [salida.txt]')
        sys.exit(1)
    pdf_path    = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    txt = convert(pdf_path)
    if output_path:
        # UTF-8 porque el nuevo formato puede tener caracteres especiales
        with open(output_path, 'w', encoding='utf-8', errors='replace') as fh:
            fh.write(txt)
        cr = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Cr'))
        db = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Db'))
        print(f'OK -> {output_path}  |  CR: {cr}  DB: {db}')
    else:
        sys.stdout.write(txt)