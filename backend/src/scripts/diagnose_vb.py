#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diagnose_vb.py
==============
Diagnostic script to inspect VB transactions in the BANDEC PDF.
1. Runs pdf_to_txt_v2.py pipeline and shows lines with VB/Ejecutado/Ordenante
2. Shows raw pdfplumber output for lines containing "Ejecutado"
"""

import sys
import io
import re
import pdfplumber

# Force UTF-8 stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
elif hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PDF_PATH = r"C:\Users\Felix\Documents\Proyecto\Estados de cuenta y Productos\Banca Remota - BANDEC del 1 al 28 febrero 2025.pdf"

# Add the scripts dir to path so we can import pdf_to_txt_v2
sys.path.insert(0, r"C:\Users\Felix\Documents\Proyecto\proyecto_final\proyecto_final\backend\src\scripts")
import pdf_to_txt_v2 as v2

# ─── PART 1: Run the pipeline and get TXT output ─────────────────────────────
print("=" * 80)
print("PART 1: PIPELINE TXT OUTPUT - lines with VB / Ejecutado / Ordenante")
print("=" * 80)

txt = v2.convert(PDF_PATH)
txt_lines = txt.splitlines()

# Column positions for ref_orig
COL_REF_ORIG = 27
COL_OBS      = 46

def show_context(lines, idx, before=5, after=5):
    start = max(0, idx - before)
    end   = min(len(lines), idx + after + 1)
    for i in range(start, end):
        marker = ">>>" if i == idx else "   "
        print(f"{marker} [{i:4d}] {lines[i]}")

# Find lines matching our criteria
# "VB" in ref_orig column: characters 27..45
vb_hits = []
exec_hits = []
orden_hits = []

for i, line in enumerate(txt_lines):
    ref_orig_field = line[COL_REF_ORIG:COL_OBS] if len(line) > COL_REF_ORIG else ""
    obs_field      = line[COL_OBS:] if len(line) > COL_OBS else ""
    full            = line

    if re.search(r'\bVB\b', ref_orig_field, re.IGNORECASE):
        vb_hits.append(i)
    if 'Ejecutado' in full:
        exec_hits.append(i)
    if 'Ordenante' in full:
        orden_hits.append(i)

print(f"\nFound {len(vb_hits)} lines with 'VB' in ref_orig column")
print(f"Found {len(exec_hits)} lines with 'Ejecutado'")
print(f"Found {len(orden_hits)} lines with 'Ordenante'")

if vb_hits:
    print("\n--- Lines with VB in ref_orig (with context) ---")
    seen = set()
    for idx in vb_hits:
        start = max(0, idx - 5)
        end   = min(len(txt_lines), idx + 6)
        block = (start, end)
        if block not in seen:
            seen.add(block)
            show_context(txt_lines, idx, 5, 5)
            print()

if exec_hits:
    print("\n--- Lines with 'Ejecutado' (with context) ---")
    seen = set()
    for idx in exec_hits:
        start = max(0, idx - 5)
        end   = min(len(txt_lines), idx + 6)
        block = (start, end)
        if block not in seen:
            seen.add(block)
            show_context(txt_lines, idx, 5, 5)
            print()

if orden_hits:
    print("\n--- Lines with 'Ordenante' (with context) ---")
    seen = set()
    for idx in orden_hits:
        start = max(0, idx - 5)
        end   = min(len(txt_lines), idx + 6)
        block = (start, end)
        if block not in seen:
            seen.add(block)
            show_context(txt_lines, idx, 5, 5)
            print()

# ─── PART 2: Raw pdfplumber lines containing "Ejecutado" ─────────────────────
print()
print("=" * 80)
print("PART 2: RAW pdfplumber lines containing 'Ejecutado'")
print("=" * 80)

with pdfplumber.open(PDF_PATH) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ''
        raw_lines = text.split('\n')
        for i, raw in enumerate(raw_lines):
            if 'Ejecutado' in raw:
                print(f"\n[Page {page_num}, line {i}]")
                # Show context: 3 before and 3 after
                start = max(0, i - 3)
                end   = min(len(raw_lines), i + 4)
                for j in range(start, end):
                    marker = ">>>" if j == i else "   "
                    print(f"  {marker} [{j}] {repr(raw_lines[j])}")

# ─── PART 3: Also show raw lines containing "VB" ─────────────────────────────
print()
print("=" * 80)
print("PART 3: RAW pdfplumber lines containing 'VB'")
print("=" * 80)

with pdfplumber.open(PDF_PATH) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ''
        raw_lines = text.split('\n')
        for i, raw in enumerate(raw_lines):
            stripped = raw.strip()
            # Look for VB as a token (not inside longer words)
            if re.search(r'\bVB\b', stripped):
                print(f"\n[Page {page_num}, line {i}]")
                start = max(0, i - 3)
                end   = min(len(raw_lines), i + 4)
                for j in range(start, end):
                    marker = ">>>" if j == i else "   "
                    print(f"  {marker} [{j}] {repr(raw_lines[j])}")

print("\n=== DONE ===")
