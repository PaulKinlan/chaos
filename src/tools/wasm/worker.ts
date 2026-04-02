/**
 * WASM Sandbox Worker
 *
 * Web Worker that executes WASM modules in isolation with a minimal
 * WASI shim. Ported from co-do's wasm-worker.ts, simplified for CHAOS.
 *
 * Security: no DOM access, no network APIs exposed to WASM modules,
 * terminable via Worker.terminate() from the main thread.
 */

import type { WasmWorkerRequest, WasmWorkerResponse, WasmExecutionResult } from './types.js';

// ── WASI constants ──

const WASI_ERRNO = {
  SUCCESS: 0,
  BADF: 8,
  NOSYS: 52,
  PERM: 63,
} as const;

const WASI_FILETYPE = {
  CHARACTER_DEVICE: 2,
} as const;

const WASI_RIGHTS = {
  FD_READ: BigInt(1) << BigInt(1),
  FD_WRITE: BigInt(1) << BigInt(6),
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ── Minimal stdout/stderr capture ──

class OutputCapture {
  private stdoutChunks: Uint8Array[] = [];
  private stderrChunks: Uint8Array[] = [];

  writeStdout(data: Uint8Array): void {
    this.stdoutChunks.push(data.slice());
  }

  writeStderr(data: Uint8Array): void {
    this.stderrChunks.push(data.slice());
  }

  getStdout(): string {
    return textDecoder.decode(this.combine(this.stdoutChunks));
  }

  getStderr(): string {
    return textDecoder.decode(this.combine(this.stderrChunks));
  }

  private combine(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

// ── WASM execution ──

async function executeWasmModule(
  wasmBinary: ArrayBuffer,
  args: string[],
): Promise<WasmExecutionResult> {
  const output = new OutputCapture();
  let memory: WebAssembly.Memory | null = null;
  let exitCode = 0;
  let hasExited = false;

  // ── Minimal WASI shim ──

  const wasi: WebAssembly.Imports = {
    wasi_snapshot_preview1: {
      // Process
      proc_exit(code: number): void {
        exitCode = code;
        hasExited = true;
        throw new Error(`proc_exit(${code})`);
      },
      sched_yield: () => WASI_ERRNO.SUCCESS,

      // Arguments
      args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
        const view = new DataView(memory!.buffer);
        view.setUint32(argcPtr, args.length, true);
        let totalSize = 0;
        for (const arg of args) {
          totalSize += textEncoder.encode(arg).length + 1;
        }
        view.setUint32(argvBufSizePtr, totalSize, true);
        return WASI_ERRNO.SUCCESS;
      },

      args_get(argvPtr: number, argvBufPtr: number): number {
        const view = new DataView(memory!.buffer);
        const mem = new Uint8Array(memory!.buffer);
        let bufOffset = argvBufPtr;
        for (let i = 0; i < args.length; i++) {
          view.setUint32(argvPtr + i * 4, bufOffset, true);
          const encoded = textEncoder.encode(args[i]!);
          mem.set(encoded, bufOffset);
          mem[bufOffset + encoded.length] = 0;
          bufOffset += encoded.length + 1;
        }
        return WASI_ERRNO.SUCCESS;
      },

      // Environment (empty)
      environ_sizes_get(countPtr: number, sizePtr: number): number {
        const view = new DataView(memory!.buffer);
        view.setUint32(countPtr, 0, true);
        view.setUint32(sizePtr, 0, true);
        return WASI_ERRNO.SUCCESS;
      },
      environ_get: () => WASI_ERRNO.SUCCESS,

      // File descriptors - stdout/stderr only
      fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
        const view = new DataView(memory!.buffer);
        const mem = new Uint8Array(memory!.buffer);
        let totalWritten = 0;

        for (let i = 0; i < iovsLen; i++) {
          const bufPtr = view.getUint32(iovsPtr + i * 8, true);
          const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
          const data = mem.slice(bufPtr, bufPtr + bufLen);

          if (fd === 1) {
            output.writeStdout(data);
            totalWritten += data.length;
          } else if (fd === 2) {
            output.writeStderr(data);
            totalWritten += data.length;
          } else {
            return WASI_ERRNO.BADF;
          }
        }

        view.setUint32(nwrittenPtr, totalWritten, true);
        return WASI_ERRNO.SUCCESS;
      },

      fd_read: () => WASI_ERRNO.NOSYS,
      fd_close: (fd: number) => fd < 3 ? WASI_ERRNO.SUCCESS : WASI_ERRNO.BADF,
      fd_seek: () => WASI_ERRNO.NOSYS,

      fd_fdstat_get(fd: number, statPtr: number): number {
        const view = new DataView(memory!.buffer);
        view.setUint8(statPtr, WASI_FILETYPE.CHARACTER_DEVICE);
        view.setUint16(statPtr + 2, 0, true);
        let rights: bigint;
        if (fd === 0) rights = WASI_RIGHTS.FD_READ;
        else if (fd === 1 || fd === 2) rights = WASI_RIGHTS.FD_WRITE;
        else rights = WASI_RIGHTS.FD_READ | WASI_RIGHTS.FD_WRITE;
        view.setBigUint64(statPtr + 8, rights, true);
        view.setBigUint64(statPtr + 16, rights, true);
        return WASI_ERRNO.SUCCESS;
      },

      fd_fdstat_set_flags: () => WASI_ERRNO.SUCCESS,
      fd_prestat_get: () => WASI_ERRNO.BADF,
      fd_prestat_dir_name: () => WASI_ERRNO.BADF,

      // Clock
      clock_time_get(_clockId: number, _precision: bigint, timePtr: number): number {
        const view = new DataView(memory!.buffer);
        const now = BigInt(Date.now()) * BigInt(1000000);
        view.setBigUint64(timePtr, now, true);
        return WASI_ERRNO.SUCCESS;
      },
      clock_res_get(_clockId: number, resPtr: number): number {
        const view = new DataView(memory!.buffer);
        view.setBigUint64(resPtr, BigInt(1000000), true);
        return WASI_ERRNO.SUCCESS;
      },

      // Random
      random_get(bufPtr: number, bufLen: number): number {
        const mem = new Uint8Array(memory!.buffer);
        const randomBytes = new Uint8Array(bufLen);
        crypto.getRandomValues(randomBytes);
        mem.set(randomBytes, bufPtr);
        return WASI_ERRNO.SUCCESS;
      },

      // Stubs
      fd_advise: () => WASI_ERRNO.SUCCESS,
      fd_allocate: () => WASI_ERRNO.NOSYS,
      fd_datasync: () => WASI_ERRNO.SUCCESS,
      fd_sync: () => WASI_ERRNO.SUCCESS,
      fd_tell: () => WASI_ERRNO.NOSYS,
      fd_filestat_get: () => WASI_ERRNO.NOSYS,
      fd_filestat_set_size: () => WASI_ERRNO.NOSYS,
      fd_filestat_set_times: () => WASI_ERRNO.NOSYS,
      fd_pread: () => WASI_ERRNO.NOSYS,
      fd_pwrite: () => WASI_ERRNO.NOSYS,
      fd_readdir: () => WASI_ERRNO.NOSYS,
      fd_renumber: () => WASI_ERRNO.NOSYS,
      fd_rights_get: () => WASI_ERRNO.NOSYS,
      path_open: () => WASI_ERRNO.NOSYS,
      path_filestat_get: () => WASI_ERRNO.NOSYS,
      path_create_directory: () => WASI_ERRNO.NOSYS,
      path_remove_directory: () => WASI_ERRNO.NOSYS,
      path_unlink_file: () => WASI_ERRNO.NOSYS,
      path_rename: () => WASI_ERRNO.NOSYS,
      path_filestat_set_times: () => WASI_ERRNO.NOSYS,
      path_link: () => WASI_ERRNO.NOSYS,
      path_readlink: () => WASI_ERRNO.NOSYS,
      path_symlink: () => WASI_ERRNO.NOSYS,
      poll_oneoff: () => WASI_ERRNO.NOSYS,

      // Networking: explicitly blocked
      sock_recv: () => WASI_ERRNO.PERM,
      sock_send: () => WASI_ERRNO.PERM,
      sock_shutdown: () => WASI_ERRNO.PERM,
      sock_accept: () => WASI_ERRNO.PERM,
    },
  };

  // Compile and instantiate
  const module = await WebAssembly.compile(wasmBinary);
  const instance = await WebAssembly.instantiate(module, wasi);

  // Get memory from exports
  const exportedMemory = instance.exports.memory as WebAssembly.Memory | undefined;
  if (exportedMemory) {
    memory = exportedMemory;
  } else {
    throw new Error('WASM module does not export memory');
  }

  // Run _start
  const start = instance.exports._start as (() => void) | undefined;
  if (!start) {
    throw new Error('WASM module does not export _start function');
  }

  try {
    start();
  } catch (error) {
    if (!hasExited) {
      throw error;
    }
  }

  return {
    stdout: output.getStdout(),
    stderr: output.getStderr(),
    exitCode,
  };
}

// ── Worker message handler ──

self.onmessage = async (event: MessageEvent<WasmWorkerRequest>) => {
  const request = event.data;

  try {
    const result = await executeWasmModule(
      request.wasmBinary,
      ['tool', request.input],
    );

    const response: WasmWorkerResponse = {
      id: request.id,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const response: WasmWorkerResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
