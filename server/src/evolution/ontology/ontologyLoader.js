import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONTOLOGY_PATH = path.join(__dirname, 'characteristics.json');

let cache = null;

export function loadOntologyCharacteristics() {
  if (cache) return cache;
  const raw = fs.readFileSync(ONTOLOGY_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Number.isInteger(parsed?.feature_dim) || parsed.feature_dim <= 0) {
    throw new Error('Ontology characteristics: invalid feature_dim');
  }
  if (!Array.isArray(parsed?.features) || parsed.features.length !== parsed.feature_dim) {
    throw new Error('Ontology characteristics: features[] length must match feature_dim');
  }
  cache = parsed;
  return cache;
}

export function getOntologyFeatureDim() {
  return loadOntologyCharacteristics().feature_dim;
}

export function getOntologyToneLabels() {
  const cfg = loadOntologyCharacteristics();
  return Array.isArray(cfg.tones) ? cfg.tones.slice() : [];
}

