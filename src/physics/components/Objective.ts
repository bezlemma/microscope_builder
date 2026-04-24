import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import type { PupilFunction } from '../PupilFunction';

export type ImmersionMediumKind = 'air' | 'oil' | 'water' | 'silicone' | 'custom';

/**
 * Objective — Aplanatic Phase Surface (Ideal Microscope Objective)
 *
 * A zero-thickness phase surface that satisfies the Abbe Sine Condition:
 *   sin(θ_out) = h / f
 *
 * Unlike an ideal thin lens phase sheet, this component correctly focuses
 * rays at ANY numerical aperture —
 * no spherical aberration, even at NA=1.4 (θ ≈ 67°).
 *
 * Parameters (microscopy-native):
 *   - NA:             Numerical Aperture (defines light collection)
 *   - magnification:  System magnification (with tube lens)
 *   - immersionIndex: Refractive index of immersion medium (Air=1, Water=1.33, Oil=1.515)
 *   - workingDistance: Physical distance from front of objective to sample plane (mm)
 *   - tubeLensFocal:  Tube lens focal length for the microscope standard (Nikon=200, Olympus=180, Zeiss=165)
 *
 * Derived:
 *   - focalLength    = tubeLensFocal / magnification
 *   - maxAngle       = arcsin(NA / immersionIndex)
 *   - apertureRadius = focalLength × (NA / immersionIndex) (Exact Abbe Sine relation)
 *
 * TODO: Solver 2 still uses the paraxial q-parameter transfer [[1,0],[-1/f,1]].
 *       That remains separate from the surface-by-surface ray interaction here.
 *
 * TODO: Solver 3 (Imaging) — The immersion medium creates a region of
 *       index `n` between the sample and the objective. Backward tracing
 *       from the image plane through the tube lens + objective should
 *       correctly map image points to sample points. The aplanatic
 *       condition guarantees this mapping is free of coma.
 *
 * TODO: Solver 4 (Coherent) — Apply phase shift Δφ = (2π/λ) × ΔOPL
 *       for interference calculations. The OPL contribution below is
 *       the same quadratic form as IdealLens.
 *
 * TODO: Immersion Medium — When immersionIndex > 1, the region between
 *       this objective and the sample should propagate rays at n = immersionIndex.
 *       This affects OPL accumulation and is critical for lightsheet microscopy
 *       where rays travel through containers with different indices.
 *       Current implementation: immersionIndex affects the max acceptance angle
 *       and deflection math, but does NOT yet modify the medium for other rays
 *       in the scene. That requires a "Medium" or "Immersion Volume" system.
 */
export class Objective extends OpticalComponent {
    NA: number;
    magnification: number;
    immersionIndex: number;
    workingDistance: number;
    tubeLensFocal: number;
    diameter: number;           // Physical barrel diameter (mm) — for visual sizing, independent of NA

    // Derived (recomputed on parameter change)
    focalLength: number;
    maxAngle: number;
    apertureRadius: number;     // Optical clear aperture from NA — used for ray clipping

    // Extended properties (BOMB compatibility)
    coverslipThickness: number = 0.17;  // mm — standard #1.5 coverslip
    fieldNumber: number = 22;           // mm — field of view at the intermediate image plane
    immersionMediumKind: ImmersionMediumKind = 'air';
    pupil: PupilFunction | null = null; // null = diffraction-limited (no custom pupil)
    pupilRadius: number = 0;            // Pupil plane radius (derived)

    constructor({
        NA = 0.25,
        magnification = 10,
        immersionIndex = 1.0,
        workingDistance = 10.0,
        tubeLensFocal = 200,
        diameter = 20,
        name = 'Objective',
    }: {
        NA?: number;
        magnification?: number;
        immersionIndex?: number;
        workingDistance?: number;
        tubeLensFocal?: number;
        diameter?: number;
        name?: string;
    } = {}) {
        super(name);
        this.NA = NA;
        this.magnification = magnification;
        this.immersionIndex = immersionIndex;
        this.workingDistance = workingDistance;
        this.tubeLensFocal = tubeLensFocal;
        this.diameter = diameter;

        // Derive
        this.focalLength = tubeLensFocal / magnification;
        const indexRatio = Math.min(NA / immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        // Abbe Sine Condition: h = f * NA (back focal plane beam height)
        this.apertureRadius = this.focalLength * NA;

        this._updateBounds();
    }

    /** Recalculate derived values after any parameter change. */
    recalculate(): void {
        this.focalLength = this.tubeLensFocal / this.magnification;
        const indexRatio = Math.min(this.NA / this.immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        this.apertureRadius = this.focalLength * this.NA;
        this._updateBounds();
        this.version++;
    }

    /** Change magnification while preserving sample-side geometry. */
    setMagnificationPreserveSampleSide(newMag: number): void {
        this.magnification = newMag;
        this.tubeLensFocal = this.focalLength * newMag;
        this.recalculate();
    }

    /** Set immersion medium by kind name. */
    setImmersionMedium(kind: ImmersionMediumKind): void {
        this.immersionMediumKind = kind;
        if (kind === 'oil') this.immersionIndex = 1.515;
        else if (kind === 'water') this.immersionIndex = 1.33;
        else if (kind === 'silicone') this.immersionIndex = 1.406;
        else if (kind === 'custom') { /* leave existing index untouched */ }
        else this.immersionIndex = 1.0;
        this.recalculate();
    }

    private _updateBounds(): void {
        const f = this.focalLength;
        const wd = this.workingDistance;
        const a = this.apertureRadius;
        
        // Match the bounding cylinder from intersect() and visualizer
        const bodyR = Math.max(a + 1, this.diameter / 2);
        const parfocalDistance = 35;
        const zFront = -f + wd;
        const zBack = Math.max(-f + parfocalDistance, zFront + 20);

        // Bounds must cover the physical cylinder AND the optical Abbe sphere (starts at -f)
        // AND the principal plane (z=0.01)
        const minZ = Math.min(-f, zFront);
        const maxZ = Math.max(0.01, zBack);

        this.bounds.set(
            new Vector3(-bodyR, -bodyR, minZ),
            new Vector3(bodyR, bodyR, maxZ)
        );
    }

    /**
     * Intersect: 
     * Applies the rigorous Abbe Sine Condition by intersecting with the 
     * Abbe Reference Sphere on the object side (facing -Z).
     * The sphere is centered at the focal point (0, 0, -f) with radius f.
     * Light coming from the back (+Z) intersects the flat principal plane at z=0.
     * 
     * Also fully encompasses the metal barrel geometry to block stray light!
     */
    intersect(rayLocal: Ray): HitRecord | null {
        // --- 1. PHYSICAL ENCLOSURE INTERSECTION ---
        // Mirror the exact math from ObjectiveVisualizer
        const f = this.focalLength;
        const wd = this.workingDistance;
        const a = this.apertureRadius;
        const bodyR = Math.max(a + 1, this.diameter / 2);
        
        const parfocalDistance = 35;
        const zFront = -f + wd;
        const zBack = Math.max(-f + parfocalDistance, zFront + 20);

        const immersionIdx = this.immersionIndex || 1;
        const maxSin = this.NA / immersionIdx;
        const maxTan = maxSin / Math.sqrt(1 - maxSin * maxSin);
        const opticalFrontRadius = wd * maxTan; 
        const frontRadius = Math.max(opticalFrontRadius + 0.5, 2);

        const zTaperEnd = zFront + Math.min(15, (zBack - zFront) * 0.6);

        const ox = rayLocal.origin.x;
        const oy = rayLocal.origin.y;
        const oz = rayLocal.origin.z;
        const dx = rayLocal.direction.x;
        const dy = rayLocal.direction.y;
        const dz = rayLocal.direction.z;

        const candidates: {t: number, type: 'wall'|'taper'|'front'|'back', r?: number}[] = [];

        // 1. Taper intersection (cone from zFront to zTaperEnd)
        const dzTaper = zTaperEnd - zFront;
        if (dzTaper > 1e-6) {
            const k = (bodyR - frontRadius) / dzTaper;
            const M = frontRadius - k * zFront; // R(z) = M + k*z
            const A_cone = dx * dx + dy * dy - k * k * dz * dz;
            const B_cone = 2 * (ox * dx + oy * dy - M * k * dz - k * k * oz * dz);
            const C_cone = ox * ox + oy * oy - M * M - 2 * M * k * oz - k * k * oz * oz;
            
            if (Math.abs(A_cone) > 1e-12) {
                const disc = B_cone * B_cone - 4 * A_cone * C_cone;
                if (disc >= 0) {
                    const t1 = (-B_cone - Math.sqrt(disc)) / (2 * A_cone);
                    const t2 = (-B_cone + Math.sqrt(disc)) / (2 * A_cone);
                    if (t1 > 1e-6) {
                        const hz1 = oz + t1 * dz;
                        if (hz1 >= zFront && hz1 <= zTaperEnd) {
                            // Ensure it's the positive radius solution
                            const rAtZ = M + k * hz1;
                            if (rAtZ > 0) candidates.push({t: t1, type: 'taper'});
                        }
                    }
                    if (t2 > 1e-6) {
                        const hz2 = oz + t2 * dz;
                        if (hz2 >= zFront && hz2 <= zTaperEnd) {
                            const rAtZ = M + k * hz2;
                            if (rAtZ > 0) candidates.push({t: t2, type: 'taper'});
                        }
                    }
                }
            } else if (Math.abs(B_cone) > 1e-12) {
                const t = -C_cone / B_cone;
                if (t > 1e-6) {
                    const hz = oz + t * dz;
                    if (hz >= zFront && hz <= zTaperEnd) {
                        const rAtZ = M + k * hz;
                        if (rAtZ > 0) candidates.push({t: t, type: 'taper'});
                    }
                }
            }
        }

        // 2. Main Cylinder intersection
        const A_cyl = dx * dx + dy * dy;
        const B_cyl = 2 * (ox * dx + oy * dy);
        const C_cyl = ox * ox + oy * oy - bodyR * bodyR;
        if (A_cyl > 1e-12) {
            const disc = B_cyl * B_cyl - 4 * A_cyl * C_cyl;
            if (disc >= 0) {
                const t1 = (-B_cyl - Math.sqrt(disc)) / (2 * A_cyl);
                const t2 = (-B_cyl + Math.sqrt(disc)) / (2 * A_cyl);
                if (t1 > 1e-6) {
                    const hz1 = oz + t1 * dz;
                    if (hz1 >= zTaperEnd && hz1 <= zBack) candidates.push({t: t1, type: 'wall'});
                }
                if (t2 > 1e-6) {
                    const hz2 = oz + t2 * dz;
                    if (hz2 >= zTaperEnd && hz2 <= zBack) candidates.push({t: t2, type: 'wall'});
                }
            }
        }

        // 3. Intersect planes z = zFront, z = zBack
        let tFront = Infinity;
        let tBack = Infinity;
        if (Math.abs(dz) > 1e-12) {
            tFront = (zFront - oz) / dz;
            tBack = (zBack - oz) / dz;
        }

        if (tFront > 1e-6) {
            const hitX = ox + tFront * dx;
            const hitY = oy + tFront * dy;
            const r2 = hitX * hitX + hitY * hitY;
            if (r2 <= frontRadius * frontRadius) candidates.push({t: tFront, type: 'front', r: Math.sqrt(r2)});
        }
        if (tBack > 1e-6) {
            const hitX = ox + tBack * dx;
            const hitY = oy + tBack * dy;
            const r2 = hitX * hitX + hitY * hitY;
            if (r2 <= bodyR * bodyR) candidates.push({t: tBack, type: 'back', r: Math.sqrt(r2)});
        }

        if (candidates.length === 0) return null; // Missed entire physical bounds entirely

        candidates.sort((c1, c2) => c1.t - c2.t);
        const bboxHit = candidates[0];

        let isBlocked = true;

        if (bboxHit.type === 'wall' || bboxHit.type === 'taper') {
            isBlocked = true; // Side walls and taper are solid metal
        } else if (bboxHit.type === 'front') {
            // Allow rays to pass if they are within the physical clear aperture,
            // which includes a buffer for the off-axis field of view (FOV).
            if (bboxHit.r !== undefined && bboxHit.r <= frontRadius) {
                isBlocked = false; // Entered clear aperture
            }
        } else if (bboxHit.type === 'back') {
            // The back clear aperture is defined by the principal plane size (this.apertureRadius)
            if (bboxHit.r !== undefined && bboxHit.r <= a) {
                isBlocked = false; // Entered clear back plane
            }
        }

        if (isBlocked) {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            let normal = new Vector3(0, 0, 1);
            if (bboxHit.type === 'front') normal.set(0, 0, -1);
            else if (bboxHit.type === 'wall') normal.set(point.x, point.y, 0).normalize();
            
            return {
                t: bboxHit.t,
                point, // We calculate world point higher up in the component pipeline anyway, pipeline overrides this point field usually
                normal,
                localPoint: point,
                isBlocked: true
            };
        }

        // --- 2. OPTICAL INTERSECTION (ABBE SINE CONDITION) ---
        // If we reach here, the ray entered through the clear glass aperture.
        // We now perform the standard mathematical Abbe intersection.
        const dw = rayLocal.direction.z;

        if (Math.abs(dw) < 1e-12) return null;

        let tHit = -1;
        let normal = new Vector3();

        // ALWAYS intersect Abbe Reference Sphere: Center C = (0, 0, -f), R = f
        // This is exactly required by the Abbe Sine Condition to eliminate spherical aberration
        // in BOTH forward and backward (infinity-space) ray paths!
        const ozC = rayLocal.origin.z + f;
        const b = ox * rayLocal.direction.x + oy * rayLocal.direction.y + ozC * dw;
        const c = (ox * ox + oy * oy + ozC * ozC) - f * f;
        const disc = b * b - c;

        const returnBlocked = () => {
            const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(bboxHit.t));
            return {
                t: bboxHit.t,
                point,
                normal: (bboxHit.type === 'front') ? new Vector3(0, 0, -1) : new Vector3(0,0,1),
                localPoint: point,
                isBlocked: true
            };
        };

        if (disc < 0) return returnBlocked();

        const t1 = -b - Math.sqrt(disc);
        const t2 = -b + Math.sqrt(disc);

        // We only want hits on the right hemisphere of the Abbe sphere (z >= -f)
        // This stops rays coming from the front being intercepted 2f in front of the objective.
        const checkFace = (t: number) => {
            if (t <= 1e-6) return false;
            const pt = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            // Ensure the hit is between -f and 0.
            return pt.z >= -f - 1e-4; 
        };

        if (checkFace(t1)) tHit = t1;
        else if (checkFace(t2)) tHit = t2;

        if (tHit <= 0) {
            // No valid collision with the correct face of the sphere. 
            // If the ray is exiting the sphere and heading out, allow it to pass gracefully.
            return null;
        }

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tHit));
        
        // Exclude rays that hit the correct half of the sphere, but OUTSIDE the clear aperture.
        const rt2 = point.x * point.x + point.y * point.y;
        if (rt2 > this.apertureRadius * this.apertureRadius) {
            return returnBlocked();
        }

        if (point.z > 0.001) return returnBlocked(); // Must hit the front hemisphere (z <= 0)

        // Normal of the sphere at hit point points radially outward from center
        normal.set(point.x, point.y, point.z + f).normalize();
        // We want normal facing AGAINST the ray
        if (normal.dot(rayLocal.direction) > 0) normal.negate();

        return { t: tHit, point, normal, localPoint: point.clone() };
    }

    /**
     * Interact: aplanatic redirection on the Abbe reference sphere.
     *
     * Abbe sine condition: a sample point at height h on the front focal plane
     * (z = -f) corresponds to a parallel beam in image space whose angle θ to
     * the optical axis satisfies h = f · sin(θ). Equivalently, in direction
     * cosines, a unit parallel-beam direction d with optical-axis component
     * d.z maps to the focal-plane point (f · d.x, f · d.y, -f).
     *
     * We support both propagation senses:
     *   • FORWARD (ray from sample toward the pupil, dirInLocal.z > 0):
     *     The sample point is the ray's CURRENT origin projected onto the FFP.
     *     The outgoing direction is the parallel-beam direction determined by
     *     the aplanatic mapping: d_out = (s.x/f, s.y/f, +sqrt(1 - (s.x/f)² - (s.y/f)²)).
     *   • BACKWARD (ray from pupil toward sample, dirInLocal.z < 0):
     *     The incoming direction IS the parallel-beam direction, so
     *     sample_point = (f · d_in.x, f · d_in.y, -f). The outgoing direction
     *     points from the hit point toward the sample point, converging to it.
     *
     * Because each pixel's backward rays all share the same parallel-beam
     * direction (after the tube lens), they converge at the SAME sample point —
     * which is the conjugate of the pixel. Different pixels → different sample
     * points → an image forms. The earlier implementation pointed every
     * backward ray at (0, 0, -f), collapsing all pixels to a single sample
     * point and producing only noise.
     *
     * Because hit points lie on the Abbe reference sphere, the OPL from any
     * hit point to the conjugate focal-plane point is constant (= f · n). No
     * per-height phase correction is applied.
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            return { rays: [] }; // Ray crashed into the solid metal bounds
        }

        const dirInLocal = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;
        const opl = ray.opticalPathLength + hit.t;
        const f = this.focalLength;

        // Short-circuit when the hit point is essentially on the optical axis
        // AND the ray is on-axis (no bend needed, avoids division-by-zero).
        const hitRadSq = hitLocal.x * hitLocal.x + hitLocal.y * hitLocal.y;
        const dirRadSq = dirInLocal.x * dirInLocal.x + dirInLocal.y * dirInLocal.y;
        if (hitRadSq < 1e-14 && dirRadSq < 1e-14) {
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
                    direction: ray.direction.clone(),
                    opticalPathLength: opl,
                })],
            };
        }

        let dirOutLocal: Vector3;

        if (dirInLocal.z < 0) {
            // BACKWARD: incoming parallel beam; aplanatic map sends it to sample
            // point (f · d.x, f · d.y, -f) on the front focal plane.
            const sx = f * dirInLocal.x;
            const sy = f * dirInLocal.y;
            const sz = -f;
            const vx = sx - hitLocal.x;
            const vy = sy - hitLocal.y;
            const vz = sz - hitLocal.z;
            const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (vLen < 1e-12) {
                // Hit point coincides with sample point — preserve direction.
                dirOutLocal = dirInLocal.clone();
            } else {
                dirOutLocal = new Vector3(vx / vLen, vy / vLen, vz / vLen);
            }
        } else {
            // FORWARD: ray originated at or near the FFP. Take the sample point
            // as the ray's intersection with z = -f. Outgoing direction is
            // the parallel-beam direction determined by that sample point.
            const originLocal = ray.origin.clone().applyMatrix4(this.worldToLocal);
            let sx = originLocal.x;
            let sy = originLocal.y;
            
            // Project along ray to the front focal plane (z = -f)
            if (Math.abs(dirInLocal.z) > 1e-12) {
                const tToFFP = (-f - originLocal.z) / dirInLocal.z;
                sx = originLocal.x + tToFFP * dirInLocal.x;
                sy = originLocal.y + tToFFP * dirInLocal.y;
            }

            const sinX = sx / f;
            const sinY = sy / f;
            const sinSq = sinX * sinX + sinY * sinY;
            if (sinSq >= 1) {
                // Outside the NA cone — treat as blocked.
                return { rays: [] };
            }
            const cosZ = Math.sqrt(1 - sinSq);
            dirOutLocal = new Vector3(sinX, sinY, cosZ);
        }

        const dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: dirOutWorld,
                opticalPathLength: opl,
            })],
        };
    }

    /**
     * Solver 2 q-parameter transfer for this ideal objective.
     *
     * Gaussian beams remain paraxial in Solver 2, so the ideal-objective
     * q transform stays as the thin-lens transfer there.
     */
    getParaxialTransform(): [number, number, number, number] {
        return [1, 0, -1 / this.focalLength, 1];
    }

    /** Formatted label for visualization. */
    get label(): string {
        const immersionStr = this.immersionIndex > 1.3
            ? (this.immersionIndex > 1.4 ? ' Oil' : ' Water')
            : '';
        return `${this.magnification}x / ${this.NA}${immersionStr}`;
    }

    // ── Helper methods for immersion bridges ─────────────────────────────

    /** Local Z coordinate of the sample-side principal plane. */
    getSampleSideLocalZ(): number {
        return -this.focalLength + this.workingDistance;
    }

    /** Optical aperture radius at the sample side based on NA and working distance. */
    getOpticalFrontRadius(): number {
        const maxSin = Math.min(this.NA / this.immersionIndex, 1.0);
        const maxTan = maxSin / Math.sqrt(Math.max(1 - maxSin * maxSin, 1e-9));
        return this.workingDistance * maxTan;
    }

    /** Physical front radius (optical + margin). */
    getFrontRadius(): number {
        return Math.max(this.getOpticalFrontRadius() + 0.5, 2);
    }

    /** World-space position of the sample-side center. */
    getSampleSideCenterWorld(): Vector3 {
        this.updateMatrices();
        return new Vector3(0, 0, this.getSampleSideLocalZ()).applyMatrix4(this.localToWorld);
    }

    /** World-space normal pointing from sample toward objective. */
    getSampleSideNormalWorld(): Vector3 {
        this.updateMatrices();
        return new Vector3(0, 0, -1).transformDirection(this.localToWorld).normalize();
    }
}
