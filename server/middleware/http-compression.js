import compression from 'compression';

function compressionFilter(req, res) {
  // Converted media is already compressed and carries an exact Content-Length.
  if (req.path.startsWith('/api/file/')) return false;
  return compression.filter(req, res);
}

export function createHttpCompression() {
  return compression({ filter: compressionFilter, threshold: 1024 });
}
