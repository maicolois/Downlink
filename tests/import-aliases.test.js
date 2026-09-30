import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MP3_QUALITIES } from '@/shared/mp3-qualities.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const excludedDirectories = new Set([
  '.git', 'artifacts', 'bin', 'downloads', 'node_modules', 'Vendor', 'python-packages',
]);
const staticRelativeImport = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](?:\.{1,2}\/|\/)/;
const dynamicRelativeImport = /\bimport\s*\(\s*['"](?:\.{1,2}\/|\/)/;

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excludedDirectories.has(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(entryPath);
    return /\.(?:m?js)$/i.test(entry.name) ? [entryPath] : [];
  });
}

test('resolves the project-root alias in Node', () => {
  assert.ok(MP3_QUALITIES.length > 0);
});

test('keeps internal JavaScript imports on the project-root alias', () => {
  const violations = javascriptFiles(projectRoot).flatMap(filePath => {
    const source = fs.readFileSync(filePath, 'utf8');
    return staticRelativeImport.test(source) || dynamicRelativeImport.test(source)
      ? [path.relative(projectRoot, filePath)]
      : [];
  });

  assert.deepEqual(violations, []);
});
