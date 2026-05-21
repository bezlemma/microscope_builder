/**
 * Fetches and instantiates the reverse_trace_kernel.wasm module, then registers it
 * on `globalThis.__MICROSCOPE_REVERSE_TRACE_WASM__` so that `reverseTraceHost.createDefaultReverseTracerBackend`
 * picks up the Rust kernel via `readRegisteredReverseTracerWasmModule`.
 *
 * Safe to call from both the main thread and Web Workers.  Results are cached,
 * so repeated calls resolve to the same module.
 */
import type { ReverseTracerWasmModule, ReverseTracerWasmExports } from './reverseTraceWasmBackend';
import { validateReverseTracerWasmModule } from './reverseTraceWasmBackend';

type WasmRegistry = typeof globalThis & { __MICROSCOPE_REVERSE_TRACE_WASM__?: ReverseTracerWasmModule };

let loadPromise: Promise<ReverseTracerWasmModule | null> | null = null;

/** Hard-coded public path (served by Vite under `base`). */
function kernelUrl(): string {
    const base = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : '/';
    return `${base.replace(/\/$/, '')}/reverse_trace_kernel.wasm`;
}

export async function ensureReverseTracerWasmLoaded(): Promise<ReverseTracerWasmModule | null> {
    const registry = globalThis as WasmRegistry;
    if (registry.__MICROSCOPE_REVERSE_TRACE_WASM__) return registry.__MICROSCOPE_REVERSE_TRACE_WASM__;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const url = kernelUrl();
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`[reverseTrace] kernel fetch failed: ${response.status} ${url}`);
                return null;
            }
            const bytes = await response.arrayBuffer();
            const instantiated = await WebAssembly.instantiate(bytes, {});
            const instance = instantiated.instance;
            const exports = instance.exports as WebAssembly.Exports & ReverseTracerWasmExports;
            const module: ReverseTracerWasmModule = {
                exports,
                memory: exports.memory as WebAssembly.Memory | undefined,
            };
            const validation = validateReverseTracerWasmModule(module);
            if (!validation.ok) {
                console.warn(`[reverseTrace] wasm validation failed: ${validation.reason}`);
                return null;
            }
            (globalThis as WasmRegistry).__MICROSCOPE_REVERSE_TRACE_WASM__ = module;
            return module;
        } catch (err) {
            console.warn('[reverseTrace] failed to load wasm kernel', err);
            return null;
        }
    })();

    return loadPromise;
}
