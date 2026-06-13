import type { PackedTraceScene, ReverseTracerPacketHeader } from './kernelPackets';
import { PACKED_COMPONENT_BOUNDS_STRIDE, PACKED_COMPONENT_MATRIX_STRIDE, REVERSE_TRACE_KERNEL_ABI_VERSION } from './kernelPackets';
import type { PackedCameraSamples } from './reverseTraceSampling';
import { PACKED_CAMERA_SAMPLE_STRIDE } from './reverseTraceSampling';
import type { ReverseTracerWasmModule } from './reverseTraceWasmBackend';

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
    // A full list may have dropped farther candidates; any dropped AABB entry
    // is at least as far as the farthest kept one. Append a sentinel so the
    // kernel's "no remaining candidate is closer" certainty proof stays sound
    // instead of treating the truncated tail as empty space.
    if (count >= packet.maxCandidates && out.length > 0) {
        out.push({ componentIndex: -1, tNear: out[out.length - 1].tNear });
    }
    return out;
}

function transformPoint(matrix: Float64Array, offset: number, x: number, y: number, z: number): [number, number, number] {
    return [
        matrix[offset] * x + matrix[offset + 4] * y + matrix[offset + 8] * z + matrix[offset + 12],
        matrix[offset + 1] * x + matrix[offset + 5] * y + matrix[offset + 9] * z + matrix[offset + 13],
        matrix[offset + 2] * x + matrix[offset + 6] * y + matrix[offset + 10] * z + matrix[offset + 14],
    ];
}

function transformDirection(matrix: Float64Array, offset: number, x: number, y: number, z: number): [number, number, number] {
    const dx = matrix[offset] * x + matrix[offset + 4] * y + matrix[offset + 8] * z;
    const dy = matrix[offset + 1] * x + matrix[offset + 5] * y + matrix[offset + 9] * z;
    const dz = matrix[offset + 2] * x + matrix[offset + 6] * y + matrix[offset + 10] * z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return [dx / len, dy / len, dz / len];
}

function rayAabbTNear(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    bounds: Float64Array,
    offset: number,
): number | null {
    let tMin = -Infinity;
    let tMax = Infinity;

    const slab = (origin: number, dir: number, min: number, max: number): boolean => {
        if (Math.abs(dir) <= 1e-12) {
            return origin >= min && origin <= max;
        }
        const inv = 1 / dir;
        let t1 = (min - origin) * inv;
        let t2 = (max - origin) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        return tMin <= tMax;
    };

    if (!slab(ox, dx, bounds[offset], bounds[offset + 3])) return null;
    if (!slab(oy, dy, bounds[offset + 1], bounds[offset + 4])) return null;
    if (!slab(oz, dz, bounds[offset + 2], bounds[offset + 5])) return null;
    if (tMax <= 0) return null;
    return Math.max(0, tMin);
}

function insertCandidate(
    candidateIndices: Int32Array,
    candidateTNear: Float64Array,
    base: number,
    count: number,
    maxCandidates: number,
    componentIndex: number,
    tNear: number,
): number {
    let insertAt = 0;
    while (insertAt < count && candidateTNear[base + insertAt] <= tNear) insertAt++;
    if (count < maxCandidates) {
        for (let i = count; i > insertAt; i--) {
            candidateIndices[base + i] = candidateIndices[base + i - 1];
            candidateTNear[base + i] = candidateTNear[base + i - 1];
        }
        candidateIndices[base + insertAt] = componentIndex;
        candidateTNear[base + insertAt] = tNear;
        return count + 1;
    }
    if (insertAt >= maxCandidates) return count;
    for (let i = maxCandidates - 1; i > insertAt; i--) {
        candidateIndices[base + i] = candidateIndices[base + i - 1];
        candidateTNear[base + i] = candidateTNear[base + i - 1];
    }
    candidateIndices[base + insertAt] = componentIndex;
    candidateTNear[base + insertAt] = tNear;
    return count;
}

export function createPackedFirstHitHintsJs(
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    maxCandidates: number = PACKED_FIRST_HIT_HINTS_DEFAULT_MAX_CANDIDATES,
    excludeComponentIndex = -1,
): PackedFirstHitHints {
    const sampleCount = cameraSamples.sampleCount;
    const componentCount = tracePacket.componentKinds.length;
    const candidateCounts = new Uint8Array(sampleCount);
    const candidateIndices = new Int32Array(sampleCount * maxCandidates);
    const candidateTNear = new Float64Array(sampleCount * maxCandidates);
    candidateIndices.fill(-1);
    candidateTNear.fill(Infinity);

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const sampleBase = sampleIndex * PACKED_CAMERA_SAMPLE_STRIDE;
        const ox = cameraSamples.sampleScalars[sampleBase + 2];
        const oy = cameraSamples.sampleScalars[sampleBase + 3];
        const oz = cameraSamples.sampleScalars[sampleBase + 4];
        const dx = cameraSamples.sampleScalars[sampleBase + 5];
        const dy = cameraSamples.sampleScalars[sampleBase + 6];
        const dz = cameraSamples.sampleScalars[sampleBase + 7];
        const hintBase = sampleIndex * maxCandidates;
        let count = 0;

        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
            // The originating detector always contains the sample-ray origin
            // (tNear = 0); it would waste a hint slot and poison the analytic
            // narrow phase as an unsupported candidate.
            if (componentIndex === excludeComponentIndex) continue;
            const matrixBase = componentIndex * PACKED_COMPONENT_MATRIX_STRIDE;
            const boundsBase = componentIndex * PACKED_COMPONENT_BOUNDS_STRIDE;
            const localOrigin = transformPoint(tracePacket.worldToLocalMatrices, matrixBase, ox, oy, oz);
            const localDirection = transformDirection(tracePacket.worldToLocalMatrices, matrixBase, dx, dy, dz);
            const tNear = rayAabbTNear(
                localOrigin[0], localOrigin[1], localOrigin[2],
                localDirection[0], localDirection[1], localDirection[2],
                tracePacket.localBounds,
                boundsBase,
            );
            if (tNear === null) continue;
            count = insertCandidate(candidateIndices, candidateTNear, hintBase, count, maxCandidates, componentIndex, tNear);
        }
        candidateCounts[sampleIndex] = Math.min(count, 255);
    }

    return {
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        sampleCount,
        maxCandidates,
        candidateCounts,
        candidateIndices,
        candidateTNear,
    };
}

export function createPackedFirstHitHintsFromWasm(
    module: ReverseTracerWasmModule,
    header: ReverseTracerPacketHeader,
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    maxCandidates: number = PACKED_FIRST_HIT_HINTS_DEFAULT_MAX_CANDIDATES,
    excludeComponentIndex = -1,
): PackedFirstHitHints | null {
    if (!module.memory) return null;
    if (typeof module.exports.reverse_trace_generate_first_hit_hints !== 'function') return null;

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

    const generated = module.exports.reverse_trace_generate_first_hit_hints(
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
        excludeComponentIndex,
    );
    if (generated !== cameraSamples.sampleCount) return null;

    return {
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        sampleCount: cameraSamples.sampleCount,
        maxCandidates,
        candidateCounts: new Uint8Array(module.memory.buffer.slice(candidateCountsPtr, candidateCountsPtr + candidateCountsBytes)),
        candidateIndices: new Int32Array(module.memory.buffer.slice(candidateIndicesPtr, candidateIndicesPtr + candidateIndicesBytes)),
        candidateTNear: new Float64Array(module.memory.buffer.slice(candidateTNearPtr, candidateTNearPtr + candidateTNearBytes)),
    };
}
