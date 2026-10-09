#!/usr/bin/env node
/**
 * Убирает ** и инлайн ` в тексте вне блоков ``` ... ```
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2).filter((a) => a !== '--write');
const doWrite = process.argv.includes('--write');
const inputPath = args[0];

if (!inputPath) {
  console.error(
    'Usage: node tools/scripts/strip-md-for-word.mjs <file.md> [--write]\n' +
      '  Default: print to stdout. --write: overwrite (backup recommended).'
  );
  process.exit(1);
}

const abs = path.resolve(inputPath);
if (!fs.existsSync(abs)) {
  console.error('File not found:', abs);
  process.exit(1);
}

const content = fs.readFileSync(abs, 'utf8');

function stripProseLine(line) {
  let t = line;
  let prev;
  do {
    prev = t;
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  } while (t !== prev);
  t = t.replace(/`([^`\n]+)`/g, '$1');
  return t;
}

const lines = content.split(/\r?\n/);
let inFence = false;
const out = [];
for (const line of lines) {
  const fenceMatch = /^\s*(`{3,})(.*)$/.exec(line);
  if (fenceMatch && fenceMatch[1].length >= 3) {
    inFence = !inFence;
    out.push(line);
    continue;
  }
  out.push(inFence ? line : stripProseLine(line));
}

const result = out.join('\n');
if (doWrite) {
  fs.writeFileSync(abs, result, 'utf8');
  console.error('Written:', abs);
} else {
  process.stdout.write(result);
}
