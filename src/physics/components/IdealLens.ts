import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { transverseRadius } from '../lightSpace';

/**
 * IdealLens — A thin-lens Phase Surface per PhysicsPlan.md §6.
 *
 * Geometry: Flat plane at w = 0, bounded by a circular aperture.
 * Physics:  Deflects ray angle via the thin-lens formula:
 *           v_out = v_in - (h / f) r̂
 *           where h = radial height from axis, r̂ = radial unit vector.
 *
 * OPL:     Adds quadratic phase shift ΔOPL = -h² / (2f).
 *          This ensures correct wavefront transformation for Solver 2.
 *
 * ABCD:    [[1, 0], [-1/f, 1]] — standard thin-lens matrix for Gaussian beams.
 *
 * No aberrations, no thickness, no dispersion. Perfect paraxial optics.
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
        const h = transverseRadius(point);
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

    /**
     * Interact: thin-lens angular deflection.
     * v_out = v_in - (h / f) * r̂
     * 
     * For h = 0 (on-axis), the ray passes through undeflected.
     * OPL contribution: -h² / (2f)
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Work in local space
        const dirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const hitLocal = hit.localPoint!;

        const u = hitLocal.x;
        const v = hitLocal.y;
        const h = Math.sqrt(u * u + v * v);

        let dirOut: Vector3;

        if (h < 1e-10) {
            // On-axis ray: passes through undeflected
            dirOut = dirIn.clone();
        } else {
            // Radial unit vector in UV plane
            const rHat = new Vector3(u / h, v / h, 0);

            // Thin-lens deflection: v_out = v_in - (h / f) * r̂
            dirOut = dirIn.clone().sub(rHat.multiplyScalar(h / this.focalLength));
            dirOut.normalize();
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
                opticalPathLength: ray.opticalPathLength + deltaOPL
            })]
        };
    }

    /**
     * ABCD matrix for Solver 2 (Gaussian beam propagation).
     * Standard thin-lens: [[1, 0], [-1/f, 1]]
     * Returns [A, B, C, D].
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, -1 / this.focalLength, 1];
    }
}
