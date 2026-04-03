/**
 * FIX #6:  Validación de tamaño máximo de PDF (10 MB).
 * FIX #19: Timeout en scripts Python (60 segundos).
 */
const express  = require('express');
const router   = express.Router();
const { spawn, execSync } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');

const SCRIPTS_DIR = path.join(__dirname, '../scripts');
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const PYTHON_TIMEOUT_MS = 60_000;       // 60 segundos

const PDF_SCRIPTS = {
  v1: path.join(SCRIPTS_DIR, 'pdf_to_txt_v1.py'),
  v2: path.join(SCRIPTS_DIR, 'pdf_to_txt_v2.py'),
};
const GOD_SCRIPTS = {
  v1: path.join(SCRIPTS_DIR, 'god_extractor_v1.py'),
  v2: path.join(SCRIPTS_DIR, 'god_extractor_v2.py'),
};

function getPythonCmd() {
  const candidates = process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try { execSync(`${cmd} --version`, { stdio: 'ignore' }); return cmd; } catch {}
  }
  throw new Error('No se encontró Python instalado. Instala Python 3 y asegúrate de que esté en el PATH.');
}

let PYTHON_CMD;
try {
  PYTHON_CMD = getPythonCmd();
  console.log(`🐍 Python detectado: "${PYTHON_CMD}"`);
} catch (e) {
  console.error(`⚠️  ${e.message}`);
  PYTHON_CMD = 'python3';
}

// FIX #19: Helper con timeout
function runPython(args, timeoutMs = PYTHON_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_CMD, args);
    let stdout = '', stderr = '';

    // Timeout para evitar procesos colgados
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`El script Python excedió el tiempo límite de ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(`No se encontró el comando "${PYTHON_CMD}". Instala Python 3.`));
      } else {
        reject(err);
      }
    });
  });
}

// ─── POST /api/bandec/convert ─────────────────────────────────────────────
router.post('/convert', async (req, res) => {
  const { pdf_base64, filename, formato: formatoParam } = req.body;

  if (!pdf_base64) {
    return res.status(400).json({ error: 'Se requiere pdf_base64 en el body' });
  }

  // FIX #6: Validar tamaño del PDF antes de escribir en disco
  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdf_base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'pdf_base64 no es un base64 válido' });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return res.status(400).json({
      error: `El archivo excede el tamaño máximo permitido (${MAX_PDF_BYTES / 1024 / 1024} MB). Tamaño recibido: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`,
    });
  }

  if (pdfBuffer.length < 4 || pdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
    return res.status(400).json({ error: 'El archivo no es un PDF válido' });
  }

  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `bandec_upload_${Date.now()}.pdf`);
  const tmpTxt = path.join(tmpDir, `bandec_output_${Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpPdf, pdfBuffer);

    let formato = formatoParam;
    if (!formato || !['v1', 'v2'].includes(formato)) {
      const detect = await runPython([
        '-c',
        `import pdfplumber,re,sys
try:
  with pdfplumber.open(sys.argv[1]) as pdf:
    text=''.join(p.extract_text() or '' for p in pdf.pages[:2])
  if re.search(r'^\\d{1,2}/\\d{1,2}/\\d{2,4},\\s*\\d',text,re.MULTILINE):
    print('v2')
  elif re.search(r'\\b0[1-9]/0[1-9]/20\\d{2}\\b',text):
    print('v2')
  else:
    print('v1')
except:
  print('v1')`,
        tmpPdf,
      ], 15_000); // 15s para detección
      formato = detect.stdout.trim() === 'v2' ? 'v2' : 'v1';
      console.log(`📋 Formato auto-detectado: ${formato}`);
    }

    const pythonScript = PDF_SCRIPTS[formato];
    if (!pythonScript || !fs.existsSync(pythonScript)) {
      throw new Error(`Script no encontrado para formato "${formato}"`);
    }

    const { code, stderr } = await runPython([pythonScript, tmpPdf, tmpTxt]);
    if (code !== 0) throw new Error(`Python error (code ${code}): ${stderr}`);

    const encoding   = formato === 'v2' ? 'utf8' : 'latin1';
    const txtContent = fs.readFileSync(tmpTxt, { encoding });
    const lines      = txtContent.split('\n');
    const cantLine   = lines.find(l => l.startsWith('Cantidad de Movimientos:'));
    const cantidad   = cantLine ? cantLine.split(':')[1]?.trim() : '?';
    const titularLine = lines.find(l => l.startsWith('Titular:'));
    const titular     = titularLine ? titularLine.replace('Titular:', '').trim() : '';
    const outFilename = (filename || 'bandec').replace(/\.pdf$/i, '') + '.txt';

    res.json({ txt: txtContent, filename: outFilename, movimientos: cantidad, formato, titular });

  } catch (err) {
    console.error('Error converting PDF:', err.message);
    res.status(500).json({ error: 'Error al convertir el PDF: ' + err.message });
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
    try { fs.unlinkSync(tmpTxt); } catch {}
  }
});

// ─── POST /api/bandec/extract-to-db ──────────────────────────────────────
router.post('/extract-to-db', async (req, res) => {
  const { txt, borrar_existentes, formato = 'v1' } = req.body;

  if (!txt) {
    return res.status(400).json({ error: 'Se requiere el campo "txt" con el contenido del archivo' });
  }

  if (typeof txt !== 'string' || txt.length > 20 * 1024 * 1024) {
    return res.status(400).json({ error: 'El contenido de texto excede el límite de 20 MB' });
  }

  const godScript = GOD_SCRIPTS[formato] || GOD_SCRIPTS.v1;
  if (!fs.existsSync(godScript)) {
    return res.status(500).json({ error: `Script extractor no encontrado: ${godScript}` });
  }

  const encoding = formato === 'v2' ? 'utf8' : 'latin1';
  const tmpTxt   = path.join(os.tmpdir(), `bandec_extract_${Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpTxt, txt, { encoding });

    const args = [godScript, tmpTxt];
    if (borrar_existentes) args.push('--borrar');

    const { code, stdout, stderr } = await runPython(args);

    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      throw new Error(stderr || stdout || `Python exit code ${code}`);
    }

    if (result.ok) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error || 'Error en el extractor' });
    }

  } catch (err) {
    console.error('Error extract-to-db:', err.message);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  } finally {
    try { fs.unlinkSync(tmpTxt); } catch {}
  }
});


// ─── GET /api/bandec/titulares ────────────────────────────────────────────────
// Devuelve transferencias agrupadas por titular para un rango de fechas
// Query params: fecha_inicio (YYYY-MM-DD), fecha_fin (YYYY-MM-DD)
router.get('/titulares', async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;

  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Se requieren los parámetros fecha_inicio y fecha_fin' });
  }

  let pool;
  try {
    pool = require('../db/pool');
  } catch {
    return res.status(500).json({ error: 'No se pudo conectar a la base de datos' });
  }

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(titular), ''), '(Sin titular)') AS titular,
         COUNT(*)::int                                         AS num_transferencias,
         SUM(importe)::float                                  AS total_importe
       FROM transferencias
       WHERE fecha BETWEEN $1 AND $2
         AND tipo = 'CR'
       GROUP BY COALESCE(NULLIF(TRIM(titular), ''), '(Sin titular)')
       ORDER BY total_importe DESC`,
      [fecha_inicio, fecha_fin]
    );
    res.json({ titulares: result.rows });
  } catch (err) {
    console.error('Error al consultar titulares:', err.message);
    res.status(500).json({ error: 'Error al consultar la base de datos: ' + err.message });
  }
});

module.exports = router;