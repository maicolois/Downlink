const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function isTransientFetchError(error) {
  return error instanceof TypeError || error?.name === 'TypeError';
}

export async function fetchWithRetry(
  input,
  init,
  { fetchImpl = globalThis.fetch, retries = 1, retryDelayMs = 300, waitImpl = wait } = {},
) {
  let attemptsRemaining = Math.max(0, Math.floor(Number(retries) || 0));

  while (true) {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      if (!isTransientFetchError(error) || attemptsRemaining === 0) throw error;
      attemptsRemaining -= 1;
      await waitImpl(retryDelayMs);
    }
  }
}
