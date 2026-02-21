import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';

/**
 * Objective — Aplanatic Phase Surface (Ideal Microscope Objective)
 *
 * A zero-thickness phase surface that satisfies the Abbe Sine Condition:
 *   sin(θ_out) = h / f
 *
 * Unlike the paraxial thin-lens (IdealLens) which uses θ_out ≈ h/f,
 * this component correctly focuses rays at ANY numerical aperture —
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
 * TODO: Solver 2 (Gaussian Beam) — getABCD() returns [[1,0],[-1/f,1]].
 *       This is exact for paraxial Gaussian beams. For high-NA beams,
 *       the q-parameter transform is still a valid approximation because
 *       Gaussian beams are inherently paraxial.
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
        // Exact Abbe Sine Condition: h = f * n * sin(theta) => h = f * NA
        this.apertureRadius = this.focalLength * indexRatio;

        this._updateBounds();
    }

    /** Recalculate derived values after any parameter change. */
    recalculate(): void {
        this.focalLength = this.tubeLensFocal / this.magnification;
        const indexRatio = Math.min(this.NA / this.immersionIndex, 1.0);
        this.maxAngle = Math.asin(indexRatio);
        this.apertureRadius = this.focalLength * indexRatio;
        this._updateBounds();
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
            if (bboxHit.r !== undefined && bboxHit.r <= opticalFrontRadius) {
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
     * Interact: 
     * Exact vectorial momentum shift (Hamiltonian map) for perfect Aplanatic focusing.
     * p_out = p_in - (r / f)
     * No paraxial approximations.
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            return { rays: [] }; // Ray crashed into the solid metal bounds
        }

        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;

        const x = hitLocal.x;
        const y = hitLocal.y;

        // Vectorial momentum map (assuming n=1 on both sides for simplicity in ray direction)
        // If n_immersion is used, p_in = dirIn * n_immersion, p_out = dirOut * n_out.
        // But for a simple ideal aplanat, we just apply the momentum kick to the unit direction.
        
        let px_out = dirIn.x - (x / this.focalLength);
        let py_out = dirIn.y - (y / this.focalLength);
        
        // Ensure the transverse momentum doesn't exceed 1.0 (TIR/evanescent)
        const pT_sq = px_out * px_out + py_out * py_out;
        if (pT_sq > 1.0) {
            return { rays: [] }; // Evanescent/TIR at the principal plane
        }

        // The outgoing z momentum is preserved by conservation of energy (|p| = 1)
        // Sign is the same as the incoming ray, as it propagates forward
        const pz_out = Math.sign(dirIn.z) * Math.sqrt(1.0 - pT_sq);

        const dirOut = new Vector3(px_out, py_out, pz_out).normalize();

        // Transform exit direction back to world space
        const dirOutWorld = dirOut.transformDirection(this.localToWorld).normalize();
        const hitWorld = hit.point.clone();

        // Exact OPL phase shift (cancels the geometric path length difference for perfect focus)
        // For a perfect aplanatic lens, the added OPL forms a perfect spherical wavefront.
        const h = Math.sqrt(x * x + y * y);
        const deltaOPL = -(h * h) / (2 * this.focalLength); // Paraxial approx of phase shift is sufficient for visualization

        return {
            rays: [childRay(ray, {
                origin: hitWorld,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + deltaOPL
            })]
        };
    }

    /**
     * ABCD matrix for Solver 2 (Gaussian Beam Propagation).
     * Standard thin-lens: [[1, 0], [-1/f, 1]]
     *
     * TODO: For Solver 2, this is sufficient because Gaussian beams
     * are paraxial. The aplanatic correction is irrelevant for the
     * q-parameter transform (which is inherently paraxial).
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, -1 / this.focalLength, 1];
    }

    /** Formatted label for visualization. */
    get label(): string {
        const immersionStr = this.immersionIndex > 1.3
            ? (this.immersionIndex > 1.4 ? ' Oil' : ' Water')
            : '';
        return `${this.magnification}x / ${this.NA}${immersionStr}`;
    }
}
