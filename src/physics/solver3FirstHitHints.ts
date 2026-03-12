import type { PackedTraceScene, Solver3PacketHeader } from './kernelPackets';
import { SOLVER3_KERNEL_ABI_VERSION } from './kernelPackets';
import type { PackedCameraSamples } from './solver3Sampling';
import type { Solver3WasmModule } from './solver3WasmBackend';

export const PACKED_FIRST_HIT_HINTS_DEFAULT_MAX_CANDIDATES = 4;

export interface PackedFirstHitHints {
    abiVersion: number;
    sampleCount: number;
    maxCandidates: number;
    candidateCounts: Uint8Array;
    candidateIndices: Int32Array;
    candidateTNear: Float64Array;
}

export interface FirstHitHintCandidate {
    componentIndex: number;
    tNear: number;
}

function alignOffset(offset: number, alignment: number): number {
    return Math.ceil(offset / alignment) * alignment;
}

export function unpackFirstHitHintCandidates(
    packet: PackedFirstHitHints,
    sampleIndex: number,
): FirstHitHintCandidate[] {
    const count = packet.candidateCounts[sampleIndex] ?? 0;
    const out: FirstHitHintCandidate[] = [];
    const base = sampleIndex * packet.maxCandidates;
    for (let i = 0; i < count; i++) {
        out.push({
            componentIndex: packet.candidateIndices[base + i],
            tNear: packet.candidateTNear[base + i],
        });
    }
    return out;
}

export function createPackedFirstHitHintsFromWasm(
    module: Solver3WasmModule,
    header: Solver3PacketHeader,
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    maxCandidates: number = PACKED_FIRST_HIT_HINTS_DEFAULT_MAX_CANDIDATES,
): PackedFirstHitHints | null {
    if (!module.memory) return null;
    if (typeof module.exports.solver3_generate_first_hit_hints !== 'function') return null;

    const headerWords = 5;
    const worldToLocalBytes = tracePacket.worldToLocalMatrices.length * Float64Array.BYTES_PER_ELEMENT;
    const localBoundsBytes = tracePacket.localBounds.length * Float64Array.BYTES_PER_ELEMENT;
    const sampleScalarsBytes = cameraSamples.sampleScalars.length * Float64Array.BYTES_PER_ELEMENT;
    const candidateCountsBytes = cameraSamples.sampleCount * Uint8Array.BYTES_PER_ELEMENT;
    const candidateIndicesBytes = cameraSamples.sampleCount * maxCandidates * Int32Array.BYTES_PER_ELEMENT;
    const candidateTNearBytes = cameraSamples.sampleCount * maxCandidates * Float64Array.BYTES_PER_ELEMENT;

    const headerPtr = 0;
    const worldToLocalPtr = alignOffset(headerWords * Uint32Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
    const localBoundsPtr = alignOffset(worldToLocalPtr + worldToLocalBytes, Float64Array.BYTES_PER_ELEMENT);
    const sampleScalarsPtr = alignOffset(localBoundsPtr + localBoundsBytes, Float64Array.BYTES_PER_ELEMENT);
    const candidateCountsPtr = alignOffset(sampleScalarsPtr + sampleScalarsBytes, Uint8Array.BYTES_PER_ELEMENT);
    const candidateIndicesPtr = alignOffset(candidateCountsPtr + candidateCountsBytes, Int32Array.BYTES_PER_ELEMENT);
    const candidateTNearPtr = alignOffset(candidateIndicesPtr + candidateIndicesBytes, Float64Array.BYTES_PER_ELEMENT);
    const totalBytes = candidateTNearPtr + candidateTNearBytes;

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
    new Float64Array(module.memory.buffer, localBoundsPtr, tracePacket.localBounds.length).set(tracePacket.localBounds);
    new Float64Array(module.memory.buffer, sampleScalarsPtr, cameraSamples.sampleScalars.length).set(cameraSamples.sampleScalars);

    const generated = module.exports.solver3_generate_first_hit_hints(
        headerPtr,
        worldToLocalPtr,
        localBoundsPtr,
        tracePacket.componentKinds.length,
        sampleScalarsPtr,
        cameraSamples.sampleCount,
        maxCandidates,
        candidateCountsPtr,
        candidateIndicesPtr,
        candidateTNearPtr,
    );
    if (generated !== cameraSamples.sampleCount) return null;

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        sampleCount: cameraSamples.sampleCount,
        maxCandidates,
        candidateCounts: new Uint8Array(module.memory.buffer.slice(candidateCountsPtr, candidateCountsPtr + candidateCountsBytes)),
        candidateIndices: new Int32Array(module.memory.buffer.slice(candidateIndicesPtr, candidateIndicesPtr + candidateIndicesBytes)),
        candidateTNear: new Float64Array(module.memory.buffer.slice(candidateTNearPtr, candidateTNearPtr + candidateTNearBytes)),
    };
}
