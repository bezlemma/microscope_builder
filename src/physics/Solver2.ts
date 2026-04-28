import { Vector3 } from 'three';
import { Ray, JonesVector, Coherence } from './types';
import { OpticalComponent } from './Component';
import { Complex, cInv } from './complex';
import { Solver1 } from './Solver1';
import { erf } from './math_solvers';

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
    // Whole-beam envelope estimate [mm] at the segment start/end. This is
    // distinct from footprintStart/End, which describe one sampled beamlet.
    beamRadiusStart?: number;
    beamRadiusEnd?: number;

    polarization: JonesVector;
    opticalPathLength: number;
    refractiveIndex: number;
    coherenceMode: Coherence;
    
    // Performance caches
    bounds?: Float64Array;
    basis?: Float64Array;
    length?: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getSegmentLength(segment: GaussianBeamSegment): number {
    if (segment.length === undefined) {
        segment.length = segment.start.distanceTo(segment.end);
    }
    return segment.length;
}

function ensureSegmentBounds(seg: GaussianBeamSegment): Float64Array {
    const segLength = getSegmentLength(seg);
    if (!seg.bounds) {
        const sx = seg.start.x, sy = seg.start.y, sz = seg.start.z;
        const ex = seg.end.x, ey = seg.end.y, ez = seg.end.z;
        let startR = Math.max(seg.footprintStart ?? seg.footprintEnd ?? 0.05, 0.05);
        let endR = Math.max(seg.footprintEnd ?? seg.footprintStart ?? 0.05, 0.05);
        if (seg.footprintStart === undefined && seg.footprintEnd === undefined) {
            const midRadii = legacySegmentBeamRadii(seg, segLength * 0.5);
            const startRadii = legacySegmentBeamRadii(seg, 0);
            const endRadii = legacySegmentBeamRadii(seg, segLength);
            startR = Math.max(startRadii.wx, startRadii.wy, midRadii.wx, midRadii.wy, 0.05);
            endR = Math.max(endRadii.wx, endRadii.wy, midRadii.wx, midRadii.wy, 0.05);
        }
        const maxR = Math.max(startR, endR) * 10.0;
        seg.bounds = new Float64Array([
            Math.min(sx, ex) - maxR, Math.min(sy, ey) - maxR, Math.min(sz, ez) - maxR,
            Math.max(sx, ex) + maxR, Math.max(sy, ey) + maxR, Math.max(sz, ez) + maxR,
        ]);
    }
    return seg.bounds;
}

function getSegmentBasis(segment: GaussianBeamSegment): Float64Array {
    if (segment.basis) return segment.basis;

    const dx = segment.direction.x;
    const dy = segment.direction.y;
    const dz = segment.direction.z;
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(dy) > 0.99) { upX = 1; upY = 0; upZ = 0; }

    let rightX = dy * upZ - dz * upY;
    let rightY = dz * upX - dx * upZ;
    let rightZ = dx * upY - dy * upX;
    const rightL = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
    if (rightL > 0) { rightX /= rightL; rightY /= rightL; rightZ /= rightL; }

    let localUpX = rightY * dz - rightZ * dy;
    let localUpY = rightZ * dx - rightX * dz;
    let localUpZ = rightX * dy - rightY * dx;
    const localUpL = Math.sqrt(localUpX * localUpX + localUpY * localUpY + localUpZ * localUpZ);
    if (localUpL > 0) { localUpX /= localUpL; localUpY /= localUpL; localUpZ /= localUpL; }

    segment.basis = new Float64Array([rightX, rightY, rightZ, localUpX, localUpY, localUpZ]);
    return segment.basis;
}

interface PreparedBranch {
    segments: GaussianBeamSegment[];
    wavelength: number;
    sourceKey: string;
    coherent: boolean;
    bounds: Float64Array;
}

interface BeamFieldQueryPlan {
    branches: PreparedBranch[];
    wavelengthCache: Map<number, PreparedBranch[]>;
}

const beamFieldPlanCache = new WeakMap<GaussianBeamSegment[][], BeamFieldQueryPlan>();

function createPreparedBranch(branch: GaussianBeamSegment[], _fallbackIndex: number): PreparedBranch | null {
    if (branch.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const seg of branch) {
        const b = ensureSegmentBounds(seg);
        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] < minZ) minZ = b[2];
        if (b[3] > maxX) maxX = b[3];
        if (b[4] > maxY) maxY = b[4];
        if (b[5] > maxZ) maxZ = b[5];
    }
    const first = branch[0];
    const mode = first.coherenceMode;
    return {
        segments: branch,
        wavelength: first.wavelength,
        sourceKey: first.sourceId ?? '__anonymous__',
        coherent: mode === Coherence.Coherent || mode === undefined,
        bounds: new Float64Array([minX, minY, minZ, maxX, maxY, maxZ]),
    };
}

function getBeamFieldQueryPlan(allSegments: GaussianBeamSegment[][]): BeamFieldQueryPlan {
    let plan = beamFieldPlanCache.get(allSegments);
    if (plan) return plan;

    const branches: PreparedBranch[] = [];
    for (let i = 0; i < allSegments.length; i++) {
        const prepared = createPreparedBranch(allSegments[i], i);
        if (prepared) branches.push(prepared);
    }

    plan = { branches, wavelengthCache: new Map() };
    beamFieldPlanCache.set(allSegments, plan);
    return plan;
}

function preparedBranchesForWavelength(
    allSegments: GaussianBeamSegment[][],
    targetWavelength?: number,
): PreparedBranch[] {
    const plan = getBeamFieldQueryPlan(allSegments);
    if (targetWavelength === undefined) return plan.branches;

    const key = Math.round(targetWavelength * 1e12);
    const cached = plan.wavelengthCache.get(key);
    if (cached) return cached;

    const filtered = plan.branches.filter(branch =>
        Math.abs(branch.wavelength - targetWavelength) <= 15e-9
    );
    plan.wavelengthCache.set(key, filtered);
    return filtered;
}

function branchContainsPoint(branch: PreparedBranch, px: number, py: number, pz: number): boolean {
    const b = branch.bounds;
    return px >= b[0] && py >= b[1] && pz >= b[2] && px <= b[3] && py <= b[4] && pz <= b[5];
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

export function segmentBeamEnvelopeRadii(
    segment: GaussianBeamSegment,
    distanceAlong: number
): { wx: number; wy: number } {
    const segLength = getSegmentLength(segment);
    const clampedDistance = clamp(distanceAlong, 0, segLength);

    if (segment.beamRadiusStart !== undefined || segment.beamRadiusEnd !== undefined) {
        const start = Math.max(segment.beamRadiusStart ?? segment.beamRadiusEnd ?? 0.05, 0.05);
        const end = Math.max(segment.beamRadiusEnd ?? segment.beamRadiusStart ?? start, 0.05);
        const frac = segLength > 1e-9 ? clampedDistance / segLength : 0;
        const radius = start + (end - start) * frac;
        return { wx: radius, wy: radius };
    }

    return segmentBeamRadii(segment, clampedDistance);
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
        px: number,
        py: number,
        pz: number,
        segments: GaussianBeamSegment[]
    ): { intensity: number; polarization: JonesVector; phase: number } | null {
        if (segments.length === 0) return null;

        let bestSeg: GaussianBeamSegment | null = null;
        let bestDist2 = Infinity;
        let bestT = 0;

        for (const seg of segments) {
            const segLength = getSegmentLength(seg);
            const b = ensureSegmentBounds(seg);
            if (px < b[0] || py < b[1] || pz < b[2] || px > b[3] || py > b[4] || pz > b[5]) continue;

            const dx = seg.direction.x, dy = seg.direction.y, dz = seg.direction.z;
            const sx = seg.start.x, sy = seg.start.y, sz = seg.start.z;
            const toPx = px - sx, toPy = py - sy, toPz = pz - sz;
            
            if (segLength < 1e-6) continue;

            const along = toPx * dx + toPy * dy + toPz * dz;
            const t = clamp(along, 0, segLength);

            const cx = sx + dx * t;
            const cy = sy + dy * t;
            const cz = sz + dz * t;
            
            const distX = px - cx;
            const distY = py - cy;
            const distZ = pz - cz;
            const dist2 = distX * distX + distY * distY + distZ * distZ;

            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                bestSeg = seg;
                bestT = t;
            }
        }

        if (!bestSeg) return null;

        const seg = bestSeg;
        const { wx, wy } = segmentBeamRadii(seg, bestT);

        if (wx <= 0 || wy <= 0) return null;

        const maxBeamRadius = Math.max(wx, wy);
        if (bestDist2 > maxBeamRadius * maxBeamRadius * 100) return null;

        const dx = seg.direction.x, dy = seg.direction.y, dz = seg.direction.z;
        const sx = seg.start.x, sy = seg.start.y, sz = seg.start.z;
        const toPx = px - sx, toPy = py - sy, toPz = pz - sz;
        
        const along = toPx * dx + toPy * dy + toPz * dz;
        const transX = toPx - dx * along;
        const transY = toPy - dy * along;
        const transZ = toPz - dz * along;

        const basis = getSegmentBasis(seg);
        const rightX = basis[0], rightY = basis[1], rightZ = basis[2];
        const localUpX = basis[3], localUpY = basis[4], localUpZ = basis[5];

        const x = transX * rightX + transY * rightY + transZ * rightZ;
        const y = transX * localUpX + transY * localUpY + transZ * localUpZ;

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
     * Query the total intensity at a 3D point from all beamlet branches.
     *
     * Branches with Coherence.Coherent that share a sourceId are summed coherently
     * (same emitter → they can interfere). Branches from different sources sum
     * incoherently even if both are flagged coherent, since separate lasers/lamps
     * are mutually incoherent in practice.
     */
    static queryIntensityMultiBeam(
        px: number,
        py: number,
        pz: number,
        allSegments: GaussianBeamSegment[][],
        targetWavelength?: number
    ): number {
        const wavelengthBranches = preparedBranchesForWavelength(allSegments, targetWavelength);
        if (wavelengthBranches.length === 0) return 0;

        const branches: PreparedBranch[] = [];
        for (const branch of wavelengthBranches) {
            if (branchContainsPoint(branch, px, py, pz)) {
                branches.push(branch);
            }
        }
        if (branches.length === 0) return 0;

        if (branches.length === 1) {
            const result = Solver2.queryIntensity(px, py, pz, branches[0].segments);
            return result?.intensity ?? 0;
        }

        let sameCoherentSource: string | null = null;
        let allSameCoherentSource = true;
        let allIncoherent = true;
        for (const branch of branches) {
            if (branch.coherent) {
                allIncoherent = false;
                if (sameCoherentSource === null) sameCoherentSource = branch.sourceKey;
                else if (sameCoherentSource !== branch.sourceKey) allSameCoherentSource = false;
            } else {
                allSameCoherentSource = false;
            }
        }

        if (allIncoherent) {
            let total = 0;
            for (const branch of branches) {
                const result = Solver2.queryIntensity(px, py, pz, branch.segments);
                if (result && result.intensity >= 1e-12) total += result.intensity;
            }
            return total;
        }

        if (allSameCoherentSource) {
            let exRe = 0, exIm = 0, eyRe = 0, eyIm = 0;
            for (const branch of branches) {
                const result = Solver2.queryIntensity(px, py, pz, branch.segments);
                if (!result || result.intensity < 1e-12) continue;

                const amplitude = Math.sqrt(result.intensity);
                const cosPhi = Math.cos(result.phase);
                const sinPhi = Math.sin(result.phase);
                const jx = result.polarization.x;
                const jy = result.polarization.y;

                exRe += amplitude * (jx.re * cosPhi - jx.im * sinPhi);
                exIm += amplitude * (jx.re * sinPhi + jx.im * cosPhi);
                eyRe += amplitude * (jy.re * cosPhi - jy.im * sinPhi);
                eyIm += amplitude * (jy.re * sinPhi + jy.im * cosPhi);
            }
            return exRe * exRe + exIm * exIm + eyRe * eyRe + eyIm * eyIm;
        }

        // Per-coherence-group accumulators: keyed by sourceId (or a stable fallback).
        const groups = new Map<string, { ex_re: number; ex_im: number; ey_re: number; ey_im: number }>();
        let incoherentSum = 0;

        for (const branch of branches) {
            const result = Solver2.queryIntensity(px, py, pz, branch.segments);
            if (!result || result.intensity < 1e-12) continue;

            if (branch.coherent) {
                // Branches from the same source may interfere; branches from different
                // sources (different lasers, different lamp wavelengths) must not.
                let acc = groups.get(branch.sourceKey);
                if (!acc) {
                    acc = { ex_re: 0, ex_im: 0, ey_re: 0, ey_im: 0 };
                    groups.set(branch.sourceKey, acc);
                }

                const amplitude = Math.sqrt(result.intensity);
                const phi = result.phase;
                const cosPhi = Math.cos(phi);
                const sinPhi = Math.sin(phi);

                const jx = result.polarization.x;
                acc.ex_re += amplitude * (jx.re * cosPhi - jx.im * sinPhi);
                acc.ex_im += amplitude * (jx.re * sinPhi + jx.im * cosPhi);

                const jy = result.polarization.y;
                acc.ey_re += amplitude * (jy.re * cosPhi - jy.im * sinPhi);
                acc.ey_im += amplitude * (jy.re * sinPhi + jy.im * cosPhi);
            } else {
                incoherentSum += result.intensity;
            }
        }

        let totalIntensity = incoherentSum;
        for (const acc of groups.values()) {
            totalIntensity += acc.ex_re * acc.ex_re + acc.ex_im * acc.ex_im
                            + acc.ey_re * acc.ey_re + acc.ey_im * acc.ey_im;
        }
        return totalIntensity;
    }

    /**
     * Analytically integrates the intensity of all incoherent beam segments 
     * along a generic 3D line segment (e.g. backward ray intersecting sample).
     * Replaces expensive point-sampling with exact Error Function evaluation of Gaussians.
     */
    static integrateIntensityMultiBeam(
        pxStart: number, pyStart: number, pzStart: number,
        dx: number, dy: number, dz: number,
        len: number,
        allSegments: GaussianBeamSegment[][],
        targetWavelength?: number
    ): number {
        let totalIntegral = 0;
        const lineEndX = pxStart + dx * len;
        const lineEndY = pyStart + dy * len;
        const lineEndZ = pzStart + dz * len;
        
        for (const branch of preparedBranchesForWavelength(allSegments, targetWavelength)) {
            const branchBounds = branch.bounds;
            if (Math.min(pxStart, lineEndX) > branchBounds[3] || Math.max(pxStart, lineEndX) < branchBounds[0]) continue;
            if (Math.min(pyStart, lineEndY) > branchBounds[4] || Math.max(pyStart, lineEndY) < branchBounds[1]) continue;
            if (Math.min(pzStart, lineEndZ) > branchBounds[5] || Math.max(pzStart, lineEndZ) < branchBounds[2]) continue;

            for (const seg of branch.segments) {
                const segLength = getSegmentLength(seg);
                
                // Fast lazy bounds
                const b = ensureSegmentBounds(seg);
                
                // Line AABB check: check start, end, and simple bounding box overlap
                if (Math.min(pxStart, lineEndX) > b[3] || Math.max(pxStart, lineEndX) < b[0]) continue;
                if (Math.min(pyStart, lineEndY) > b[4] || Math.max(pyStart, lineEndY) < b[1]) continue;
                if (Math.min(pzStart, lineEndZ) > b[5] || Math.max(pzStart, lineEndZ) < b[2]) continue;

                const segDx = seg.direction.x, segDy = seg.direction.y, segDz = seg.direction.z;
                const sx = seg.start.x, sy = seg.start.y, sz = seg.start.z;
                
                // Evaluate beam radius at the midpoint of the query segment (approximation)
                const midX = pxStart + dx * (len / 2);
                const midY = pyStart + dy * (len / 2);
                const midZ = pzStart + dz * (len / 2);
                const alongMid = (midX - sx)*segDx + (midY - sy)*segDy + (midZ - sz)*segDz;
                const tMid = clamp(alongMid, 0, segLength);
                const { wx, wy } = segmentBeamRadii(seg, tMid);
                if (wx <= 0 || wy <= 0) continue;

                const toPx = pxStart - sx, toPy = pyStart - sy, toPz = pzStart - sz;
                
                // Base along distance at t=0
                const along0 = toPx*segDx + toPy*segDy + toPz*segDz;
                const trans0X = toPx - segDx*along0;
                const trans0Y = toPy - segDy*along0;
                const trans0Z = toPz - segDz*along0;
                
                // Rate of change of along direction
                const dAlong = dx*segDx + dy*segDy + dz*segDz;
                const dTransX = dx - segDx*dAlong;
                const dTransY = dy - segDy*dAlong;
                const dTransZ = dz - segDz*dAlong;

                const basis = getSegmentBasis(seg);
                const rightX = basis[0], rightY = basis[1], rightZ = basis[2];
                const localUpX = basis[3], localUpY = basis[4], localUpZ = basis[5];

                const x0 = trans0X*rightX + trans0Y*rightY + trans0Z*rightZ;
                const y0 = trans0X*localUpX + trans0Y*localUpY + trans0Z*localUpZ;
                
                const ux = dTransX*rightX + dTransY*rightY + dTransZ*rightZ;
                const uy = dTransX*localUpX + dTransY*localUpY + dTransZ*localUpZ;

                const w2x = wx * wx;
                const w2y = wy * wy;

                const A = 2 * ( (ux*ux)/w2x + (uy*uy)/w2y );
                const B = 4 * ( (x0*ux)/w2x + (y0*uy)/w2y );
                const C = 2 * ( (x0*x0)/w2x + (y0*y0)/w2y );

                const peakI = seg.power / (Math.PI * wx * wy);

                if (A < 1e-12) {
                    // Ray runs parallel to the beam. Intensity is constant transversely.
                    totalIntegral += len * peakI * Math.exp(-C);
                } else {
                    // Analytical Erf integration over t in [0, len]
                    const sqrtA = Math.sqrt(A);
                    const arg0 = B / (2 * sqrtA);
                    const argL = sqrtA * len + arg0;
                    
                    const term1 = Math.exp((B*B)/(4*A) - C);
                    const term2 = (Math.sqrt(Math.PI) / (2 * sqrtA)) * (erf(argL) - erf(arg0));
                    
                    totalIntegral += peakI * term1 * term2;
                }
            }
        }
        return totalIntegral;
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
