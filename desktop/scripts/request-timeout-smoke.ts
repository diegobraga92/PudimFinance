/**
 * Backend-free smoke test for the API request timeout.
 *
 * A black-holed server must not keep the app's startup gate in Loading forever.
 * The request layer should abort the fetch and expose the same network error
 * used by the offline-first API fallbacks.
 */

const localStorageValues = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageValues.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageValues.delete(key);
  },
  clear: () => localStorageValues.clear(),
  key: (index: number) => Array.from(localStorageValues.keys())[index] ?? null,
  get length() {
    return localStorageValues.size;
  },
};

import {
  ApiError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  isNetworkError,
  request,
} from '../src/lib/request';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let aborted = false;

  try {
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          aborted = true;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });

    const startedAt = Date.now();
    let failure: unknown;
    try {
      await request('/health', { withAuth: false, timeoutMs: 25 });
    } catch (error) {
      failure = error;
    }
    const elapsedMs = Date.now() - startedAt;

    assert(failure instanceof ApiError && failure.status === 0, 'timeout becomes ApiError status 0');
    assert(isNetworkError(failure), 'timeout is recognized as a network error');
    assert(aborted, 'timed-out fetch receives an abort signal');
    assert(elapsedMs < 1_000, `timeout settles promptly (${elapsedMs}ms)`);
    assert(DEFAULT_REQUEST_TIMEOUT_MS <= 10_000, 'default timeout is bounded below 10 seconds');

    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const response = await request<{ ok: boolean }>('/health', {
      withAuth: false,
      timeoutMs: 25,
    });
    assert(response.ok, 'successful requests still resolve normally');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});