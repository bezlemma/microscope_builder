import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

/**
 * Aperture / Iris — an adjustable circular stop.
 *
 * Geometry: flat annular ring at x = 0.
 * Rays hitting the ring body are absorbed. Rays passing through
 * the central opening miss entirely and propagate unimpeded.
 *
 * For Solver2, the aperture radius is used for beam clipping checks.
 */
export class Aperture extends OpticalComponent {
    openingDiameter: number;  // mm — inner opening diameter (adjustable)
    housingDiameter: number;  // mm — outer housing diameter (fixed)

    constructor(
        openingDiameter: number = 10,
        housingDiameter: number = 25,
        name: string = "Aperture"
    ) {
        super(name);
        this.openingDiameter = openingDiameter;
        this.housingDiameter = housingDiameter;
    }

    intersect(rayLocal: Ray): HitRecord | null {

        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t)
        );

        // Annular ring check in uv transverse plane
        const hu = hitPoint.x;
        const hv = hitPoint.y;
        const rSq = hu * hu + hv * hv;
        const innerR = this.openingDiameter / 2;
        const outerR = this.housingDiameter / 2;

        // Only intersect if hit is on the annular ring (outside opening, inside housing)
        if (rSq < innerR * innerR || rSq > outerR * outerR) {
            return null;  // Passes through the opening or misses entirely
        }

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);  // ±w normal
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone()
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb: ray hit the ring body
        return { rays: [] };
    }

    // ABCD matrix — identity (aperture is just a stop, no optical power).
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    // Aperture radius for Solver2 beam clipping.
    getApertureRadius(): number {
        return this.openingDiameter / 2;
    }
}
