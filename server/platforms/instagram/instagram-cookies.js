import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STATIC_DIRECTORIES = ['public', 'shared', 'downloads']
  .map(directory => path.resolve(PROJECT_ROOT, directory));

function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function resolveExistingPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

/** Only use an explicitly configured cookie file, never a browser's session. */
export function getInstagramCookieArgs(cookiesFile) {
  if (cookiesFile == null || cookiesFile === '') return [];
  try {
    if (typeof cookiesFile !== 'string' || !cookiesFile.trim()) throw new Error();
    const configuredPath = path.resolve(cookiesFile.trim());
    const realPath = fs.realpathSync(configuredPath);
    if (!fs.statSync(realPath).isFile()) throw new Error();

    // Check both names: a link in a public directory must not expose a private file,
    // and a private link must not point to a file already served by the application.
    for (const directory of STATIC_DIRECTORIES) {
      const realDirectory = resolveExistingPath(directory);
      if (isInside(directory, configuredPath) || isInside(realDirectory, realPath)) {
        throw new Error();
      }
    }
    // yt-dlp reads and saves its cookie jar when extraction finishes.
    fs.accessSync(realPath, fs.constants.R_OK | fs.constants.W_OK);
    return ['--cookies', realPath];
  } catch {
    const error = new Error('Configura INSTAGRAM_COOKIES_FILE con un archivo de cookies legible y escribible, fuera de las carpetas públicas de la aplicación.');
    error.code = 'INSTAGRAM_COOKIES_INVALID';
    throw error;
  }
}
