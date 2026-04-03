#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
god_extractor_v2.py
===================
Extractor de transferencias BANDEC — Formato 2: TXT generado por pdf_to_txt_v2.py

Úsalo con el TXT generado por pdf_to_txt_v2.py (PDF Banca Remota web/browser).
Características del TXT que procesa:
  - Fecha: dd/mm/yyyy  (con ceros, ej. 05/01/2026)
  - Tipo al final de línea: "Cr" (mixedcase)
  - Ref_corriente: YY60..., YR60..., VB60..., etc.
  - Continuación pegada al bloque con indentación de columna
  - Prefijos nuevos además de los clásicos: KW (formato largo), C6, H1
  - KW embebe ORDENANTE con posible salto ORDE/NANTE entre líneas
  - VB, C6, H1 son típicamente DB (débitos propios) → se omiten

Imprime resultado JSON a stdout para uso desde Node.js.
"""

import sys
import re
import json
import psycopg2
import psycopg2.extras
from psycopg2 import sql
from collections import defaultdict
import os

# ─── Config BD ────────────────────────────────────────────────────────────────
DB_CONFIG = {
    'host':     os.environ.get('DB_HOST',     'localhost'),
    'database': os.environ.get('DB_NAME',     'Prueba'),
    'user':     os.environ.get('DB_USER',     'postgres'),
    'password': os.environ.get('DB_PASSWORD', 'Ariel2017'),
    'port':     os.environ.get('DB_PORT',     '5432'),
}

def conectar_postgres():
    try:
        return psycopg2.connect(**DB_CONFIG)
    except Exception as e:
        raise RuntimeError(f'No se pudo conectar a PostgreSQL: {e}')


def crear_tabla_postgres():
    conn = conectar_postgres()
    try:
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS transferencias (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                ref_origen VARCHAR(50) NOT NULL,
                prefijo VARCHAR(10),
                importe DECIMAL(12,2) NOT NULL,
                tipo VARCHAR(2) NOT NULL CHECK (tipo IN ('CR')),
                nombre VARCHAR(500),
                ci VARCHAR(20),
                titular VARCHAR(200),
                fecha_procesamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_transferencias UNIQUE(fecha, ref_origen, importe, tipo)
            )
        ''')
        # Migración: agrega columna si la tabla ya existía sin ella
        cur.execute('ALTER TABLE transferencias ADD COLUMN IF NOT EXISTS titular VARCHAR(200)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_fecha   ON transferencias(fecha)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_ci      ON transferencias(ci)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_prefijo ON transferencias(prefijo)')
        conn.commit()
    finally:
        conn.close()


def guardar_en_postgres(transferencias, borrar_existentes=False):
    conn = conectar_postgres()
    try:
        cur = conn.cursor()
        filas = []
        for t in transferencias:
            try:
                p = t['fecha'].split('/')
                fecha_fmt = f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 else t['fecha']
            except:
                fecha_fmt = t['fecha']
            filas.append((
                fecha_fmt,
                t['ref_origen'],
                t['prefijo'],
                float(t['importe']),
                t['tipo'],
                (t['nombre'] or '')[:499] or None,
                t['ci'] or None,
                (t.get('titular') or '')[:199] or None,
            ))

        if borrar_existentes:
            cur.execute('DELETE FROM transferencias')

        psycopg2.extras.execute_values(
            cur,
            sql.SQL('''
                INSERT INTO transferencias (fecha, ref_origen, prefijo, importe, tipo, nombre, ci, titular)
                VALUES %s
                ON CONFLICT (fecha, ref_origen, importe, tipo)
            DO UPDATE SET titular = EXCLUDED.titular
            WHERE transferencias.titular IS NULL
            '''),
            filas,
            template='(%s,%s,%s,%s,%s,%s,%s,%s)',
            page_size=100,
        )
        conn.commit()
        return cur.rowcount
    except:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── Extracción de CI ─────────────────────────────────────────────────────────
def buscar_ci(bloque_norm, bloque_orig):
    """
    Busca un CI de 11 dígitos en el bloque de texto.
    Maneja CIs partidos por salto de línea del PDF: ej. "CI:8204120661 7"
    """
    # Patrón principal: CI seguido de hasta 13 chars que sean dígitos o espacios
    # Luego limpiamos espacios y validamos que sean exactamente 11 dígitos
    patron_flexible = r'C\s*[.\s]*I\s*[:|=]\s*(\d[\d\s]{9,12}\d)'

    for bloque in (bloque_orig, bloque_norm):
        for m in re.finditer(patron_flexible, bloque, re.IGNORECASE):
            cand = re.sub(r'\s+', '', m.group(1))  # eliminar espacios internos
            if (len(cand) == 11
                    and cand.isdigit()
                    and cand != '00000000000'
                    and not re.match(r'(\d)\1{10}', cand)):
                return cand
    return ''


# ─── Correcciones de nombres partidos por saltos de línea del PDF ─────────────
CORRECCIONES = [
    (r'\bRODRIGU\s+EZ\b','RODRIGUEZ'), (r'\bGONZAL\s+EZ\b','GONZALEZ'),
    (r'\bHERNAND\s+EZ\b','HERNANDEZ'), (r'\bFERNAND\s+EZ\b','FERNANDEZ'),
    (r'\bMARTIN\s+EZ\b','MARTINEZ'),   (r'\bRAMIR\s+EZ\b','RAMIREZ'),
    (r'\bVAZQU\s+EZ\b','VAZQUEZ'),     (r'\bSUAR\s+EZ\b','SUAREZ'),
    (r'\bALVAR\s+EZ\b','ALVAREZ'),     (r'\bCAS\s+TILLO\b','CASTILLO'),
    (r'\bGAR\s+CIA\b','GARCIA'),       (r'\bTOR\s+RES\b','TORRES'),
    (r'\bMOR\s+ALES\b','MORALES'),     (r'\bCABR\s+ERA\b','CABRERA'),
    (r'\bRAMO\s+S\b','RAMOS'),         (r'\bVELAZQU\s+EZ\b','VELAZQUEZ'),
    (r'\bDOM\s+INGU\s+EZ\b','DOMINGUEZ'), (r'\bBETAN\s+COURT\b','BETANCOURT'),
    (r'\bCARBA\s+JAL\b','CARBAJAL'),   (r'\bGAR\s+LOBO\b','GARLOBO'),
    (r'\bECHEVAR\s+RIA\b','ECHEVARRIA'),(r'\bCEBALL\s+OS\b','CEBALLOS'),
    (r'\bDE\s+L\s+A\s+FE\b','DE LA FE'),(r'\bDEL\s+ROSARIO\b','DEL ROSARIO'),
    (r'\bHA\s+BANA\b','HABANA'),        (r'\bHABA\s+NA\b','HABANA'),
    (r'\bORDE\s+NANTE\b','ORDENANTE'),  # específico para KW partido
    (r'\bNOM\s+BRE\b','NOMBRE'),        # NOMBRE partido
    # Nombres frecuentes que se parten en este formato de PDF
    (r'\bAM\s+ANDA\b','AMANDA'),
    (r'\bYARISLEI\s+DI\b','YARISLEIDÍ'),
    (r'\bLEI\s+DI\b','LEIDI'),
    (r'\bYARI\s+SLEIDI\b','YARISLEIDÍ'),
    (r'\bAL\s+EXIS\b','ALEXIS'),
    (r'\bALE\s+XIS\b','ALEXIS'),
    (r'\bNIE\s+VE\b','NIEVE'),
    (r'\bSU\s+SANA\b','SUSANA'),
    (r'\bRAY\s+NEL\b','RAYNEL'),
    (r'\bREY\s+BEL\b','REYBEL'),
    (r'\bGIS\s+ELA\b','GISELA'),
    (r'\bTA\s+MARA\b','TAMARA'),
    (r'\bLIE\s+SER\b','LIESER'),
    (r'\bYU\s+CET\b','YUCET'),
    (r'\bWIL\s+DER\b','WILDER'),
    (r'\bAL\s+BA\b','ALBA'),
    (r'\bRAI\s+NER\b','RAINER'),
    (r'\bJO\s+SE\b','JOSE'),
]

def normalizar_nombre(nombre):
    if not nombre:
        return ''
    nombre = re.sub(r'[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.\-]', ' ', nombre)
    nombre = re.sub(r'\s+', ' ', nombre).strip()
    for pat, rep in CORRECCIONES:
        nombre = re.sub(pat, rep, nombre, flags=re.IGNORECASE)
    nombre = re.sub(r'\s+', ' ', nombre).strip()
    palabras = nombre.split()
    resultado = []
    for p in palabras:
        if p.lower() in ('de','del','la','las','los','y','e'):
            resultado.append(p.lower())
        else:
            resultado.append(p.capitalize())
    nombre = ' '.join(resultado)
    return nombre if len(nombre.split()) >= 2 else ''


def extraer_nombre_ci(bloque_orig, ref_origen):
    """
    Extrae nombre y CI del bloque de texto de una transacción.
    Maneja los formatos de este TXT (v2):
      - MM: NOMBRE:X| CI:Y en XML
      - 98: "POR: NOMBRE P" antes de "PAN:"
      - KW: ORDENANTE NOMBRE:X| CI:Y  (puede estar partido ORDE/NANTE)
      - VB: "Ordenante: NOMBRE" para CRs entrantes; "Ejecutado por: NOMBRE" como fallback
      - AJ: NOMBRE: en OTR_DATOS
    """
    nombre = ''
    ci     = ''

    # ── Normalización en 2 pasos ──────────────────────────────────────────────
    # Paso 1: pegar fragmentos de palabras cortadas en saltos de línea.
    #
    # El PDF genera líneas de continuación con ≥38 espacios de indentación fija.
    # Cuando una palabra queda partida, el último carácter de la línea es A-Z/0-9/:
    # y el primer carácter de la siguiente línea (tras los espacios) también lo es.
    # Ejemplos reales del archivo:
    #   "NOMBR\n                                              E:ALBA"  → NOMBRE:ALBA
    #   "NOMB\n                                              RE:ALBA"  → NOMBRE:ALBA
    #   "NOMBRE:\n                                            SUSANA"  → NOMBRE:SUSANA
    #   "NOMBRE:AM\n                                          ANDA"    → NOMBRE:AMANDA
    #   "NOMBRE:J\n                                           OSE"     → NOMBRE:JOSE
    #
    # La sustitución une SOLO los dos caracteres de la costura (grupo1 + grupo2),
    # eliminando el salto de línea y los espacios intermedios.
    bloque_joined = re.sub(
        r'([A-Z0-9:])\r?\n[ \t]{38,}([A-Z0-9])',
        r'\1\2',
        bloque_orig,
    )
    # Paso 2: colapsar cualquier whitespace restante (saltos entre campos, etc.)
    bloque_norm = re.sub(r'\s+', ' ', bloque_joined)
    prefijo = ref_origen[:2].upper() if len(ref_origen) >= 2 else ''

    # ── MM ────────────────────────────────────────────────────────────────────
    if prefijo == 'MM':
        m = re.search(r'NOMBRE\s*[:\s]+([^|"<]{3,60}?)\s*\|', bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{5,}', nt):
                nombre = nt

    # ── 98 (BancaMóvil-BPA) ───────────────────────────────────────────────────
    elif prefijo == '98':
        m = re.search(r'(?:BPA|BANCAMOVIL)[^P]*POR\s*:\s*(.+?)\s+P\s*AN\s*[=:\s]', bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt) and 'ID_CUBACEL' not in nt:
                nombre = nt

    # ── KW (Transferencia tarjeta BANDEC)  ───────────────────────────────────
    # El bloque puede tener "...MAGNETICA ORDE\nNANTE NOMBRE:X| CI:Y..."
    elif prefijo == 'KW':
        # Buscar en texto normalizado (ORDENANTE pegado)
        m = re.search(
            r'ORDENANTE\s+NOMBRE\s*:\s*([^|]{3,80}?)\s*\|\s*CI\s*:\s*(\d{11})',
            bloque_norm, re.IGNORECASE
        )
        if m:
            nombre = m.group(1).strip()
            ci     = m.group(2)
        else:
            # Intentar sin CI
            m = re.search(r'ORDENANTE\s+NOMBRE\s*:\s*([^|<\n]{3,80})', bloque_norm, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()

    # ── VB (VBANDEC — generalmente débito propio, pero extraer si es CR) ──────
    elif prefijo == 'VB':
        # Para créditos entrantes con ref VB, el nombre del remitente está en "Ordenante:"
        m = re.search(r'Ordenante\s*:\s*([^\n|<]{3,80}?)(?=\s*(?:Detalles|Acreditando|Firma|Ejecutado|Autorizado|\||$))', bloque_norm, re.IGNORECASE)
        if m:
            nombre = m.group(1).strip()
        if not nombre:
            # Formato XML: OTR_DATOS="NOMBRE|" (ej. Metro en Línea, YR prefix)
            m = re.search(r'OTR_DATOS\s*=\s*["\s]*([A-ZÁÉÍÓÚÑÜ][^"|<\n]{3,79}?)\s*\|', bloque_norm, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()
        if not nombre:
            # Fallback: débitos propios llevan "Ejecutado por: NOMBRE Autorizado por:"
            m = re.search(r'Ejecutado\s+por\s*:\s*(.+?)\s+Autorizado', bloque_norm, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()

    # ── AJ (Banco Metropolitano u otros) ─────────────────────────────────────
    elif prefijo == 'AJ':
        m = re.search(r'NOMBRE\s*:\s*([^|"<]{3,60}?)\s*(?:\||CI:|DIR:|$)', bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if (not re.search(r'\d{3,}', nt) and len(nt) > 3
                    and not re.search(r'SUCURSAL|BANCO|SRL|S\.R\.L|S\.A\.|EMPRESA', nt, re.IGNORECASE)):
                nombre = nt

    # ── Fallback genérico: buscar NOMBRE: en cualquier parte ─────────────────
    if not nombre:
        m = re.search(r'NOMBRE\s*[:=]\s*([^|"<\n]{3,60}?)(?:\s*\||\s*CI\s*[:=]\s*\d{11}|$)',
                      bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt) and len(nt) > 3:
                nombre = nt

    # ── Fallback 2: "POR: NOMBRE" genérico (cualquier prefijo) ───────────────
    if not nombre:
        m = re.search(r'POR\s*:\s*([A-ZÁÉÍÓÚÑ][^|\n]{3,60}?)\s*(?:PAN|CUE|\|)',
                      bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt):
                nombre = nt

    # ── Fallback 3: "ORDENANTE NOMBRE:" sin prefijo KW ───────────────────────
    if not nombre:
        m = re.search(r'ORDENANTE\s+NOMBRE\s*:\s*([^|<\n]{3,80}?)\s*(?:\||CI\s*:|$)',
                      bloque_norm, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt) and len(nt) > 3:
                nombre = nt

    # ── CI si aún no lo tenemos ───────────────────────────────────────────────
    if not ci:
        ci = buscar_ci(bloque_norm, bloque_orig)

    return normalizar_nombre(nombre), ci


# ─── Regex para detectar líneas de transacción en el TXT ─────────────────────
#
# Formato v2:  dd/mm/yyyy  YY60...  REF_ORIG  ...  12345.67  Cr
#
# PATRON ampliado: acepta CUALQUIER ref_corriente y ref_origen alfanumérica.
# El filtro de tipo es exclusivamente el final "Cr" — no depender de prefijos
# hardcodeados para no perder CRs con prefijos nuevos o desconocidos.
PATRON = re.compile(
    r'(\d{2}/\d{2}/\d{4})\s+'   # fecha dd/mm/yyyy
    r'([A-Z0-9]{4,})\s+'           # ref_corriente  (cualquier alfanumérico ≥4)
    r'([A-Z0-9][A-Z0-9]{2,})\s+'    # ref_origen     (alfanumérico ≥3 chars, cubre 98xx también)
    r'[^\r\n]*?'                   # observaciones  (lazy)
    r'\s+([\d,]+\.\d{2})\s+'   # importe
    r'(Cr)\b',                      # tipo = Cr ÚNICAMENTE
    re.IGNORECASE
)

# Prefijos a omitir (débitos propios que no son cobros de clientes)
PREFIJOS_OMITIR = {'BD', 'C6', 'H1'}


def extraer_titular_txt(contenido):
    """Extrae el nombre del titular del encabezado del TXT generado."""
    for line in contenido.splitlines()[:10]:
        line = line.strip()
        if line.startswith('Titular:'):
            val = line.replace('Titular:', '').strip()
            if val:
                return val
    return ''


def procesar_archivo(archivo_txt):
    with open(archivo_txt, 'r', encoding='utf-8', errors='replace') as f:
        contenido = f.read()

    titular = extraer_titular_txt(contenido)

    matches = list(PATRON.finditer(contenido))
    transacciones = []

    for i, match in enumerate(matches):
        fecha       = match.group(1)
        ref_origen  = match.group(3)
        importe_str = match.group(4).replace(',', '')
        tipo        = 'CR'
        prefijo     = ref_origen[:2].upper() if len(ref_origen) >= 2 else ref_origen

        # Omitir débitos propios
        if prefijo in PREFIJOS_OMITIR:
            continue

        # Bloque de texto de esta transacción hasta la siguiente
        fin = matches[i + 1].start() if i + 1 < len(matches) else min(len(contenido), match.end() + 2500)
        bloque = contenido[match.start():fin]

        try:
            importe = float(importe_str)
        except:
            importe = 0.0

        nombre, ci = extraer_nombre_ci(bloque, ref_origen)

        transacciones.append({
            'fecha':      fecha,
            'ref_origen': ref_origen,
            'prefijo':    prefijo,
            'importe':    importe,
            'tipo':       tipo,
            'nombre':     nombre,
            'ci':         ci,
            'titular':    titular,
        })

    return transacciones, len(contenido)


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'Se requiere la ruta del archivo TXT como argumento'}))
        sys.exit(1)

    archivo_txt       = sys.argv[1]
    borrar_existentes = '--borrar' in sys.argv

    if not os.path.exists(archivo_txt):
        print(json.dumps({'ok': False, 'error': f'Archivo no encontrado: {archivo_txt}'}))
        sys.exit(1)

    try:
        transacciones, chars = procesar_archivo(archivo_txt)

        if not transacciones:
            print(json.dumps({'ok': False, 'error': 'No se encontraron transacciones en el archivo'}))
            sys.exit(1)

        crear_tabla_postgres()
        filas_insertadas = guardar_en_postgres(transacciones, borrar_existentes)

        con_nombre = sum(1 for t in transacciones if t['nombre'])
        con_ci     = sum(1 for t in transacciones if t['ci'])

        stats_prefijos = defaultdict(lambda: {'total': 0, 'con_nombre': 0, 'con_ci': 0})
        for t in transacciones:
            p = t['prefijo']
            stats_prefijos[p]['total'] += 1
            if t['nombre']: stats_prefijos[p]['con_nombre'] += 1
            if t['ci']:     stats_prefijos[p]['con_ci']     += 1

        print(json.dumps({
            'ok':             True,
            'total':          len(transacciones),
            'insertadas':     filas_insertadas,
            'duplicadas':     len(transacciones) - max(filas_insertadas, 0),
            'con_nombre':     con_nombre,
            'con_ci':         con_ci,
            'total_creditos': sum(t['importe'] for t in transacciones),
            'num_creditos':   len(transacciones),
            'stats_prefijos': dict(stats_prefijos),
        }))

    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()