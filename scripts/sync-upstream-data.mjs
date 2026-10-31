#!/usr/bin/env node
/**
 * Script de Sincronización Híbrida de Datos Académicos USM
 *
 * Descarga y verifica la integridad (JSON válido + hash MD5) de los catálogos
 * pre-compilados desde el repositorio upstream `AlvinIsCrack/horario-usm`
 * hacia `public/data/`.
 *
 * Si algún archivo no ha cambiado, se omite su reescritura.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data');

const UPSTREAM_BASE =
  'https://raw.githubusercontent.com/AlvinIsCrack/horario-usm/main/src/lib/data';

const FILES_TO_SYNC = [
  'metadata.json',
  'horario_asignaturas.json',
  'planes_carreras.json',
  'programas_academicos.json',
  'professors_view.json',
];

function computeMd5(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function syncFile(filename) {
  const url = `${UPSTREAM_BASE}/${filename}`;
  const destPath = path.join(DATA_DIR, filename);

  console.log(`📡 Descargando ${filename}...`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'USM-Malla-Grade-Solver-Sync/1.1',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} al descargar ${url}`);
  }

  const rawText = await response.text();

  // Validar que sea JSON íntegro antes de tocar disco
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`El archivo descargado ${filename} no es un JSON válido: ${err.message}`);
  }

  // Validación de esquema e invariantes del dataset
  if (filename === 'planes_carreras.json') {
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`planes_carreras.json debe ser un array no vacío de carreras`);
    }
    const sample = parsed[0];
    if (!sample.código || !sample.nombre || !sample.sede) {
      throw new Error(`planes_carreras.json no contiene la estructura esperada (código, nombre, sede)`);
    }
  } else if (filename === 'horario_asignaturas.json') {
    if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length === 0) {
      throw new Error(`horario_asignaturas.json debe ser un objeto no vacío con sedes`);
    }
  } else if (filename === 'professors_view.json' || filename === 'metadata.json') {
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`${filename} debe ser un objeto JSON válido`);
    }
  }

  // Serializar de forma compacta para ahorrar espacio en el repositorio y acelerar la carga
  const serialized = JSON.stringify(parsed);
  const newHash = computeMd5(serialized);

  if (fs.existsSync(destPath)) {
    const existingContent = fs.readFileSync(destPath, 'utf-8');
    const oldHash = computeMd5(existingContent);
    if (oldHash === newHash) {
      console.log(`⏭️  [SIN CAMBIOS] ${filename} (MD5: ${newHash.slice(0, 8)})`);
      return false;
    }
  }

  const tmpPath = `${destPath}.tmp`;
  fs.writeFileSync(tmpPath, serialized, 'utf-8');
  fs.renameSync(tmpPath, destPath);
  const sizeKb = (Buffer.byteLength(serialized, 'utf-8') / 1024).toFixed(1);
  console.log(`✅ [ACTUALIZADO] ${filename} (${sizeKb} KB, MD5: ${newHash.slice(0, 8)})`);
  return true;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let updatedCount = 0;
  for (const filename of FILES_TO_SYNC) {
    try {
      const changed = await syncFile(filename);
      if (changed) updatedCount++;
    } catch (error) {
      console.error(`❌ Error sincronizando ${filename}:`, error.message);
      process.exitCode = 1;
    }
  }

  console.log(`\n✨ Sincronización finalizada. Archivos modificados: ${updatedCount}/${FILES_TO_SYNC.length}`);
}

main();
