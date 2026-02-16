import { Vector3 } from 'three';
import { Ray, JonesVector } from './types';
import { OpticalComponent } from './Component';
import { SphericalLens } from './components/SphericalLens';
import { CylindricalLens } from './components/CylindricalLens';
import { IdealLens } from './components/IdealLens';
import { Objective } from './components/Objective';
import { Mirror } from './components/Mirror';
import { Laser } from './components/Laser';
import { Waveplate } from './components/Waveplate';
import { PrismLens } from './components/PrismLens';
import { BeamSplitter } from './components/BeamSplitter';
import { Aperture } from './components/Aperture';
import { Filter } from './components/Filter';
import { DichroicMirror } from './components/DichroicMirror';

// ─── Complex Number Helpers ───────────────────────────────────────────
interface Complex {
    re: number;
    im: number;
}

function cAdd(a: Complex, b: Complex): Complex {
    return { re: a.re + b.re, im: a.im + b.im };
}

function cMul(a: Complex, b: Complex): Complex {
    return {
        re: a.re * b.re - a.im * b.im,
        im: a.re * b.im + a.im * b.re
    };
}

function cDiv(a: Complex, b: Complex): Complex {
    const denom = b.re * b.re + b.im * b.im;
    if (denom < 1e-30) return { re: 0, im: 0 };
    return {
        re: (a.re * b.re + a.im * b.im) / denom,
        im: (a.im * b.re - a.re * b.im) / denom
    };
}

function cReal(x: number): Complex {
    return { re: x, im: 0 };
}

function cInv(a: Complex): Complex {
    return cDiv({ re: 1, im: 0 }, a);
}

// ─── Gaussian Beam Physics ────────────────────────────────────────────

/**
 * Compute beam radius w(z) from the q-parameter.
 * 1/q = 1/R - i·λ/(π·w²)
 * So Im(1/q) = -λ/(π·w²), therefore w = sqrt(-λ/(π·Im(1/q)))
 */
export function beamRadius(q: Complex, wavelengthMm: number): number {
    const invQ = cInv(q);
    const imInvQ = invQ.im;
    if (imInvQ >= 0) return 100; // Fallback: shouldn't happen for valid q
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
 * Apply ABCD matrix to q-parameter:
 *   q_out = (A·q + B) / (C·q + D)
 */
function applyABCD(q: Complex, abcd: [number, number, number, number]): Complex {
    const [A, B, C, D] = abcd;
    const numerator = cAdd(cMul(cReal(A), q), cReal(B));
    const denominator = cAdd(cMul(cReal(C), q), cReal(D));
    return cDiv(numerator, denominator);
}

/**
 * Free-space propagation of q-parameter:
 *   q_out = q_in + d
 * (d is the physical distance in mm)
 */
function propagateFreeSpace(q: Complex, distance: number): Complex {
    return cAdd(q, cReal(distance));
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
 * A single segment of the Gaussian beam, between two interaction points.
 * The beam is sampled along this segment to build the envelope mesh.
 */
export interface GaussianBeamSegment {
    start: Vector3;
    end: Vector3;
    direction: Vector3;
    wavelength: number;     // meters (SI, matching Ray.wavelength)
    power: number;          // Axial power P(z)

    // q-parameter at start and end (tangential / X-plane)
    qx_start: Complex;
    qx_end: Complex;
    // q-parameter at start and end (sagittal / Y-plane)
    qy_start: Complex;
    qy_end: Complex;

    // Polarization state at the start of this segment (from Solver 1 ray data)
    polarization: JonesVector;
    // Accumulated optical path length at segment start (mm)
    opticalPathLength: number;
    // Refractive index of the medium (1.0 for air, >1 for glass)
    refractiveIndex: number;
}

// ─── Solver 2 ─────────────────────────────────────────────────────────

export class Solver2 {
    /**
     * Propagate Gaussian beams along the Solver 1 main ray skeleton.
     * 
     * @param allPaths All ray paths from Solver 1
     * @param components Scene components (for ABCD lookup)
     * @returns Array of beam segment arrays (one per main ray branch)
     */
    propagate(
        allPaths: Ray[][],
        components: OpticalComponent[]
    ): GaussianBeamSegment[][] {
        // 1. Filter to main ray paths only
        const mainPaths = allPaths.filter(
            p => p.length > 0 && p[0].isMainRay === true
        );

        if (mainPaths.length === 0) return [];

        // Build a component lookup by ID for fast matching
        const componentById = new Map<string, OpticalComponent>();
        for (const c of components) {
            componentById.set(c.id, c);
        }

        // 2. Find the source laser for each main path to get initial q
        const laserComponents = components.filter(c => c instanceof Laser) as Laser[];

        const allSegments: GaussianBeamSegment[][] = [];

        for (const path of mainPaths) {
            if (path.length < 1) continue;

            const wavelengthSI = path[0].wavelength; // meters
            const wavelengthMm = wavelengthSI * 1e3; // Convert m → mm (world units)

            // Find source laser by sourceId
            const sourceId = path[0].sourceId;
            const sourceLaser = laserComponents.find(l => l.id === sourceId);
            const waist = sourceLaser ? sourceLaser.beamWaist : 2; // mm default

            // Initialize q-parameter (symmetric beam: qx = qy)
            let qx = initialQ(waist, wavelengthMm);
            let qy = initialQ(waist, wavelengthMm);
            let power = sourceLaser ? sourceLaser.power : 1.0;

            const segments: GaussianBeamSegment[] = [];

            // 3. Walk the ray tree segment by segment
            for (let i = 0; i < path.length; i++) {
                const ray = path[i];

                // Update power from ray intensity (polarizers, beam splitters, etc.)
                power = ray.intensity;

                // If beam is fully extinct, stop generating segments
                if (power < 1e-6) break;

                // Determine segment length
                let segmentLength: number;
                if (i < path.length - 1) {
                    // Distance to next interaction point
                    segmentLength = ray.interactionDistance ??
                        path[i + 1].origin.clone().sub(ray.origin).length();
                } else {
                    // Last segment: use interactionDistance or extend to reasonable distance
                    segmentLength = ray.interactionDistance ?? 200;
                }

                if (segmentLength < 1e-6) continue;

                // Generate segments for internal path through glass (if any)
                // The ray's entryPoint and internalPath describe the path through
                // a refractive component (prism, lens). The path is:
                //   entryPoint → [internalPath bounce points] → ray.origin
                if (ray.entryPoint) {
                    const internalPts: Vector3[] = [ray.entryPoint.clone()];
                    if (ray.internalPath) {
                        for (const p of ray.internalPath) internalPts.push(p.clone());
                    }
                    internalPts.push(ray.origin.clone());

                    // Look up the refractive index of the component at the entry point
                    const glassComponent = this.findComponentAt(ray.entryPoint, components);
                    const glassIOR = (glassComponent && 'ior' in glassComponent)
                        ? (glassComponent as any).ior as number : 1.5;
                    const glassAbsorption = glassComponent
                        ? glassComponent.absorptionCoeff : 0;

                    for (let ip = 0; ip < internalPts.length - 1; ip++) {
                        const iStart = internalPts[ip];
                        const iEnd = internalPts[ip + 1];
                        const iDir = iEnd.clone().sub(iStart);
                        const iLen = iDir.length();
                        if (iLen < 1e-6) continue;
                        iDir.normalize();

                        // Propagate q through this internal leg
                        const qx_int_end = propagateFreeSpace(qx, iLen);
                        const qy_int_end = propagateFreeSpace(qy, iLen);

                        segments.push({
                            start: iStart,
                            end: iEnd,
                            direction: iDir,
                            wavelength: wavelengthSI,
                            power,
                            qx_start: { ...qx },
                            qx_end: { ...qx_int_end },
                            qy_start: { ...qy },
                            qy_end: { ...qy_int_end },
                            polarization: {
                                x: { ...ray.polarization.x },
                                y: { ...ray.polarization.y }
                            },
                            opticalPathLength: ray.opticalPathLength,
                            refractiveIndex: glassIOR
                        });

                        // Beer-Lambert absorption: P(z) = P₀ · exp(-μ · Δz)
                        if (glassAbsorption > 0) {
                            power *= Math.exp(-glassAbsorption * iLen);
                        }

                        qx = qx_int_end;
                        qy = qy_int_end;
                    }
                }

                // Propagate q through free space for this segment
                const qx_end = propagateFreeSpace(qx, segmentLength);
                const qy_end = propagateFreeSpace(qy, segmentLength);

                // Record the segment
                const endPoint = ray.origin.clone().add(
                    ray.direction.clone().multiplyScalar(segmentLength)
                );

                segments.push({
                    start: ray.origin.clone(),
                    end: endPoint,
                    direction: ray.direction.clone(),
                    wavelength: wavelengthSI,
                    power,
                    qx_start: { ...qx },
                    qx_end: { ...qx_end },
                    qy_start: { ...qy },
                    qy_end: { ...qy_end },
                    polarization: {
                        x: { ...ray.polarization.x },
                        y: { ...ray.polarization.y }
                    },
                    opticalPathLength: ray.opticalPathLength,
                    refractiveIndex: 1.0
                });

                // Update q for the next iteration (after free-space propagation)
                qx = qx_end;
                qy = qy_end;

                // 4. Apply component ABCD at the interaction point (if not last segment)
                if (i < path.length - 1) {
                    const nextOrigin = path[i + 1].origin;
                    const interactingComponent = this.findComponentAt(
                        nextOrigin, components
                    );

                    if (interactingComponent) {
                        // Get ABCD and apply (pass ray direction for prism)
                        const { abcdX, abcdY, apertureRadius } =
                            this.getComponentABCD(interactingComponent, ray.direction);

                        // Aperture clipping check
                        const wx = beamRadius(qx, wavelengthMm);
                        const wy = beamRadius(qy, wavelengthMm);
                        const wMax = Math.max(wx, wy);

                        if (apertureRadius > 0) {
                            const truncation = apertureRadius / wMax;
                            if (truncation < 2.0) {
                                // Beam is clipped — reset to aperture size
                                qx = initialQ(apertureRadius, wavelengthMm);
                                qy = initialQ(apertureRadius, wavelengthMm);
                            } else {
                                // Normal ABCD transform
                                qx = applyABCD(qx, abcdX);
                                qy = applyABCD(qy, abcdY);
                            }
                        } else {
                            // No aperture info — just apply ABCD
                            qx = applyABCD(qx, abcdX);
                            qy = applyABCD(qy, abcdY);
                        }
                    }
                }
            }

            if (segments.length > 0) {
                allSegments.push(segments);
            }
        }

        return allSegments;
    }

    /**
     * Find which component is at a given world-space point.
     * Uses proximity check against component positions.
     */
    private findComponentAt(
        point: Vector3,
        components: OpticalComponent[]
    ): OpticalComponent | null {
        let bestDist = Infinity;
        let best: OpticalComponent | null = null;

        for (const c of components) {
            // Skip non-optical components (lasers, point sources)
            if (c instanceof Laser) continue;

            const dist = c.position.distanceTo(point);
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        }

        // Must be reasonably close (within 50mm of component center)
        return bestDist < 50 ? best : null;
    }

    /**
     * Extract ABCD matrices from a component.
     * Returns separate tangential (X) and sagittal (Y) matrices,
     * plus aperture radius for clipping checks.
     */
    private getComponentABCD(component: OpticalComponent, rayDirection?: Vector3): {
        abcdX: [number, number, number, number];
        abcdY: [number, number, number, number];
        apertureRadius: number;
    } {
        const identity: [number, number, number, number] = [1, 0, 0, 1];

        if (component instanceof CylindricalLens) {
            return {
                abcdX: component.getABCD_sagittal(),
                abcdY: component.getABCD_tangential(),
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof SphericalLens) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof IdealLens) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.apertureRadius
            };
        }

        if (component instanceof Objective) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.apertureRadius
            };
        }

        if (component instanceof Mirror) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof Waveplate) {
            return {
                abcdX: identity,
                abcdY: identity,
                apertureRadius: component.apertureRadius
            };
        }

        if (component instanceof BeamSplitter) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof Aperture) {
            return {
                abcdX: identity,
                abcdY: identity,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof Filter) {
            return {
                abcdX: identity,
                abcdY: identity,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof DichroicMirror) {
            const abcd = component.getABCD();
            return {
                abcdX: abcd,
                abcdY: abcd,
                apertureRadius: component.getApertureRadius()
            };
        }

        if (component instanceof PrismLens && rayDirection) {
            const { abcdTangential, abcdSagittal } = component.getABCD_for_ray(rayDirection);
            // Prism's tangential plane (plane of incidence) is the Y-Z plane
            // (vertical), which maps to beam's Y-axis (qy). Sagittal → qx.
            return {
                abcdX: abcdSagittal,
                abcdY: abcdTangential,
                apertureRadius: 0
            };
        }

        // Default: identity (blockers, cards, etc.)
        return { abcdX: identity, abcdY: identity, apertureRadius: 0 };
    }

    // ─── Solver Handshake: E-field Query (PhysicsPlan §3.G) ───────────

    /**
     * Query the Gaussian beam intensity at any 3D point from a single branch.
     * Returns intensity [W/mm²], polarization, and accumulated phase.
     *
     * @param point  Query position in world coordinates (mm)
     * @param segments  Segments from a single beam branch (one element of propagate()'s output)
     * @returns {intensity, polarization, phase} or null if point is outside all beams
     */
    static queryIntensity(
        point: Vector3,
        segments: GaussianBeamSegment[]
    ): { intensity: number; polarization: JonesVector; phase: number } | null {
        if (segments.length === 0) return null;

        // Find the nearest segment to the query point
        let bestSeg: GaussianBeamSegment | null = null;
        let bestDist = Infinity;
        let bestT = 0; // fraction along segment

        for (const seg of segments) {
            const segDir = seg.end.clone().sub(seg.start);
            const segLen = segDir.length();
            if (segLen < 1e-6) continue;
            segDir.normalize();

            // Project point onto segment axis
            const toPoint = point.clone().sub(seg.start);
            const along = toPoint.dot(segDir);
            const t = Math.max(0, Math.min(segLen, along));

            const closest = seg.start.clone().add(segDir.clone().multiplyScalar(t));
            const dist = point.distanceTo(closest);

            if (dist < bestDist) {
                bestDist = dist;
                bestSeg = seg;
                bestT = t;
            }
        }

        if (!bestSeg) return null;

        const seg = bestSeg;
        const segDir = seg.end.clone().sub(seg.start).normalize();
        const wavelengthMm = seg.wavelength * 1e3;
        const n = seg.refractiveIndex || 1.0;
        const effectiveWl = wavelengthMm / n;

        // q-parameter at the projected point
        const qx: Complex = { re: seg.qx_start.re + bestT, im: seg.qx_start.im };
        const qy: Complex = { re: seg.qy_start.re + bestT, im: seg.qy_start.im };

        const wx = beamRadius(qx, effectiveWl);
        const wy = beamRadius(qy, effectiveWl);

        if (wx <= 0 || wy <= 0) return null;

        // Distance guard: if the query point is far from the nearest
        // segment (e.g., past an absorbing filter), don't extrapolate.
        // The beam only exists within its segment boundaries.
        const maxBeamRadius = Math.max(wx, wy);
        if (bestDist > maxBeamRadius * 5) return null;

        // Decompose displacement into transverse coordinates
        const toPoint = point.clone().sub(seg.start);
        const along = toPoint.dot(segDir);
        const transverse = toPoint.clone().sub(segDir.clone().multiplyScalar(along));

        // Build local frame (consistent with EFieldVisualizer)
        const up = new Vector3(0, 1, 0);
        if (Math.abs(segDir.dot(up)) > 0.99) up.set(1, 0, 0);
        const right = new Vector3().crossVectors(segDir, up).normalize();
        const localUp = new Vector3().crossVectors(right, segDir).normalize();

        const x = transverse.dot(right);
        const y = transverse.dot(localUp);

        // Astigmatic Gaussian intensity:
        // I(x,y) = P·(w0x·w0y)/(wx·wy) · exp(-2(x²/wx² + y²/wy²))
        // For simplicity, use P/(π·wx·wy) · exp(-2(x²/wx² + y²/wy²))
        const gaussArg = 2 * (x * x / (wx * wx) + y * y / (wy * wy));
        const gaussFactor = Math.exp(-gaussArg);
        const intensity = (seg.power / (Math.PI * wx * wy)) * gaussFactor;

        // Phase: accumulated OPL + local propagation
        const k = 2 * Math.PI / wavelengthMm; // real wavenumber in air
        const phase = k * (seg.opticalPathLength + bestT * n);

        return {
            intensity,
            polarization: seg.polarization,
            phase
        };
    }

    /**
     * Query the total intensity at a 3D point from ALL beam branches,
     * coherently summing E-fields for interference.
     *
     * @param point  Query position (mm)
     * @param allSegments  All beam branches from propagate()
     * @returns total intensity [W/mm²]
     */
    static queryIntensityMultiBeam(
        point: Vector3,
        allSegments: GaussianBeamSegment[][]
    ): number {
        // Collect contributions from each branch
        let ex_re = 0, ex_im = 0;
        let ey_re = 0, ey_im = 0;

        for (const branch of allSegments) {
            const result = Solver2.queryIntensity(point, branch);
            if (!result || result.intensity < 1e-12) continue;

            // E-field amplitude ∝ √I
            const amplitude = Math.sqrt(result.intensity);
            const phi = result.phase;

            // Vector E-field: E = amplitude · polarization · e^{iφ}
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);

            // Jones x-component
            const jx = result.polarization.x;
            ex_re += amplitude * (jx.re * cosPhi - jx.im * sinPhi);
            ex_im += amplitude * (jx.re * sinPhi + jx.im * cosPhi);

            // Jones y-component
            const jy = result.polarization.y;
            ey_re += amplitude * (jy.re * cosPhi - jy.im * sinPhi);
            ey_im += amplitude * (jy.re * sinPhi + jy.im * cosPhi);
        }

        // I = |Ex|² + |Ey|²
        return (ex_re * ex_re + ex_im * ex_im) +
            (ey_re * ey_re + ey_im * ey_im);
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
    const wavelengthMm = segment.wavelength * 1e3;
    // In a medium with index n, the effective wavelength is λ/n
    const effectiveWavelength = wavelengthMm / (segment.refractiveIndex || 1.0);
    const segLength = segment.start.distanceTo(segment.end);

    const samples: { z: number; wx: number; wy: number }[] = [];

    for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        const z = t * segLength;

        // q at position z along segment (linear interpolation of free-space)
        // q(z) = q_start + z  (free-space propagation is just adding distance)
        // But since q_end = q_start + segLength, we can interpolate:
        const qx: Complex = {
            re: segment.qx_start.re + z,
            im: segment.qx_start.im
        };
        const qy: Complex = {
            re: segment.qy_start.re + z,
            im: segment.qy_start.im
        };

        const wx = beamRadius(qx, effectiveWavelength);
        const wy = beamRadius(qy, effectiveWavelength);

        samples.push({ z, wx, wy });
    }

    return samples;
}
