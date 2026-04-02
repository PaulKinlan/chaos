/**
 * WASM Tool Runtime Manager
 *
 * Spawns Web Workers for WASM execution, enforces timeouts,
 * and returns results. Each execution gets a fresh worker for isolation.
 */

import type {
  WasmExecutionResult,
  WasmWorkerRequest,
  WasmWorkerResponse,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Execute a WASM binary in an isolated Web Worker.
 *
 * Spawns a new worker per execution, passes the WASM binary + input
 * via postMessage (transferable), enforces a timeout, and cleans up
 * the worker after completion.
 */
export async function executeWasm(
  wasmBinary: ArrayBuffer,
  input: string,
  options?: { timeoutMs?: number; memoryLimitMB?: number },
): Promise<WasmExecutionResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Create a fresh worker for this execution
  const worker = new Worker(
    new URL('./worker.js', import.meta.url),
    { type: 'module' },
  );

  const requestId = crypto.randomUUID();

  try {
    const result = await Promise.race([
      // Execution promise
      new Promise<WasmExecutionResult>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<WasmWorkerResponse>) => {
          const response = event.data;
          if (response.id !== requestId) return;

          if (response.error) {
            reject(new Error(response.error));
          } else if (response.result) {
            resolve(response.result);
          } else {
            reject(new Error('Worker returned empty response'));
          }
        };

        worker.onerror = (event) => {
          reject(new Error(`Worker error: ${event.message}`));
        };

        // Send the WASM binary as a transferable for zero-copy transfer
        const binaryCopy = wasmBinary.slice(0);
        const request: WasmWorkerRequest = {
          id: requestId,
          wasmBinary: binaryCopy,
          input,
          args: [],
        };
        worker.postMessage(request, [binaryCopy]);
      }),

      // Timeout promise
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`WASM execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    return result;
  } finally {
    // Always terminate the worker to free resources
    worker.terminate();
  }
}
