import type { PackedTraceScene, ReverseTracerPacketHeader } from './kernelPackets';
import {
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_SURFACE_PARAM_STRIDE,
    REVERSE_TRACE_KERNEL_ABI_VERSION,
    SURFACE_KIND_FLAT_DISC,
    SURFACE_KIND_MIRROR_DISC,
    SURFACE_KIND_THICK_LENS,
    SURFACE_KIND_UNSUPPORTED,
} from './kernelPackets';
import type { PackedCameraSamples } from './reverseTraceSampling';
import { PACKED_CAMERA_SAMPLE_STRIDE } from './reverseTraceSampling';
import type { PackedFirstHitHints } from './reverseTraceFirstHitHints';
import type { ReverseTracerWasmModule } from './reverseTraceWasmBackend';

/**
 * Per-sample analytic-narrow-phase result from Rust.  The best supported hit
 * found by Rust's `reverse_trace_analytic_narrow_phase`, already in the component's
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
    /** Raw output buffer, 8 f64 per sample (see Rust `reverse_trace_analytic_narrow_phase`). */
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
    module: ReverseTracerWasmModule,
    header: ReverseTracerPacketHeader,
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    hints: PackedFirstHitHints,
): PackedAnalyticHits | null {
    if (!module.memory) return null;
    if (typeof module.exports.reverse_trace_analytic_narrow_phase !== 'function') return null;
    if (typeof module.exports.reverse_trace_surface_param_stride !== 'function') return null;
    if (module.exports.reverse_trace_surface_param_stride() !== PACKED_SURFACE_PARAM_STRIDE) return null;

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

    module.exports.reverse_trace_analytic_narrow_phase(
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
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        sampleCount: cameraSamples.sampleCount,
        output: new Float64Array(module.memory.buffer.slice(outputPtr, outputPtr + outputBytes)),
    };
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

interface JsAnalyticHit {
    t: number;
    point: [number, number, number];
    normal: [number, number, number];
    isBlocked: boolean;
}

function rayFlatDisc(
    origin: [number, number, number],
    direction: [number, number, number],
    innerR: number,
    outerR: number,
    absorbingRing: boolean,
): JsAnalyticHit | null {
    const dw = direction[2];
    if (Math.abs(dw) < 1e-6) return null;
    const t = -origin[2] / dw;
    if (t < 0.001) return null;
    const hx = origin[0] + direction[0] * t;
    const hy = origin[1] + direction[1] * t;
    const rSq = hx * hx + hy * hy;
    if (rSq > outerR * outerR) return null;
    return {
        t,
        point: [hx, hy, 0],
        normal: [0, 0, dw < 0 ? 1 : -1],
        isBlocked: absorbingRing && rSq >= innerR * innerR,
    };
}

function raySphereCap(
    origin: [number, number, number],
    direction: [number, number, number],
    apexZ: number,
    r: number,
    apertureR: number,
): { t: number; point: [number, number, number]; normal: [number, number, number] } | null {
    if (Math.abs(r) >= 1e8) {
        const dw = direction[2];
        if (Math.abs(dw) < 1e-6) return null;
        const t = (apexZ - origin[2]) / dw;
        if (t < 0.001) return null;
        const hx = origin[0] + direction[0] * t;
        const hy = origin[1] + direction[1] * t;
        if (hx * hx + hy * hy > apertureR * apertureR) return null;
        return { t, point: [hx, hy, apexZ], normal: [0, 0, 1] };
    }

    const cz = apexZ + r;
    const ox = origin[0];
    const oy = origin[1];
    const oz = origin[2] - cz;
    const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;

    const sqrtDisc = Math.sqrt(disc);
    const candidates = [-b - sqrtDisc, -b + sqrtDisc];
    let best: { t: number; point: [number, number, number]; normal: [number, number, number] } | null = null;
    for (const t of candidates) {
        if (t < 0.001) continue;
        const hx = origin[0] + direction[0] * t;
        const hy = origin[1] + direction[1] * t;
        const hz = origin[2] + direction[2] * t;
        if (hx * hx + hy * hy > apertureR * apertureR) continue;
        if ((hz - cz) * r > 0) continue;
        if (!best || t < best.t) {
            const invR = 1 / Math.abs(r);
            best = {
                t,
                point: [hx, hy, hz],
                normal: [hx * invR, hy * invR, (hz - cz) * invR],
            };
        }
    }
    return best;
}

function rayThickLens(
    origin: [number, number, number],
    direction: [number, number, number],
    r1: number,
    r2: number,
    thickness: number,
    apertureR: number,
): JsAnalyticHit | null {
    const frontApex = -thickness * 0.5;
    const backApex = thickness * 0.5;
    const frontRaw = raySphereCap(origin, direction, frontApex, r1, apertureR);
    const backRaw = raySphereCap(origin, direction, backApex, r2, apertureR);
    const front = frontRaw ? {
        ...frontRaw,
        normal: frontRaw.normal.map(v => v * (Math.abs(r1) >= 1e8 ? -1 : Math.sign(r1))) as [number, number, number],
    } : null;
    const back = backRaw ? {
        ...backRaw,
        normal: backRaw.normal.map(v => v * (Math.abs(r2) >= 1e8 ? 1 : -Math.sign(r2))) as [number, number, number],
    } : null;
    const hit = front && back ? (front.t < back.t ? front : back) : (front ?? back);
    return hit ? { ...hit, isBlocked: false } : null;
}

function rayMirrorDisc(
    origin: [number, number, number],
    direction: [number, number, number],
    radius: number,
    halfThickness: number,
): JsAnalyticHit | null {
    const dw = direction[2];
    if (Math.abs(dw) < 1e-6) return null;
    let best: JsAnalyticHit | null = null;
    for (const planeZ of [-halfThickness, halfThickness]) {
        const t = (planeZ - origin[2]) / dw;
        if (t < 0.001 || (best && t >= best.t)) continue;
        const hx = origin[0] + direction[0] * t;
        const hy = origin[1] + direction[1] * t;
        if (hx * hx + hy * hy > radius * radius) continue;
        best = {
            t,
            point: [hx, hy, planeZ],
            normal: [0, 0, planeZ > 0 ? 1 : -1],
            isBlocked: false,
        };
    }
    return best;
}

export function createPackedAnalyticHitsJs(
    tracePacket: PackedTraceScene,
    cameraSamples: PackedCameraSamples,
    hints: PackedFirstHitHints,
): PackedAnalyticHits {
    const output = new Float64Array(cameraSamples.sampleCount * 8);
    let outBase = 0;
    for (let sampleIndex = 0; sampleIndex < cameraSamples.sampleCount; sampleIndex++, outBase += 8) {
        const sampleBase = sampleIndex * PACKED_CAMERA_SAMPLE_STRIDE;
        const origin: [number, number, number] = [
            cameraSamples.sampleScalars[sampleBase + 2],
            cameraSamples.sampleScalars[sampleBase + 3],
            cameraSamples.sampleScalars[sampleBase + 4],
        ];
        const direction: [number, number, number] = [
            cameraSamples.sampleScalars[sampleBase + 5],
            cameraSamples.sampleScalars[sampleBase + 6],
            cameraSamples.sampleScalars[sampleBase + 7],
        ];

        output[outBase] = NaN;
        output[outBase + 1] = -1;
        const candidateCount = hints.candidateCounts[sampleIndex] ?? 0;
        const candidateBase = sampleIndex * hints.maxCandidates;
        let bestT = Infinity;
        let best: JsAnalyticHit | null = null;
        let bestIndex = -1;

        for (let k = 0; k < Math.min(candidateCount, hints.maxCandidates); k++) {
            const componentIndex = hints.candidateIndices[candidateBase + k];
            if (componentIndex < 0) break;
            const kind = tracePacket.surfaceKinds[componentIndex];
            if (kind === SURFACE_KIND_UNSUPPORTED) {
                best = null;
                bestIndex = -2;
                break;
            }

            const matrixBase = componentIndex * PACKED_COMPONENT_MATRIX_STRIDE;
            const localOrigin = transformPoint(tracePacket.worldToLocalMatrices, matrixBase, origin[0], origin[1], origin[2]);
            const localDirection = transformDirection(tracePacket.worldToLocalMatrices, matrixBase, direction[0], direction[1], direction[2]);
            const paramBase = componentIndex * PACKED_SURFACE_PARAM_STRIDE;
            let hit: JsAnalyticHit | null = null;
            if (kind === SURFACE_KIND_FLAT_DISC) {
                hit = rayFlatDisc(
                    localOrigin,
                    localDirection,
                    tracePacket.surfaceParams[paramBase],
                    tracePacket.surfaceParams[paramBase + 1],
                    tracePacket.surfaceParams[paramBase + 2] >= 0.5,
                );
            } else if (kind === SURFACE_KIND_THICK_LENS) {
                hit = rayThickLens(
                    localOrigin,
                    localDirection,
                    tracePacket.surfaceParams[paramBase],
                    tracePacket.surfaceParams[paramBase + 1],
                    tracePacket.surfaceParams[paramBase + 2],
                    tracePacket.surfaceParams[paramBase + 3],
                );
            } else if (kind === SURFACE_KIND_MIRROR_DISC) {
                hit = rayMirrorDisc(
                    localOrigin,
                    localDirection,
                    tracePacket.surfaceParams[paramBase],
                    tracePacket.surfaceParams[paramBase + 1],
                );
            }

            if (hit && hit.t > 0.001 && hit.t < bestT) {
                bestT = hit.t;
                best = hit;
                bestIndex = componentIndex;
            }
        }

        if (best) {
            output[outBase] = best.isBlocked ? -best.t : best.t;
            output[outBase + 1] = bestIndex;
            output[outBase + 2] = best.point[0];
            output[outBase + 3] = best.point[1];
            output[outBase + 4] = best.point[2];
            output[outBase + 5] = best.normal[0];
            output[outBase + 6] = best.normal[1];
            output[outBase + 7] = best.normal[2];
        } else if (bestIndex === -2) {
            output[outBase + 1] = -2;
        }
    }

    return {
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        sampleCount: cameraSamples.sampleCount,
        output,
    };
}
