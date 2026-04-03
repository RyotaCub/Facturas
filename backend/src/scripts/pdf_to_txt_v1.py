#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
elif hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
"""
pdf_to_txt_v1.py
================
Conversor PDF → TXT  —  Formato 1: "Estado de Cuenta" clásico BANDEC

Características de este formato:
  - Header:  "Titular:", "Sucursal y Cuenta:", "Fecha de Emisión:", "Rango de Fecha:"
  - Fecha de transacción: d/m/yyyy  (ej. 6/1/2025, sin ceros)
  - Observaciones partidas en muchas líneas con indentación fija de columna
  - Saldo: "Saldo Contable Anterior:  XXXXXXX   Cr"
  - Tipo al final de línea: "Cr" / "Db"  (mixedcase)
  - Prefijos habituales: MM, 98, KW, AY, EZ, VB, BD, JD, AJ, DD, C5

Salida compatible con god_extractor_v1.py
"""

import sys
import re
import pdfplumber
from io import StringIO

# ─── Ancho de columnas del TXT de salida ─────────────────────────────────────
COL_FECHA    = 0
COL_REF_CORR = 11
COL_REF_ORIG = 27
COL_OBS      = 46
COL_IMPORTE  = 83

PREFIJOS = ('KW','AY','EZ','MM','98','VB','BD','JD','AJ','DD','C5','YY','YR','TR')

def pad_right(s, width): s = str(s); return s[:width].ljust(width)
def rpad(s, width):      s = str(s); return s[:width].rjust(width)


def extract_pdf_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split('\n'))
    return lines


def separar_refs(s):
    """Divide token de refs pegadas en (ref_corr, ref_orig)."""
    partes = s.strip().split()
    if len(partes) >= 2:
        return partes[0], partes[1]
    s = s.strip(); n = len(s)
    if n >= 16 and n % 2 == 0:
        h = n // 2
        if s[:h] == s[h:]:
            return s[:h], s[h:]
    for px in PREFIJOS:
        pos = s.find(px, 2)
        if pos > 4:
            return s[:pos], s[pos:]
    return s, s


def preprocess_line(line):
    """Inserta espacio entre dos refs pegadas tras la fecha."""
    m = re.match(r'^(\d{1,2}/\d{1,2}/\d{4})\s+([A-Z0-9]{13,})(\s+.+)$', line, re.IGNORECASE)
    if not m:
        return line
    refs_raw = m.group(2)
    ref_corr, ref_orig = separar_refs(refs_raw)
    if ref_corr == refs_raw:
        return line
    return f'{m.group(1)} {ref_corr} {ref_orig}{m.group(3)}'


def parse_format(lines):
    header_info = {}; footer_info = {}; transactions = []; current_tx = None; in_body = False

    tx_re = re.compile(
        r'^(\d{1,2}/\d{1,2}/\d{4})\s+'     # fecha d/m/yyyy sin ceros
        r'([A-Z0-9]{8,})\s+'
        r'([A-Z0-9]{8,})\s+'
        r'(.+?)\s+'
        r'([\d,]+\.\d{2})\s+'
        r'(Cr|Db)\s*$',
        re.IGNORECASE
    )
    re_sa  = re.compile(r'^Saldo Anterior:\s+([\d,\.]+)\s*$')
    re_sca = re.compile(r'Saldo Contable Anterior:\s+([\d,\.]+)')

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if not in_body:
            if line.startswith('Titular:'):
                header_info['titular'] = line.replace('Titular:', '').strip()
            elif not header_info.get('titular'):
                # Formato alternativo: "... CI:89120323694 LISANDRA DE LA FLOR ALONSO ..."
                m_ci = re.search(r'CI:\s*\d{11}\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{5,}?)(?:\s+Fecha|\s*$)', line, re.IGNORECASE)
                if m_ci:
                    header_info['titular'] = m_ci.group(1).strip()
            if 'Sucursal y Cuenta:' in line:
                header_info['sucursal'] = line
            elif re.match(r'Fecha de Emisi[oó]n:', line, re.IGNORECASE):
                header_info['fecha_emision'] = re.sub(r'Fecha de Emisi[oó]n:\s*','',line,flags=re.IGNORECASE).strip()
            elif 'Rango de Fecha:' in line:
                header_info['rango'] = line
            elif 'Cantidad de Movimientos:' in line:
                header_info['movimientos'] = line
            m_sa = re_sa.match(line)
            if m_sa:
                header_info['saldo_anterior'] = m_sa.group(1)
            m_sca = re_sca.search(line)
            if m_sca:
                header_info['saldo_anterior'] = m_sca.group(1)
            if ('Ref_Corriente' in line and 'Observaciones' in line) or re.match(r'^-{10,}', line):
                in_body = True
            continue

        if re.match(r'^-{10,}', line):
            continue

        for re_sf, key in [
            (re.compile(r'^Saldo Contable[^:]*:\s*([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE), 'saldo_final'),
            (re.compile(r'^Saldo Disponible:\s*([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE), 'disponible'),
            (re.compile(r'^Saldo Confirmado:\s*([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE), 'confirmado'),
        ]:
            m = re_sf.match(line)
            if m:
                if current_tx: transactions.append(current_tx); current_tx = None
                footer_info[key] = f'{key}: {m.group(1)} {m.group(2)}'
                break
        else:
            proc = preprocess_line(line)
            m_tx = tx_re.match(proc)
            if m_tx:
                if current_tx: transactions.append(current_tx)
                current_tx = {
                    'fecha':      m_tx.group(1),
                    'ref_corr':   m_tx.group(2),
                    'ref_orig':   m_tx.group(3),
                    'obs_first':  m_tx.group(4).strip(),
                    'importe':    m_tx.group(5).replace(',',''),
                    'tipo':       m_tx.group(6),
                    'cont_lines': [],
                }
            elif current_tx is not None:
                current_tx['cont_lines'].append(line)

    if current_tx:
        transactions.append(current_tx)
    return header_info, transactions, footer_info


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


def generate_txt(header_info, transactions, footer_info):
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
    if 'saldo_anterior' in header_info:
        sa  = indent + pad_right('Saldo Contable Anterior:', COL_IMPORTE - COL_OBS)
        sa += rpad(header_info['saldo_anterior'], 12) + '   Cr'
        out.write(sa.rstrip() + '\n\n')

    for tx in transactions:
        out.write(format_tx(tx))
        out.write('\n')

    return out.getvalue()


def convert(pdf_path):
    lines = extract_pdf_lines(pdf_path)
    h, txs, f = parse_format(lines)
    if not txs:
        raise ValueError('No se encontraron transacciones. ¿Es el formato clásico BANDEC?')
    return generate_txt(h, txs, f)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Uso: python3 pdf_to_txt_v1.py <archivo.pdf> [salida.txt]')
        sys.exit(1)
    pdf_path    = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    txt = convert(pdf_path)
    if output_path:
        with open(output_path, 'w', encoding='utf-8', errors='replace') as fh:
            fh.write(txt)
        cr = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Cr'))
        db = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Db'))
        print(f'OK -> {output_path}  |  CR: {cr}  DB: {db}')
    else:
        sys.stdout.write(txt)