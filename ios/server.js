import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));

export function mountIosAssets(app) {
  // Keep the existing public URLs: /sw.js must control the shared root page,
  // and installed apps keep their manifest identity and saved downloads.
  app.use(express.static(publicDirectory, {
    index: false,
    setHeaders(res, filePath) {
      if (['sw.js', 'manifest.webmanifest'].includes(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
}
