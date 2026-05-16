import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { refractPhaseSurface } from '../math_solvers';

/**
 * IdealLens — an ideal thin phase surface.
 *
 * Geometry: Flat plane at w = 0, bounded by a circular aperture.
 * Physics:  Applies the thin-lens quadratic phase profile through
 *           generalized Snell refraction at a zero-thickness surface.
 *
 * OPL:     Adds quadratic phase shift ΔOPL = -h² / (2f).
 *          This phase sheet focuses or defocuses without modeling glass bulk.
 *
 * No aberrations, no thickness, no dispersion.
 */
export class IdealLens extends OpticalComponent {
    focalLength: number;     // mm, positive = converging, negative = diverging
    apertureRadius: number;  // mm, radius of the clear aperture

    constructor(focalLength: number, apertureRadius: number, name: string = "Ideal Lens") {
        super(name);
        this.focalLength = focalLength;
        this.apertureRadius = apertureRadius;
        // Bounds: thin disc centered at origin
        this.bounds.set(
            new Vector3(-apertureRadius, -apertureRadius, -0.01),
            new Vector3(apertureRadius, apertureRadius, 0.01)
        );
    }

    /**
     * Intersect: flat plane at w = 0, clipped to circular aperture.
     */
    intersect(rayLocal: Ray): HitRecord | null {
        const ow = rayLocal.origin.z;
        const dw = rayLocal.direction.z;

        // Ray parallel to the plane — no intersection
        if (Math.abs(dw) < 1e-12) return null;

        const t = -ow / dw;
        // Must be in front of the ray
        if (t < 1e-6) return null;

        const point = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Aperture clip
        const h = Math.sqrt(point.x * point.x + point.y * point.y);
        if (h > this.apertureRadius) return null;

        // Normal: along ±w, facing the incoming ray
        const normal = new Vector3(0, 0, dw > 0 ? -1 : 1);

        return {
            t,
            point,
            normal,
            localPoint: point.clone()
        };
    }

    /** Apply the ideal thin-lens phase sheet via generalized Snell's law. */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Work in local space
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;

        const u = hitLocal.x;
        const v = hitLocal.y;
        const h = Math.sqrt(u * u + v * v);

        const normalLocal = hit.localNormal?.clone().normalize() ?? hit.normal.clone().transformDirection(this.worldToLocal).normalize();
        const phaseGradient = new Vector3(-u / this.focalLength, -v / this.focalLength, 0);
        const dirOut = refractPhaseSurface(dirIn, normalLocal, phaseGradient);
        if (!dirOut) {
            return { rays: [] };
        }

        // Transform exit direction back to world space
        const dirOutWorld = dirOut.transformDirection(this.localToWorld).normalize();
        // Hit point in world space
        const hitWorld = hit.point.clone();

        // OPL: quadratic phase shift for correct wavefront transformation
        const deltaOPL = -(h * h) / (2 * this.focalLength);

        return {
            rays: [childRay(ray, {
                origin: hitWorld,
                direction: dirOutWorld,
                opticalPathLength: ray.opticalPathLength + hit.t + deltaOPL
            })]
        };
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
