#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Conversor de Estado de Cuenta BANDEC (formato nuevo v2): PDF → TXT
Compatible con god_extractor_api.py

Diferencias clave con el formato antiguo:
  - Header: "Estado de Cuenta desde: YYMMDD hasta: YYMMDD"
  - Titular en línea única con CI, PAN, Cta.SMPE
  - Refs corriente y origen pueden venir PEGADAS: "KW6004405C999KW6004405C999"
  - Prefijos CR habituales: KW, AY (además de MM, 98, AJ, etc.)
  - Saldos finales: "Saldo Contable:", "Saldo Disponible:", "Saldo Confirmado:"
"""

import sys
import re
import pdfplumber
from io import StringIO

COL_FECHA    = 0
COL_REF_CORR = 11
COL_REF_ORIG = 27
COL_OBS      = 46
COL_IMPORTE  = 83

PREFIJOS = ('KW','AY','EZ','MM','98','VB','BD','JD','AJ','DD','C5','YY','YR','TR')

def pad_right(s, width):
    s = str(s); return s[:width].ljust(width)

def rpad(s, width):
    s = str(s); return s[:width].rjust(width)


def extract_pdf_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split('\n'))
    return lines


def separar_refs(s):
    """
    Divide un token de refs en (ref_corr, ref_orig).
    Maneja: ya separadas, iguales pegadas, distintas pegadas.
    """
    partes = s.strip().split()
    if len(partes) >= 2:
        return partes[0], partes[1]
    s = s.strip()
    n = len(s)
    # Mitad igual
    if n >= 16 and n % 2 == 0:
        h = n // 2
        if s[:h] == s[h:]:
            return s[:h], s[h:]
    # Segundo prefijo conocido
    for px in PREFIJOS:
        pos = s.find(px, 2)
        if pos > 4:
            return s[:pos], s[pos:]
    return s, s


def preprocess_line(line):
    """
    Si tras la fecha hay dos refs pegadas (sin espacio),
    inserta el espacio entre ellas antes de que actúe el tx_re.

    "DD/MM/YYYY KW...KW... obs"  ->  "DD/MM/YYYY KW... KW... obs"
    """
    m = re.match(
        r'^(\d{2}/\d{2}/\d{4})\s+([A-Z0-9]{13,})(\s+.+)$',
        line, re.IGNORECASE
    )
    if not m:
        return line
    refs_raw = m.group(2)
    ref_corr, ref_orig = separar_refs(refs_raw)
    if ref_corr == refs_raw:          # no se pudo separar
        return line
    return f'{m.group(1)} {ref_corr} {ref_orig}{m.group(3)}'


def parse_new_format(lines):
    header_info = {}
    footer_info = {}
    transactions = []
    current_tx = None
    in_body = False

    # Patrón con dos refs ya separadas
    tx_re = re.compile(
        r'^(\d{2}/\d{2}/\d{4})\s+'
        r'([A-Z0-9]{8,})\s+'
        r'([A-Z0-9]{8,})\s+'
        r'(.+?)\s+'
        r'([\d,]+\.\d{2})\s+'
        r'(Cr|Db)\s*$',
        re.IGNORECASE
    )

    re_sa  = re.compile(r'^Saldo Anterior:\s+([\d,\.]+)\s*$')
    re_sc  = re.compile(r'^Saldo Contable:\s+([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE)
    re_sd  = re.compile(r'^Saldo Disponible:\s+([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE)
    re_scf = re.compile(r'^Saldo Confirmado:\s+([\d,\.]+)\s+(Cr|Db)', re.IGNORECASE)

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if not in_body:
            if re.match(r'^Banco de\s', line, re.IGNORECASE):
                header_info['banco'] = line
            elif line.startswith('Estado de Cuenta desde:'):
                header_info['rango'] = line
                m = re.search(r'desde:\s*(\d+)\s*hasta:\s*(\d+)', line)
                if m:
                    def fmt6(s): return f'20{s[:2]}-{s[2:4]}-{s[4:6]}' if len(s)==6 else s
                    header_info['fecha_inicio'] = fmt6(m.group(1))
                    header_info['fecha_fin']    = fmt6(m.group(2))
            elif line.startswith('Suc.Origen:'):
                header_info['sucursal'] = line
            elif 'Cta.SMPE:' in line:
                m = re.search(r'CI:(\d{11})\s+(.+?)\s+Fecha\s+de\s+Emisi', line, re.IGNORECASE)
                if m:
                    header_info['ci_titular'] = m.group(1)
                    header_info['titular']    = m.group(2).strip()
                m2 = re.search(r'Fecha\s+de\s+Emisi[oó]n:\s*(.+?)(?:\s+p[aá]gina|\s*$)', line, re.IGNORECASE)
                if m2:
                    header_info['fecha_emision'] = m2.group(1).strip()
            m_sa = re_sa.match(line)
            if m_sa:
                header_info['saldo_anterior'] = m_sa.group(1)
            if ('Ref.Corrie' in line and 'Observaciones' in line) or re.match(r'^-{10,}', line):
                in_body = True
            continue

        if re.match(r'^-{10,}', line):
            continue

        m_sc = re_sc.match(line)
        if m_sc:
            if current_tx: transactions.append(current_tx); current_tx = None
            footer_info['saldo_final'] = f'Saldo Contable Final: {m_sc.group(1)} {m_sc.group(2)}'
            continue
        if re_sd.match(line):
            m = re_sd.match(line)
            footer_info['disponible'] = f'Saldo Disponible Final: {m.group(1)} {m.group(2)}'
            continue
        if re_scf.match(line):
            m = re_scf.match(line)
            footer_info['confirmado'] = f'Saldo Confirmado: {m.group(1)} {m.group(2)}'
            continue

        proc = preprocess_line(line)
        m_tx = tx_re.match(proc)
        if m_tx:
            if current_tx:
                transactions.append(current_tx)
            current_tx = {
                'fecha':      m_tx.group(1),
                'ref_corr':   m_tx.group(2),
                'ref_orig':   m_tx.group(3),
                'obs_first':  m_tx.group(4).strip(),
                'importe':    m_tx.group(5),
                'tipo':       m_tx.group(6),
                'cont_lines': [],
            }
        elif current_tx is not None:
            current_tx['cont_lines'].append(line)

    if current_tx:
        transactions.append(current_tx)

    return header_info, transactions, footer_info


def format_tx(tx):
    out   = StringIO()
    line  = pad_right(tx['fecha'],     COL_REF_CORR - COL_FECHA)
    line += pad_right(tx['ref_corr'],  COL_REF_ORIG - COL_REF_CORR)
    line += pad_right(tx['ref_orig'],  COL_OBS      - COL_REF_ORIG)
    line += pad_right(tx['obs_first'], COL_IMPORTE  - COL_OBS)
    line += rpad(f'{float(str(tx["importe"]).replace(",","")):.2f}', 12)
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
    out.write(header_info.get('sucursal','') + '\n')
    if 'fecha_emision' in header_info:
        out.write(f"Fecha de Emisión: {header_info['fecha_emision']}\n")
    if 'fecha_inicio' in header_info:
        out.write(f"Rango de Fecha: {header_info['fecha_inicio']} al {header_info['fecha_fin']}\n")
    out.write(f'Cantidad de Movimientos: {len(transactions)} (CR:{cr} DB:{db})\n')
    out.write('\n\n')

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

    for key in ['saldo_final', 'confirmado', 'disponible']:
        val = footer_info.get(key, '')
        if not val: continue
        parts = val.rsplit(' ', 2)
        label   = parts[0] if len(parts)>=1 else val
        importe = parts[1] if len(parts)>=2 else ''
        tipo    = parts[2] if len(parts)>=3 else ''
        fl  = indent + pad_right(label, COL_IMPORTE - COL_OBS)
        fl += rpad(importe, 12) + '   ' + tipo
        out.write('\n' + fl.rstrip() + '\n')

    return out.getvalue()


def convert_pdf_to_txt(pdf_path):
    lines = extract_pdf_lines(pdf_path)
    h, txs, f = parse_new_format(lines)
    if not txs:
        raise ValueError('No se encontraron transacciones. Verifica que el PDF sea formato "Estado de Cuenta desde: YYMMDD".')
    return generate_txt(h, txs, f)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Uso: python3 pdf_to_txt_v2.py <archivo.pdf> [salida.txt]')
        sys.exit(1)

    pdf_path    = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    txt = convert_pdf_to_txt(pdf_path)

    if output_path:
        with open(output_path, 'w', encoding='latin-1', errors='replace') as fh:
            fh.write(txt)
        cr = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Cr'))
        db = sum(1 for l in txt.splitlines() if l.rstrip().endswith('Db'))
        print(f'Archivo generado: {output_path}  |  CR: {cr}  DB: {db}')
    else:
        sys.stdout.write(txt)