export interface RetryOptions {
  maxRetries?: number; // default: 5
  initialWaitMs?: number; // default: 1000
  maxWaitMs?: number; // default: 32000
  jitterMs?: number; // default: 500
}

/**
 * Executes a fetch request with exponential backoff and jitter.
 * Automatically retries on HTTP 429 (rate limit) and 5xx (server errors),
 * and honors the Retry-After response header when present.
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 5;
  const initialWaitMs = options?.initialWaitMs ?? 1000;
  const maxWaitMs = options?.maxWaitMs ?? 32000;
  const jitterMs = options?.jitterMs ?? 500;

  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(url, init);

      // Check for rate limiting (429) or transient server errors (5xx)
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);

      if (isRetryable && attempt < maxRetries) {
        attempt++;
        let waitMs = 0;

        // Honor Retry-After header (seconds or HTTP date string)
        const retryAfter = res.headers.get('retry-after') || res.headers.get('Retry-After');
        if (retryAfter) {
          const parsedSec = Number(retryAfter);
          if (!isNaN(parsedSec)) {
            waitMs = Math.max(0, parsedSec * 1000);
          } else {
            const parsedDate = Date.parse(retryAfter);
            if (!isNaN(parsedDate)) {
              waitMs = Math.max(0, parsedDate - Date.now());
            }
          }
        }

        // Fallback to exponential backoff with jitter
        if (waitMs <= 0) {
          const expDelay = Math.min(maxWaitMs, initialWaitMs * Math.pow(2, attempt - 1));
          const jitter = Math.random() * jitterMs;
          waitMs = expDelay + jitter;
        }

        console.warn(
          `[Drive API] Rate limit or server error (${res.status}). Retrying attempt ${attempt}/${maxRetries} after ${Math.round(waitMs)}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (isRetryable && attempt >= maxRetries) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(
          `Google Drive API request failed (${res.status}) after ${maxRetries} retries: ${bodyText}`
        );
      }

      return res;
    } catch (err: any) {
      if (err.message && err.message.includes(`after ${maxRetries} retries`)) {
        throw err;
      }

      // Handle transient network drops
      if (attempt < maxRetries) {
        attempt++;
        const expDelay = Math.min(maxWaitMs, initialWaitMs * Math.pow(2, attempt - 1));
        const jitter = Math.random() * jitterMs;
        const waitMs = expDelay + jitter;
        console.warn(
          `[Drive API] Network drop (${err.message}). Retrying attempt ${attempt}/${maxRetries} after ${Math.round(waitMs)}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      throw new Error(`Google Drive API network failure after ${maxRetries} retries: ${err.message}`);
    }
  }
}
