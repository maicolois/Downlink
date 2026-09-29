import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []]]
  : [['python3', []], ['python', []]];

const environment = { ...process.env };
const bundledPackages = resolve('ios/python-packages');
if (existsSync(bundledPackages)) {
  environment.PYTHONPATH = [bundledPackages, environment.PYTHONPATH].filter(Boolean).join(delimiter);
}

for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, '--version'], { stdio: 'ignore', env: environment });
  if (probe.status !== 0) continue;

  const result = spawnSync(command, [
    ...prefix,
    '-m', 'unittest', 'discover',
    '-s', 'ios/Tests',
    '-p', 'test_*.py',
  ], { stdio: 'inherit', env: environment });
  process.exit(result.status ?? 1);
}

console.error('No se encontró Python 3 para ejecutar las pruebas del motor iOS.');
process.exit(1);
