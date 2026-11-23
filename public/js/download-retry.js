// Check the job before retrying: the previous request may have reached the
// server even if the browser lost its response.
export async function retryRetainedDownload(jobId, { request, headers = {} }) {
  const statusResponse = await request(`/api/status/${jobId}`, { cache: 'no-store' });
  if (!statusResponse.ok) {
    throw Object.assign(new Error('No se pudo consultar la descarga conservada.'), {
      permanent: statusResponse.status === 404,
    });
  }
  const status = await statusResponse.json();
  if (['starting', 'downloading', 'converting', 'ready'].includes(status.status)) return;
  if (status.status !== 'error' || !status.retryable) {
    throw Object.assign(new Error(status.error || 'Esta descarga ya no se puede reintentar.'), { permanent: true });
  }
  const retryResponse = await request(`/api/retry/${jobId}`, { method: 'POST', headers });
  if (!retryResponse.ok) {
    const body = await retryResponse.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'No se pudo reintentar la descarga.'), {
      permanent: retryResponse.status === 404 || retryResponse.status === 410,
    });
  }
}
