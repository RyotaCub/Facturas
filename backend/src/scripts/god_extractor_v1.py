#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
god_extractor_v1.py
===================
Extractor de transferencias BANDEC — Formato 1: TXT clásico con columnas fijas

Úsalo con el TXT generado por pdf_to_txt_v1.py.
Características del TXT que procesa:
  - Fecha: d/m/yyyy  (sin ceros, ej. 6/1/2025)
  - Tipo al final de línea: "Cr" (mixedcase)
  - Ref_corriente: YR\d+, VB\d+, etc.
  - Observaciones con indentación de columna fija (muchos espacios)
  - Prefijos: MM, 98, KW, VB, AJ, DD, C5, BD, JD

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

# ─── Config BD (usa variables de entorno o valores por defecto) ───────────────
DB_CONFIG = {
    'host':     os.environ.get('DB_HOST',     'localhost'),
    'database': os.environ.get('DB_NAME',     'Prueba'),
    'user':     os.environ.get('DB_USER',     'postgres'),
    'password': os.environ.get('DB_PASSWORD', 'Ariel2017'),
    'port':     os.environ.get('DB_PORT',     '5432'),
}

# ─── Conexión ────────────────────────────────────────────────────────────────
def conectar_postgres():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        raise RuntimeError(f"No se pudo conectar a PostgreSQL: {e}")


def crear_tabla_postgres():
    conexion = conectar_postgres()
    try:
        cursor = conexion.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS transferencias (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                ref_origen VARCHAR(50) NOT NULL,
                prefijo VARCHAR(10),
                importe DECIMAL(12, 2) NOT NULL,
                tipo VARCHAR(2) NOT NULL CHECK (tipo IN ('CR')),
                nombre VARCHAR(500),
                ci VARCHAR(20),
                titular VARCHAR(200),
                fecha_procesamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_transferencias UNIQUE(fecha, ref_origen, importe, tipo)
            )
        ''')
        # Migración: agrega columna si la tabla ya existía sin ella
        cursor.execute('ALTER TABLE transferencias ADD COLUMN IF NOT EXISTS titular VARCHAR(200)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_fecha     ON transferencias(fecha)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ci        ON transferencias(ci)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_prefijo   ON transferencias(prefijo)')
        conexion.commit()
    except Exception as e:
        conexion.rollback()
        raise
    finally:
        conexion.close()


def guardar_en_postgres(transferencias, borrar_existentes=False):
    conexion = conectar_postgres()
    try:
        cursor = conexion.cursor()

        transacciones_procesadas = []
        for t in transferencias:
            try:
                partes = t['fecha'].split('/')
                fecha_fmt = f"{partes[2]}-{partes[1]}-{partes[0]}" if len(partes) == 3 else t['fecha']
            except:
                fecha_fmt = t['fecha']

            transacciones_procesadas.append((
                fecha_fmt,
                t['ref_origen'],
                t['prefijo'],
                float(t['importe']),
                t['tipo'],
                (t['nombre'] or '')[:499] or None,
                t['ci']     or None,
                (t.get('titular') or '')[:199] or None,
            ))

        if borrar_existentes:
            cursor.execute("DELETE FROM transferencias")

        insert_query = sql.SQL('''
            INSERT INTO transferencias (fecha, ref_origen, prefijo, importe, tipo, nombre, ci, titular)
            VALUES %s
            ON CONFLICT (fecha, ref_origen, importe, tipo)
            DO UPDATE SET titular = EXCLUDED.titular
            WHERE transferencias.titular IS NULL
        ''')

        psycopg2.extras.execute_values(
            cursor,
            insert_query,
            transacciones_procesadas,
            template="(%s, %s, %s, %s, %s, %s, %s, %s)",
            page_size=100,
        )
        conexion.commit()
        filas = cursor.rowcount
        return filas
    except Exception as e:
        conexion.rollback()
        raise
    finally:
        conexion.close()


# ─── Extracción de CI ─────────────────────────────────────────────────────────
def buscar_ci_general(bloque_original, bloque):
    """
    Busca un CI de 11 dígitos en el bloque de texto.
    Acepta CIs partidos por salto de línea del PDF: ej. 'CI:8204120661 7'.
    Prioriza la parte CLI_ORDENA (antes de CLI_BENEFI) para no capturar el CI vacío.
    """
    patron = r'C\s*[.\s]*I\s*[:|=]\s*(\d[\d\s]{9,12}\d)'

    def _extraer(texto):
        for m in re.finditer(patron, texto, re.IGNORECASE):
            cand = re.sub(r'\s+', '', m.group(1))
            if (len(cand) == 11
                    and cand.isdigit()
                    and cand != '00000000000'
                    and not re.match(r'(\d)\1{10}', cand)):
                return cand
        return ''

    # Prioridad 1: solo la parte del ordenante (antes del beneficiario vacío)
    for b in (bloque_original, bloque):
        parte = re.split(r'CLI_BENEFI', b, maxsplit=1)[0]
        ci = _extraer(parte)
        if ci:
            return ci

    # Prioridad 2: bloque completo
    for b in (bloque_original, bloque):
        ci = _extraer(b)
        if ci:
            return ci

    return ''


CORRECCIONES = [
    (r'\bRODRIGU\s+EZ\b','RODRIGUEZ'),
    (r'\bGONZAL\s+EZ\b','GONZALEZ'),
    (r'\bHERNAND\s+EZ\b','HERNANDEZ'),
    (r'\bFERNAND\s+EZ\b','FERNANDEZ'),
    (r'\bMARTIN\s+EZ\b','MARTINEZ'),
    (r'\bRAMIR\s+EZ\b','RAMIREZ'),
    (r'\bVAZQU\s+EZ\b','VAZQUEZ'),
    (r'\bSUAR\s+EZ\b','SUAREZ'),
    (r'\bALVAR\s+EZ\b','ALVAREZ'),
    (r'\bCAS\s+TILLO\b','CASTILLO'),
    (r'\bCAR\s+LOS\b','CARLOS'),
    (r'\bROBER\s+TO\b','ROBERTO'),
    (r'\bEDUARD\s+O\b','EDUARDO'),
    (r'\bRICAR\s+DO\b','RICARDO'),
    (r'\bJAVI\s+ER\b','JAVIER'),
    (r'\bJOR\s+GE\b','JORGE'),
    (r'\bANT\s+ONIO\b','ANTONIO'),
    (r'\bJOS\s+E\b','JOSE'),
    (r'\bGAR\s+CIA\b','GARCIA'),
    (r'\bVALD\s+ES\b','VALDES'),
    (r'\bTOR\s+RES\b','TORRES'),
    (r'\bMOR\s+ALES\b','MORALES'),
    (r'\bFUEN\s+TES\b','FUENTES'),
    (r'\bCABR\s+ERA\b','CABRERA'),
    (r'\bORT\s+IZ\b','ORTIZ'),
    (r'\bRAMO\s+S\b','RAMOS'),
    (r'\bRE\s+YES\b','REYES'),
    (r'\bRO\s+JAS\b','ROJAS'),
    (r'\bVEG\s+A\b','VEGA'),
    (r'\bSO\s+SA\b','SOSA'),
    (r'\bDE\s+LA\s+FE\b','DE LA FE'),
    (r'\bDEL\s+ROSARIO\b','DEL ROSARIO'),
    
    # Nuevas correcciones agregadas
    (r'\bGAR\s+LOBO\b', 'GARLOBO'),
    (r'\bC\s+aridad\b', 'Caridad'),
    (r'\bMonz\s+on\b', 'Monzon'),
    (r'\bWen\s+Dolyn\b', 'WENDOLYN'),
    (r'\bNavar\s+Ro\b', 'Navarro'),
    (r'\bJim\s+Enez\b', 'Jimenez'),
    (r'\bSanch\s+Ez\b', 'Sanchez'),
    (r'\bP\s+Eralta\b', 'Peralta'),
    (r'\bB\s+Aez\b', 'Baez'),
    (r'\bMer\s+Cedes\b', 'Mercedes'),
    (r'\bEl\s+Iany\b', 'ELIANY'),
    (r'\bBelind\s+A\b', 'BELINDA'),
    (r'\bROD\s+RIGUEZ\b', 'RODRIGUEZ'),
    (r'\bRODR\s+IGUEZ\b', 'RODRIGUEZ'),
    (r'\bG\s+onzalEZ\b', 'GONZALEZ'),
    (r'\bEsq\s+uivias\b', 'Esquivias'),
    (r'\bZoyl\s+a\b', 'Zoyla'),
    (r'\bHERN\s+AndEZ\b', 'HERNANDEZ'),
    (r'\bFERNA\s+ndEZ\b', 'FERNANDEZ'),
    (r'\bVA\s+zquEZ\b', 'VAZQUEZ'),
    (r'\bVELAZQU\s+EZ\b', 'VELAZQUEZ'),
    (r'\bLATER\s+O\b', 'LATERO'),
    (r'\bVELA\s+zquEZ\b', 'VELAZQUEZ'),
    (r'\bDOM\s+INGU\s+EZ\b', 'DOMINGUEZ'),
    (r'\bDO\s+MinguEZ\b', 'DOMINGUEZ'),
    (r'\bALVARE\s+Z\b', 'ALVAREZ'),
    (r'\bCAStil\s+LO\b', 'CASTILLO'),
    (r'\bMORAL\s+ES\b', 'MORALES'),
    (r'\bCEBALL\s+OS\b', 'CEBALLOS'),
    (r'\bRIZ\s+O\b', 'RIZO'),
    (r'\bREVIL\s+LA\b', 'REVILLA'),
    (r'\bPADR\s+ON\b', 'PADRON'),
    (r'\bORTi\s+Z\b', 'ORTIZ'),
    (r'\bMU\s+NOS\b', 'MUNOS'),
    (r'\bMU\s+NOZ\b', 'MUNOZ'),
    (r'\bBETAN\s+COURT\b', 'BETANCOURT'),
    (r'\bRA\s+MON\b', 'RAMON'),
    (r'\bRAM\s+OS\b', 'RAMOS'),
    (r'\bPe\s+Na\b', 'PEÑA'),
    (r'\bMAF\s+UANA\b', 'MAFUANA'),
    (r'\bLAB\s+ANINO\b', 'LABANINO'),
    (r'\bLESC\s+AILLE\b', 'LESCAILLE'),
    (r'\bCARBA\s+JAL\b', 'CARBAJAL'),
    (r'\bVINAG\s+ERA\b', 'VINAGERA'),
    (r'\bCAST\s+IL\s+LO\b', 'CASTILLO'),
    (r'\bSUARE\s+Z\b', 'SUAREZ'),
    (r'\bCARRA\s+TALA\b', 'CARRATALA'),
    (r'\bESCOL\s+ONA\b', 'ESCOLONA'),
    (r'\bFERE\s+RRA\b', 'FERREIRA'),
    (r'\bF\s+errer\b', 'FERRER'),
    (r'\bR\s+afael\b', 'Rafael'),
    (r'\bWillia\s+M\b', 'William'),
    (r'\bGUERRE\s+RA\b', 'GUERRA'),
    (r'\bGUERR\s+A\b', 'GUERRA'),
    (r'\bGUZ\s+Man\b', 'Guzman'),
    (r'\bLAUZUR\s+IQUE\b', 'LAUZURIQUE'),
    (r'\bQUINTA\s+ANA\b', 'QUINTANA'),
    (r'\bAnto\s+Nio\b', 'Antonio'),
    (r'\bCHAC\s+ON\b', 'CHACON'),
    (r'\bSOCI\s+ARRAS\b', 'SOCARRAS'),
    (r'\bROSA\s+BAL\b', 'ROSABAL'),
    (r'\bROS\s+ABAL\b', 'ROSABAL'),
    (r'\bPR\s+AVDYUK\b', 'PRAVDYUK'),
    
    # Nombres comunes partidos
    (r'\bMANUE\s+L\b', 'MANUEL'),
    (r'\bERNE\s+STO\b', 'ERNESTO'),
    (r'\bALEJAND\s+RO\b', 'ALEJANDRO'),
    (r'\bR\s+Obaina\b', 'Robaina'),
    (r'\bDuar\s+Te\b', 'Duarte'),
    (r'\bEd\s+UardO\b', 'EDUARDO'),
    (r'\bGUILLER\s+MO\b', 'GUILLERMO'),
    (r'\bARTUR\s+O\b', 'ARTURO'),
    (r'\bALBER\s+TO\b', 'ALBERTO'),
    (r'\bJAVIE\s+R\b', 'JAVIER'),
    (r'\bOSM\s+EL\b', 'OSMEL'),
    (r'\bOSN\s+IER\b', 'OSNIER'),
    (r'\bERL\s+ENIS\b', 'ERLENIS'),
    (r'\bDAI\s+MA\b', 'DAIMA'),
    (r'\bMIK\s+EL\b', 'MIKEL'),
    (r'\bYAN\s+ET\b', 'YANET'),
    (r'\bJOH\s+NNY\b', 'JOHNNY'),
    (r'\bWILLI\s+AM\b', 'WILLIAM'),
    (r'\bJUL\s+IO\b', 'JULIO'),
    (r'\bCES\s+AR\b', 'CESAR'),
    (r'\bVLAD\s+IMIR\b', 'VLADIMIR'),
    (r'\bGUST\s+AVO\b', 'GUSTAVO'),
    
    # Nombres femeninos partidos
    (r'\bODA\s+LYS\b', 'ODALYS'),
    (r'\bGEO\s+BYS\b', 'GEOBYS'),
    (r'\bGEI\s+DY\b', 'GEIDY'),
    (r'\bLEON\s+ELA\b', 'LEONELA'),
    (r'\bKEN\s+IA\b', 'KENIA'),
    (r'\bAYA\s+MY\b', 'AYAMY'),
    (r'\bYAI\s+ZA\b', 'YAIZA'),
    (r'\bONE\s+LIA\b', 'ONELIA'),
    (r'\bR[Oo]SAI\s+DA\b', 'ROSAIDA'),
    (r'\bMAY\s+LIN\b', 'MAYLIN'),
    (r'\bYAMA\s+LKA\b', 'YAMILKA'),
    (r'\bGIS\s+ELA\b', 'GISELA'),
    (r'\bEVEL\s+IN\b', 'EVELIN'),
    (r'\bMIL\s+AGROS\b', 'MILAGROS'),
    (r'\bYUNA\s+IKY\b', 'YUNAIKY'),
    (r'\bMIL\s+DRED\b', 'MILDRED'),
    (r'\bDA\s+YA\b', 'DAYA'),
    (r'\bLI\s+ANNE\b', 'LIANNE'),
    (r'\bELI\s+SA\b', 'ELISA'),
    (r'\bJUA\s+NA\b', 'JUANA'),
    (r'\bDANIE\s+LA\b', 'DANIELA'),
    (r'\bKAR\s+LA\b', 'KARLA'),
    (r'\bS\s+oria\b', 'Soria'),
    (r'\bYANI\s+CET\b', 'YANICET'),
    (r'\bSOR\s+AYA\b', 'SORAYA'),
    (r'\bMAG\s+ALY\b', 'MAGALY'),
    (r'\bVERO\s+NICA\b', 'VERONICA'),
    (r'\bELI\s+ANNY\b', 'ELIANNY'),
    (r'\bANA\s+BEL\b', 'ANABEL'),
    (r'\bANO\s+LVIS\b', 'ANOLVIS'),
    (r'\bMAB\s+EL\b', 'MABEL'),
    (r'\bMAY\s+LAN\b', 'MAYLAN'),
    (r'\bDIAN\s+ELYS\b', 'DIANELYS'),
    (r'\bYAS\s+MIDA\b', 'YASMIDA'),
    (r'\bCARM\s+EN\b', 'CARMEN'),
    (r'\bILE\s+ANA\b', 'ILEANA'),
    (r'\bADRI\s+ANA\b', 'ADRIANA'),
    (r'\bAD\s+driAN\b', 'ADRIAN'),
    (r'\bYADI\s+RA\b', 'YADIRA'),
    (r'\bOLI\s+VIA\b', 'OLIVIA'),
    
    # Palabras comunes en nombres
    (r'\bCA\s+RIDAD\b', 'CARIDAD'),
    (r'\bCA\s+RMEN\b', 'CARMEN'),
    (r'\bME\s+DINA\b', 'MEDINA'),
    (r'\bECHEVAR\s+RIA\b', 'ECHEVARRIA'),
    (r'\bECHEVA\s+FRIA\b', 'ECHEVARRIA'),
    (r'\bEC\s+hevarRIA\b', 'ECHEVARRIA'),
    (r'\bLore\s+Nzo\b', 'Lorenzo'),
    (r'\bRosque\s+T\b', 'Rosquet'),
    (r'\bDE\s+L\s+A\s+FE\b', 'DE LA FE'),
    (r'\bDEL\s+R\s+OSARIO\b', 'DEL ROSARIO'),
    (r'\bDE\s+LA\s+PAZ\b', 'DE LA PAZ'),
    (r'\bMULATA\s+BONI\s+TA\b', 'MULATA BONITA'),
    (r'\bDE\s+LA\s+FLOR\b', 'DE LA FLOR'),
    (r'\bDE\s+LA\s+Caridad\b', 'DE LA Caridad'),
    (r'\bDE\s+L\s+A\s+Caridad\b', 'DE LA Caridad'),
    (r'\bRU[Ii]\s+Z\s+DE\s+BUSTAM\s+ANTE\b', 'RUIZ DE BUSTAMANTE'),
    (r'\bF[Ee]R\s+N[aá]ND\s+EZ\b', 'FERNANDEZ'),
    (r'\bGONZ\s+[AÁ]LEZ\b', 'GONZALEZ'),
    (r'\bAL[Ff]\s+REDO\b', 'ALFREDO'),
    (r'\bAL[Ff]R\s+EDO\b', 'ALFREDO'),
    (r'\bMA[Ii]\s+KEL\b', 'MAIKEL'),
    (r'\bMA[Ii]k\s+EL\b', 'MAIKEL'),
    (r'\bRO[Ee]\s+SQUE\b', 'ROESQUE'),
    (r'\bCA\s+LDERON\b', 'CALDERON'),
    (r'\bACU\s+NA\b', 'ACUNA'),
    (r'\bH[Ii]\s+DALGO\b', 'HIDALGO'),
    (r'\bH[Ii]Dal\s+GO\b', 'HIDALGO'),
    (r'\bPRIE\s+TO\b', 'PRIETO'),
    (r'\bPRIET\s+O\b', 'PRIETO'),
    (r'\bC[Ee]\s+REIJO\b', 'CEREIJO'),
    (r'\bORD[Oo]\s+ÑEZ\b', 'ORDONEZ'),
    (r'\bODO\s+CIO\b', 'ODICIO'),
    (r'\bODici\s+O\b', 'ODICIO'),
    (r'\bS[ÁA]\s+NTIB[ÁA]ÑEZ\b', 'SANTIBAÑEZ'),
    (r'\bS\s+ANTIB[ÁA]NEZ\b', 'SANTIBAÑEZ'),
    (r'\bBARACA\s+LDO\b', 'BARACALDO'),
    (r'\bBERM[ÚU]\s+DEZ\b', 'BERMUDEZ'),
    
    # Correcciones para palabras partidas por espacios
    (r'\bTE\s+JEDA\b', 'TEJEDA'),
    (r'\bVE\s+LO\s+Z\b', 'VELOZ'),
    (r'\blop\s+EZ\b', 'Lopez'),
    (r'\blope\s+Z\b', 'Lopez'),
    (r'\bHIER\s+REZUELO\b', 'HIERREZUELO'),
    (r'\bPUE\s+BLA\b', 'PUEBLA'),
    (r'\bVE\s+G[AÁ]\b', 'VEGA'),
    (r'\bVEG\s+[AÁ]\b', 'VEGA'),
    (r'\bR\s+EYES\b', 'REYES'),
    (r'\bOdelai\s+Sy\b', 'Odelaisy'),
    (r'\bBE\s+LLO\b', 'BELLO'),
    (r'\bATI\s+ENZA\b', 'ATIENZA'),
    (r'\bCA\s+M[Pp]OS\b', 'CAMPOS'),
    (r'\bCAL\s+DERIN\b', 'CALDERIN'),
    (r'\bUR\s+RA\b', 'URRA'),
    (r'\bBE\s+NI[TT]O\b', 'BENITO'),
    (r'\bBEN\s+I[TT]O\b', 'BENITO'),
    (r'\bCUE\s+LLAR\b', 'CUELLAR'),
    (r'\bCH[Ii]\s+RINO\b', 'CHIRINO'),
    (r'\bCH[Ii]R\s+INO\b', 'CHIRINO'),
    (r'\bCE\s+SPED\b', 'CESPED'),
    (r'\bFR[Oo]\s+META\b', 'FROMETA'),
    (r'\bPE[Ll]\s+[ÁA]EZ\b', 'PELAEZ'),
    (r'\bMA\s+RCOS\b', 'MARCOS'),
    (r'\bVI[Nn]\s+AGR[Ee]RA\b', 'VINAGRERA'),
    (r'\bAg\s+ustina\b', 'Agustina'),
    (r'\bRO\s+BERT\b', 'ROBERT'),
    (r'\bF[ÁA]\s+BREGAT\b', 'FABREGAT'),
    (r'\bLA\s+G[Uu]ET\b', 'LAGUET'),
    (r'\bGAR\s+C[ÍI]A\b', 'GARCIA'),
    (r'\bS[ÍI]\s+LV[Aa]\b', 'SILVA'),
    (r'\bVAL[Ee]\s+RA\b', 'VALERA'),
    (r'\bORO\s+ZCO\b', 'OROZCO'),
    (r'\bUR[ÍI]\s+A\b', 'URIA'),
    (r'\bQU[ÍI]\s+[OÓ]NEZ\b', 'QUIÑONEZ'),
    (r'\bG[OÓ]N\s+Z[ÁA]LEZ\b', 'GONZALEZ'),
    (r'\bMAT[Ee]\s+HU\b', 'MATHEU'),
    (r'\bDELGAD\s+[OÓ]\b', 'DELGADO'),
    (r'\bMAY[Oo]\s+R\b', 'MAYOR'),
    (r'\bGR\s+AnDA\b', 'GRANDA'),
    (r'\bHA\s+BANA\b', 'HABANA'),
    (r'\bHABA\s+NA\b', 'HABANA'),
]

def extraer_nombre_ci_simple(bloque, ref_origen):
    nombre = ""
    ci = ""
    bloque_original = bloque
    bloque = re.sub(r'\s+', ' ', bloque.replace('\n', ' ').replace('\r', ' '))
    prefijo = ref_origen[:2].upper() if len(ref_origen) >= 2 else ""

    if prefijo == '98':
        m = re.search(r'(?:BPA|BANCAMOVIL)[^P]*POR\s*:\s*(.+?)\s+P\s*AN\s*[=:\s]', bloque, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt) and 'ID_CUBACEL' not in nt:
                nombre = nt
    elif prefijo == 'MM':
        m = re.search(r'NOMBRE\s*[:\s]+([^|]+?)\s*\|', bloque, re.IGNORECASE)
        if m:
            nombre = m.group(1).strip()
    elif prefijo == 'KW':
        pos = bloque.find(ref_origen)
        b = bloque[pos:] if pos >= 0 else bloque
        m = re.search(r'ORDENANTE\s+NOM\s*BRE\s*:\s*([^|]+?)\s*\|\s*CI\s*:\s*(\d{11})', b, re.IGNORECASE)
        if m:
            nombre = m.group(1).strip()
            cand = m.group(2)
            if len(cand) == 11 and cand != '00000000000':
                ci = cand
        if not nombre:
            m = re.search(r'ORDENANTE\s+NOM\s*BRE\s*:\s*([^|]+)', b, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()
    elif prefijo == 'VB':
        for pat in [
            r'Ejecutado\s+por\s*:\s*(.+?)\s+Autorizado',
            r'Detalles\s*[:\s]+(.+?)(?:Firma:|Ejecutado|<|$)',
            r'RF:\s*([^;]*?)\s*;',
            r'Ordenante:\s*[:\s]+(.+?)(?:Firma:|Ejecutado|<|$)',
        ]:
            m = re.search(pat, bloque, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()
                break
    elif prefijo in ['BD', 'JD']:
        m = re.search(r'DEPOSITANTE\s*[:\s]+(.+?)(?:\[VENCTO|$)', bloque, re.IGNORECASE)
        if m:
            nombre = m.group(1).strip()
    elif prefijo == 'AJ':
        # Transferencia bancaria institucional (Banco Metropolitano u otros bancos)
        # Intentar extraer el nombre del ordenante del campo NOMBRE: en OTR_DATOS
        # Solo si no es un nombre institucional (sin "SUCURSAL", sin muchos dígitos)
        m = re.search(r'NOMBRE:\s*([^|"<]+?)\s*(?:\||CI:|DIR:|$)', bloque, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if (not re.search(r'\d{3,}', nt)
                    and len(nt) > 3
                    and not re.search(r'SUCURSAL|BANCO|SRL|S\.R\.L|S\.A\.|EMPRESA', nt, re.IGNORECASE)):
                nombre = nt
        # Intentar CI si está disponible
        ci_found = buscar_ci_general(bloque_original, bloque)
        if ci_found:
            ci = ci_found
    elif prefijo == 'DD':
        # Cheques depositados: extraer nombre del titular/empresa (texto puede estar partido entre líneas)
        bloque_norm = re.sub(r'\s+', ' ', bloque_original.replace('\n', ' ').replace('\r', ' '))
        # Detener la captura cuando aparece un dígito (siguiente transacción, fechas, refs)
        m = re.search(r'Nominativo\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]+?)(?=\s*\d)', bloque_norm, re.IGNORECASE)
        if m:
            nt = re.sub(r'\s+', ' ', m.group(1)).strip()
            if len(nt) > 3:
                nombre = nt

    if prefijo not in ['VB', 'C5', 'BD', 'JD', 'AJ', 'DD']:
        ci_found = buscar_ci_general(bloque_original, bloque)
        if ci_found:
            ci = ci_found

    if not nombre:
        m = re.search(r'NOMBRE\s*[:=]\s*([^|]+?)(?:\s*\||\s*CI\s*[:=]\s*\d{11}|$)', bloque_original, re.IGNORECASE)
        if m:
            nt = m.group(1).strip()
            if not re.search(r'\d{7,}', nt) and len(nt) > 3:
                nombre = nt
        if not nombre:
            m = re.search(r'ORDENANTE\s*NOM\s*BRE\s*[:=]\s*([^|]+)', bloque_original, re.IGNORECASE)
            if m:
                nombre = m.group(1).strip()

    if nombre:
        nombre = re.sub(r'[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.\-]', ' ', nombre)
        nombre = re.sub(r'\s+', ' ', nombre).strip()
        for patron, reemplazo in CORRECCIONES:
            nombre = re.sub(patron, reemplazo, nombre, flags=re.IGNORECASE)
        nombre = re.sub(r'\s+', ' ', nombre).strip()
        palabras = nombre.split()
        resultado = []
        for p in palabras:
            if p.lower() in ['de', 'del', 'la', 'las', 'los', 'y', 'e']:
                resultado.append(p.lower())
            else:
                resultado.append(p.capitalize())
        nombre = ' '.join(resultado)
        if len(nombre.split()) < 2:
            nombre = ""

    return nombre, ci


# ─── Procesamiento del archivo ────────────────────────────────────────────────
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

    # PATRON generalizado: no depende de prefijos hardcodeados.
    # El único filtro de tipo es el "Cr" al final de línea.
    patron = re.compile(
        r'(\d{1,2}/\d{1,2}/\d{4})\s+'   # fecha d/m/yyyy sin ceros
        r'([A-Z0-9]{4,})\s+'               # ref_corriente (cualquier alfanumérico ≥4)
        r'([A-Z0-9][A-Z0-9]{2,})\s+'       # ref_origen (alfanumérico ≥3, cubre 98xx también)
        r'[^\r\n]*?'                       # observaciones (lazy)
        r'\s+(\d+\.\d{2})\s+'          # importe
        r'(Cr)\b',                          # tipo = Cr ÚNICAMENTE
        re.IGNORECASE
    )

    matches = list(patron.finditer(contenido))
    transacciones = []

    for i, match in enumerate(matches, 1):
        fecha        = match.group(1)
        ref_origen   = match.group(3)
        importe_str  = match.group(4).replace(',', '')
        tipo         = 'CR'

        try:
            importe = float(importe_str)
        except:
            importe = 0.0

        prefijo_temp = ref_origen[:2].upper() if len(ref_origen) >= 2 else ref_origen
        if prefijo_temp in ['VB', 'BD', 'JD', 'C5'] and i < len(matches):
            fin = matches[i].start()
        else:
            fin = min(len(contenido), match.end() + 2000)

        bloque = contenido[match.start():fin]
        nombre, ci = extraer_nombre_ci_simple(bloque, ref_origen)
        prefijo = ref_origen[:2].upper() if len(ref_origen) >= 2 else ref_origen
        
        if prefijo in ['BD']:
            continue  # Salta esta transacción y no la procesa

        if prefijo in ['VB', 'BD', 'JD', 'C5'] and i < len(matches):
            fin = matches[i].start()
        else:
            fin = min(len(contenido), match.end() + 2000)

        bloque = contenido[match.start():fin]
        nombre, ci = extraer_nombre_ci_simple(bloque, ref_origen)
        
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

    archivo_txt = sys.argv[1]
    borrar_existentes = '--borrar' in sys.argv

    if not os.path.exists(archivo_txt):
        print(json.dumps({'ok': False, 'error': f'Archivo no encontrado: {archivo_txt}'}))
        sys.exit(1)

    try:
        transacciones, chars = procesar_archivo(archivo_txt)

        if not transacciones:
            print(json.dumps({'ok': False, 'error': 'No se encontraron transacciones en el archivo'}))
            sys.exit(1)

        # Crear tabla y guardar
        crear_tabla_postgres()
        filas_insertadas = guardar_en_postgres(transacciones, borrar_existentes)

        # Estadísticas
        creditos   = transacciones  # solo CR
        con_nombre = sum(1 for t in transacciones if t['nombre'])
        con_ci     = sum(1 for t in transacciones if t['ci'])

        stats_prefijos = defaultdict(lambda: {'total': 0, 'con_nombre': 0, 'con_ci': 0})
        for t in transacciones:
            p = t['prefijo']
            stats_prefijos[p]['total'] += 1
            if t['nombre']: stats_prefijos[p]['con_nombre'] += 1
            if t['ci']:     stats_prefijos[p]['con_ci']     += 1

        result = {
            'ok':               True,
            'total':            len(transacciones),
            'insertadas':       filas_insertadas,
            'duplicadas':       len(transacciones) - max(filas_insertadas, 0),
            'con_nombre':       con_nombre,
            'con_ci':           con_ci,
            'total_creditos':   sum(t['importe'] for t in creditos),
            'num_creditos':     len(creditos),
            'stats_prefijos':   dict(stats_prefijos),
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()