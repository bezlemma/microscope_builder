/**
 * Fetches and instantiates the solver3_kernel.wasm module, then registers it
 * on `globalThis.__MICROSCOPE_SOLVER3_WASM__` so that `solver3Host.createDefaultSolver3Backend`
 * picks up the Rust kernel via `readRegisteredSolver3WasmModule`.
 *
 * Safe to call from both the main thread and Web Workers.  Results are cached,
 * so repeated calls resolve to the same module.
 */
import type { Solver3WasmModule, Solver3WasmExports } from './solver3WasmBackend';
import { validateSolver3WasmModule } from './solver3WasmBackend';

type WasmRegistry = typeof globalThis & { __MICROSCOPE_SOLVER3_WASM__?: Solver3WasmModule };

let loadPromise: Promise<Solver3WasmModule | null> | null = null;

/** Hard-coded public path (served by Vite under `base`). */
function kernelUrl(): string {
    const base = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : '/';
    return `${base.replace(/\/$/, '')}/solver3_kernel.wasm`;
}

export async function ensureSolver3WasmLoaded(): Promise<Solver3WasmModule | null> {
    const registry = globalThis as WasmRegistry;
    if (registry.__MICROSCOPE_SOLVER3_WASM__) return registry.__MICROSCOPE_SOLVER3_WASM__;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const url = kernelUrl();
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`[solver3] kernel fetch failed: ${response.status} ${url}`);
                return null;
            }
            const bytes = await response.arrayBuffer();
            const instantiated = await WebAssembly.instantiate(bytes, {});
            const instance = instantiated.instance;
            const module: Solver3WasmModule = {
                exports: instance.exports as unknown as Solver3WasmExports,
                memory: instance.exports.memory as WebAssembly.Memory | undefined,
            };
            const validation = validateSolver3WasmModule(module);
            if (!validation.ok) {
                console.warn(`[solver3] wasm validation failed: ${validation.reason}`);
                return null;
            }
            (globalThis as WasmRegistry).__MICROSCOPE_SOLVER3_WASM__ = module;
            const ctx = typeof (globalThis as typeof globalThis & { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined' ? 'worker' : 'main';
            console.log(`[solver3] wasm kernel loaded (${ctx}, abi=${module.exports.solver3_kernel_abi_version()})`);
            return module;
        } catch (err) {
            console.warn('[solver3] failed to load wasm kernel', err);
            return null;
        }
    })();

    return loadPromise;
}
