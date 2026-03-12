import { Vector3 } from 'three';
import { Ray, JonesVector, Coherence } from './types';
import { OpticalComponent } from './Component';
import { Complex, cInv } from './complex';
import { Solver1 } from './Solver1';

// ─── Legacy q-Parameter Helpers ───────────────────────────────────────
//
// Solver 2 now builds beamlet envelopes directly from Solver 1 ray paths.
// These helpers remain as a compatibility path for tests, fixtures, and any
// callers that still construct analytic q-based segments by hand.

/**
 * Compute beam radius w(z) from the q-parameter.
 * 1/q = 1/R - i·λ/(π·w²)
 * So Im(1/q) = -λ/(π·w²), therefore w = sqrt(-λ/(π·Im(1/q)))
 */
export function beamRadius(q: Complex, wavelengthMm: number): number {
    const invQ = cInv(q);
    const imInvQ = invQ.im;
    if (imInvQ >= 0) return 100;
    return Math.sqrt(-wavelengthMm / (Math.PI * imInvQ));
}

/**
 * Compute wavefront radius of curvature R(z) from the q-parameter.
 * Re(1/q) = 1/R
 */
export function wavefrontRadius(q: Complex): number {
    const invQ = cInv(q);
    if (Math.abs(invQ.re) < 1e-15) return Infinity;
    return 1 / invQ.re;
}

/**
 * Initialize q-parameter from beam waist:
 *   q₀ = i · π · w₀² / λ
 * where w₀ is beam waist radius and λ is wavelength (both in mm).
 */
export function initialQ(waistRadius: number, wavelengthMm: number): Complex {
    return { re: 0, im: Math.PI * waistRadius * waistRadius / wavelengthMm };
}

// ─── Data Structures ──────────────────────────────────────────────────

/**
 * A single Solver 2 beam segment.
 *
 * The production path uses `footprintStart`/`footprintEnd`, estimated from the
 * neighboring Solver 1 rays in the same beamlet cohort. The q fields remain for
 * legacy callers that still construct analytic Gaussian segments directly.
 */
export interface GaussianBeamSegment {
    start: Vector3;
    end: Vector3;
    direction: Vector3;
    wavelength: number;     // meters (SI, matching Ray.wavelength)
    power: number;          // Beam power carried by this beamlet segment
    sourceId?: string;
    bundleKey?: string;

    // Legacy q-parameter data retained for fallback/tests.
    qx_start: Complex;
    qx_end: Complex;
    qy_start: Complex;
    qy_end: Complex;

    // Beamlet footprint estimate [mm] at the segment start/end.
    footprintStart?: number;
    footprintEnd?: number;

    polarization: JonesVector;
    opticalPathLength: number;
    refractiveIndex: number;
    coherenceMode: Coherence;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getSegmentLength(segment: GaussianBeamSegment): number {
    return segment.start.distanceTo(segment.end);
}

function legacySegmentBeamRadii(
    segment: GaussianBeamSegment,
    distanceAlong: number
): { wx: number; wy: number } {
    const wavelengthMm = segment.wavelength * 1e3;
    const effectiveWavelength = wavelengthMm / (segment.refractiveIndex || 1.0);
    const qx: Complex = { re: segment.qx_start.re + distanceAlong, im: segment.qx_start.im };
    const qy: Complex = { re: segment.qy_start.re + distanceAlong, im: segment.qy_start.im };
    return {
        wx: beamRadius(qx, effectiveWavelength),
        wy: beamRadius(qy, effectiveWavelength),
    };
}

/**
 * Beam radii at a point along a segment.
 *
 * Production segments use beamlet footprints from Solver 1 geometry.
 * Legacy/manual segments fall back to q-parameter evaluation.
 */
export function segmentBeamRadii(
    segment: GaussianBeamSegment,
    distanceAlong: number
): { wx: number; wy: number } {
    const segLength = getSegmentLength(segment);
    const clampedDistance = clamp(distanceAlong, 0, segLength);

    if (segment.footprintStart !== undefined || segment.footprintEnd !== undefined) {
        const start = Math.max(segment.footprintStart ?? segment.footprintEnd ?? 0.05, 0.05);
        const end = Math.max(segment.footprintEnd ?? segment.footprintStart ?? start, 0.05);
        const frac = segLength > 1e-9 ? clampedDistance / segLength : 0;
        const radius = start + (end - start) * frac;
        return { wx: radius, wy: radius };
    }

    return legacySegmentBeamRadii(segment, clampedDistance);
}

export function segmentBeamRadiiAtFraction(
    segment: GaussianBeamSegment,
    fraction: number
): { wx: number; wy: number } {
    const segLength = getSegmentLength(segment);
    return segmentBeamRadii(segment, clamp(fraction, 0, 1) * segLength);
}

// ─── Solver 2 ─────────────────────────────────────────────────────────

export class Solver2 {
    /**
     * Compatibility wrapper: beamlet construction now lives in Solver 1.
     */
    propagate(
        allPaths: Ray[][],
        components: OpticalComponent[]
    ): GaussianBeamSegment[][] {
        return new Solver1(components).buildBeamSegments(allPaths);
    }

    // ─── Solver Handshake: E-field Query ──────────────────────────────

    /**
     * Query the beam intensity at any 3D point from a single beamlet branch.
     * Returns intensity [W/mm²], polarization, and accumulated phase.
     */
    static queryIntensity(
        point: Vector3,
        segments: GaussianBeamSegment[]
    ): { intensity: number; polarization: JonesVector; phase: number } | null {
        if (segments.length === 0) return null;

        let bestSeg: GaussianBeamSegment | null = null;
        let bestDist = Infinity;
        let bestT = 0;

        const toPoint = new Vector3();
        const closest = new Vector3();

        for (const seg of segments) {
            const segDir = seg.direction;
            const segLen = getSegmentLength(seg);
            if (segLen < 1e-6) continue;

            toPoint.subVectors(point, seg.start);
            const along = toPoint.dot(segDir);
            const t = clamp(along, 0, segLen);

            closest.copy(seg.start).addScaledVector(segDir, t);
            const dist = point.distanceTo(closest);

            if (dist < bestDist) {
                bestDist = dist;
                bestSeg = seg;
                bestT = t;
            }
        }

        if (!bestSeg) return null;

        const seg = bestSeg;
        const segDir = seg.direction;
        const { wx, wy } = segmentBeamRadii(seg, bestT);

        if (wx <= 0 || wy <= 0) return null;

        const maxBeamRadius = Math.max(wx, wy);
        if (bestDist > maxBeamRadius * 10) return null;

        toPoint.subVectors(point, seg.start);
        const along = toPoint.dot(segDir);
        const transverse = toPoint.clone().sub(segDir.clone().multiplyScalar(along));

        const up = new Vector3(0, 1, 0);
        if (Math.abs(segDir.dot(up)) > 0.99) up.set(1, 0, 0);
        const right = new Vector3().crossVectors(segDir, up).normalize();
        const localUp = new Vector3().crossVectors(right, segDir).normalize();

        const x = transverse.dot(right);
        const y = transverse.dot(localUp);

        const gaussArg = 2 * (x * x / (wx * wx) + y * y / (wy * wy));
        const gaussFactor = Math.exp(-gaussArg);
        const intensity = (seg.power / (Math.PI * wx * wy)) * gaussFactor;

        const wavelengthMm = seg.wavelength * 1e3;
        const n = seg.refractiveIndex || 1.0;
        const phase = (2 * Math.PI / wavelengthMm) * (seg.opticalPathLength + bestT * n);

        return {
            intensity,
            polarization: seg.polarization,
            phase
        };
    }

    /**
     * Query the total intensity at a 3D point from all beamlet branches,
     * coherently summing E-fields for coherent sources.
     */
    static queryIntensityMultiBeam(
        point: Vector3,
        allSegments: GaussianBeamSegment[][],
        targetWavelength?: number
    ): number {
        let ex_re = 0, ex_im = 0;
        let ey_re = 0, ey_im = 0;
        let incoherentSum = 0;

        for (const branch of allSegments) {
            if (branch.length === 0) continue;

            if (targetWavelength !== undefined) {
                const branchWl = branch[0].wavelength;
                if (Math.abs(branchWl - targetWavelength) > 15e-9) {
                    continue;
                }
            }

            const result = Solver2.queryIntensity(point, branch);
            if (!result || result.intensity < 1e-12) continue;

            const mode = branch[0].coherenceMode;

            if (mode === Coherence.Coherent || mode === undefined) {
                const amplitude = Math.sqrt(result.intensity);
                const phi = result.phase;
                const cosPhi = Math.cos(phi);
                const sinPhi = Math.sin(phi);

                const jx = result.polarization.x;
                ex_re += amplitude * (jx.re * cosPhi - jx.im * sinPhi);
                ex_im += amplitude * (jx.re * sinPhi + jx.im * cosPhi);

                const jy = result.polarization.y;
                ey_re += amplitude * (jy.re * cosPhi - jy.im * sinPhi);
                ey_im += amplitude * (jy.re * sinPhi + jy.im * cosPhi);
            } else {
                incoherentSum += result.intensity;
            }
        }

        const coherentIntensity = ex_re * ex_re + ex_im * ex_im + ey_re * ey_re + ey_im * ey_im;
        return coherentIntensity + incoherentSum;
    }
}

// ─── Utility Exports ──────────────────────────────────────────────────

/**
 * Sample the beam width along a segment at evenly spaced points.
 * Returns array of { z, wx, wy } where z is distance from segment start.
 */
export function sampleBeamProfile(
    segment: GaussianBeamSegment,
    numSamples: number = 20
): { z: number; wx: number; wy: number }[] {
    const segLength = getSegmentLength(segment);
    const samples: { z: number; wx: number; wy: number }[] = [];

    for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        const z = t * segLength;
        const { wx, wy } = segmentBeamRadii(segment, z);
        samples.push({ z, wx, wy });
    }

    return samples;
}
