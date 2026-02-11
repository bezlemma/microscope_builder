import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { transverseRadius } from '../lightSpace';

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
 *   - apertureRadius = focalLength × tan(maxAngle)
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

    // Derived (recomputed on parameter change)
    focalLength: number;
    maxAngle: number;
    apertureRadius: number;

    constructor({
        NA = 0.25,
        magnification = 10,
        immersionIndex = 1.0,
        workingDistance = 10.0,
        tubeLensFocal = 200,
        name = 'Objective',
    }: {
        NA?: number;
        magnification?: number;
        immersionIndex?: number;
        workingDistance?: number;
        tubeLensFocal?: number;
        name?: string;
    } = {}) {
        super(name);
        this.NA = NA;
        this.magnification = magnification;
        this.immersionIndex = immersionIndex;
        this.workingDistance = workingDistance;
        this.tubeLensFocal = tubeLensFocal;

        // Derive
        this.focalLength = tubeLensFocal / magnification;
        this.maxAngle = Math.asin(Math.min(NA / immersionIndex, 1.0));
        this.apertureRadius = this.focalLength * Math.tan(this.maxAngle);

        this._updateBounds();
    }

    /** Recalculate derived values after any parameter change. */
    recalculate(): void {
        this.focalLength = this.tubeLensFocal / this.magnification;
        this.maxAngle = Math.asin(Math.min(this.NA / this.immersionIndex, 1.0));
        this.apertureRadius = this.focalLength * Math.tan(this.maxAngle);
        this._updateBounds();
    }

    private _updateBounds(): void {
        const a = this.apertureRadius;
        this.bounds.set(
            new Vector3(-a, -a, -0.01),
            new Vector3(a, a, 0.01)
        );
    }

    /**
     * Intersect: flat plane at w = 0, clipped to computed aperture.
     * Identical to IdealLens.intersect.
     */
    intersect(rayLocal: Ray): HitRecord | null {
        const oz = rayLocal.origin.z;
        const dz = rayLocal.direction.z;

        if (Math.abs(dz) < 1e-12) return null;

        const t = -oz / dz;
        if (t < 1e-6) return null;

        const point = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        const h = transverseRadius(point);
        if (h > this.apertureRadius) return null;

        const normal = new Vector3(0, 0, dz > 0 ? -1 : 1);

        return { t, point, normal, localPoint: point.clone() };
    }

    /**
     * Interact: Thin-lens deflection with NA clipping.
     *
     * Uses the standard thin-lens angular deflection formula:
     *   v_out = v_in - (h / f) × r̂
     *
     * This correctly handles BOTH directions:
     *   - Collimated input → converging output (focusing)
     *   - Diverging input from focal plane → collimated output (infinity space)
     *
     * The aperture clip in intersect() enforces NA limits.
     * OPL: quadratic phase shift Δ = -h² / (2f).
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;

        const u = hitLocal.x;
        const v = hitLocal.y;
        const h = Math.sqrt(u * u + v * v);

        let dirOut: Vector3;

        if (h < 1e-10) {
            // On-axis: passes through undeflected
            dirOut = dirIn.clone();
        } else {
            // Radial unit vector in UV plane (pointing outward from axis)
            const rHat = new Vector3(u / h, v / h, 0);

            // Thin-lens deflection: v_out = v_in - (h / f) × r̂
            dirOut = dirIn.clone().sub(rHat.multiplyScalar(h / this.focalLength));
            dirOut.normalize();
        }

        // Transform exit direction back to world space
        const dirOutWorld = dirOut.transformDirection(this.localToWorld).normalize();
        const hitWorld = hit.point.clone();

        // OPL: quadratic phase shift (same as IdealLens)
        // ΔOPL = -h² / (2f)
        const deltaOPL = -(h * h) / (2 * this.focalLength);

        return {
            rays: [{
                ...ray,
                origin: hitWorld,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + deltaOPL,
                entryPoint: undefined  // Clear stale entryPoint from previous thick-lens interactions
            }]
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
