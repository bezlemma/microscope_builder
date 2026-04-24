import type { PackedTraceScene, Solver3PacketHeader } from './kernelPackets';
import { PACKED_SURFACE_PARAM_STRIDE, SOLVER3_KERNEL_ABI_VERSION } from './kernelPackets';
import type { PackedCameraSamples } from './solver3Sampling';
import type { PackedFirstHitHints } from './solver3FirstHitHints';
import type { Solver3WasmModule } from './solver3WasmBackend';

/**
 * Per-sample analytic-narrow-phase result from Rust.  The best supported hit
 * found by Rust's `solver3_analytic_narrow_phase`, already in the component's
 * LOCAL frame — ready to feed into a component's .interact() without re-doing
 * the intersect work.
 */
export interface AnalyticHit {
    /** Parametric distance along the world-space ray. NaN if no Rust hit. */
    t: number;
    /** Index into PackedTraceScene.componentIds; -1 = no hit; -2 = unsupported candidate seen (must fall back to JS). */
    componentIndex: number;
    /** Local-frame hit point. */
    localPoint: [number, number, number];
    /** Local-frame outward normal. */
    localNormal: [number, number, number];
    /** True if the ring of an annular component (Aperture) absorbed the ray. */
    isBlocked: boolean;
}

export interface PackedAnalyticHits {
    abiVersion: number;
    sampleCount: number;
    /** Raw output buffer, 8 f64 per sample (see Rust `solver3_analytic_narrow_phase`). */
    output: Float64Array;
}

function alignOffset(offset: number, alignment: number): number {
    return Math.ceil(offset / alignment) * alignment;
}

export function unpackAnalyticHit(packet: PackedAnalyticHits, sampleIndex: number): AnalyticHit {
    const base = sampleIndex * 8;
    const raw = packet.output[base];
    const compRaw = packet.output[base + 1];
    const isBlocked = raw < 0 && Number.isFinite(raw);
    const t = isBlocked ? -raw : raw;
    return {
        t,
        componentIndex: Number.isFinite(compRaw) ? (compRaw | 0) : -1,
        localPoint: [packet.output[base + 2], packet.output[base + 3], packet.output[base + 4]],
        localNormal: [packet.output[base + 5], packet.output[base + 6], packet.output[base + 7]],
        isBlocked,
    };
}

export function createPackedAnalyticHitsFromWasm(
    module: Solver3WasmModule,
    header: Solver3PacketHeader,
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    hints: PackedFirstHitHints,
): PackedAnalyticHits | null {
    if (!module.memory) return null;
    if (typeof module.exports.solver3_analytic_narrow_phase !== 'function') return null;
    if (typeof module.exports.solver3_surface_param_stride !== 'function') return null;
    if (module.exports.solver3_surface_param_stride() !== PACKED_SURFACE_PARAM_STRIDE) return null;

    const headerWords = 5;
    const compCount = tracePacket.componentKinds.length;
    const worldToLocalBytes = tracePacket.worldToLocalMatrices.length * Float64Array.BYTES_PER_ELEMENT;
    const localToWorldBytes = tracePacket.localToWorldMatrices.length * Float64Array.BYTES_PER_ELEMENT;
    const surfaceKindsBytes = compCount * Uint8Array.BYTES_PER_ELEMENT;
    const surfaceParamsBytes = tracePacket.surfaceParams.length * Float64Array.BYTES_PER_ELEMENT;
    const sampleScalarsBytes = cameraSamples.sampleScalars.length * Float64Array.BYTES_PER_ELEMENT;
    const candidateCountsBytes = hints.sampleCount * Uint8Array.BYTES_PER_ELEMENT;
    const candidateIndicesBytes = hints.sampleCount * hints.maxCandidates * Int32Array.BYTES_PER_ELEMENT;
    const outputBytes = cameraSamples.sampleCount * 8 * Float64Array.BYTES_PER_ELEMENT;

    const headerPtr = 0;
    const worldToLocalPtr = alignOffset(headerWords * Uint32Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
    const localToWorldPtr = alignOffset(worldToLocalPtr + worldToLocalBytes, Float64Array.BYTES_PER_ELEMENT);
    const surfaceKindsPtr = alignOffset(localToWorldPtr + localToWorldBytes, Uint8Array.BYTES_PER_ELEMENT);
    const surfaceParamsPtr = alignOffset(surfaceKindsPtr + surfaceKindsBytes, Float64Array.BYTES_PER_ELEMENT);
    const sampleScalarsPtr = alignOffset(surfaceParamsPtr + surfaceParamsBytes, Float64Array.BYTES_PER_ELEMENT);
    const candidateCountsPtr = alignOffset(sampleScalarsPtr + sampleScalarsBytes, Uint8Array.BYTES_PER_ELEMENT);
    const candidateIndicesPtr = alignOffset(candidateCountsPtr + candidateCountsBytes, Int32Array.BYTES_PER_ELEMENT);
    const outputPtr = alignOffset(candidateIndicesPtr + candidateIndicesBytes, Float64Array.BYTES_PER_ELEMENT);
    const totalBytes = outputPtr + outputBytes;

    const pagesNeeded = Math.ceil(totalBytes / 65536);
    const currentPages = module.memory.buffer.byteLength / 65536;
    if (pagesNeeded > currentPages) {
        module.memory.grow(pagesNeeded - currentPages);
    }

    new Uint32Array(module.memory.buffer, headerPtr, headerWords).set([
        header.abiVersion,
        header.traceComponentCount,
        header.beamBranchCount,
        header.beamSegmentCount,
        header.detectorKind,
    ]);
    new Float64Array(module.memory.buffer, worldToLocalPtr, tracePacket.worldToLocalMatrices.length).set(tracePacket.worldToLocalMatrices);
    new Float64Array(module.memory.buffer, localToWorldPtr, tracePacket.localToWorldMatrices.length).set(tracePacket.localToWorldMatrices);
    new Uint8Array(module.memory.buffer, surfaceKindsPtr, surfaceKindsBytes).set(tracePacket.surfaceKinds);
    new Float64Array(module.memory.buffer, surfaceParamsPtr, tracePacket.surfaceParams.length).set(tracePacket.surfaceParams);
    new Float64Array(module.memory.buffer, sampleScalarsPtr, cameraSamples.sampleScalars.length).set(cameraSamples.sampleScalars);
    new Uint8Array(module.memory.buffer, candidateCountsPtr, candidateCountsBytes).set(hints.candidateCounts);
    new Int32Array(module.memory.buffer, candidateIndicesPtr, hints.sampleCount * hints.maxCandidates).set(hints.candidateIndices);

    module.exports.solver3_analytic_narrow_phase(
        headerPtr,
        worldToLocalPtr,
        localToWorldPtr,
        surfaceKindsPtr,
        surfaceParamsPtr,
        compCount,
        sampleScalarsPtr,
        cameraSamples.sampleCount,
        candidateCountsPtr,
        candidateIndicesPtr,
        hints.maxCandidates,
        outputPtr,
    );

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        sampleCount: cameraSamples.sampleCount,
        output: new Float64Array(module.memory.buffer.slice(outputPtr, outputPtr + outputBytes)),
    };
}
