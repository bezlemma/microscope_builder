import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

/**
 * SlitAperture — a rectangular slit stop.
 *
 * Geometry: flat rectangular frame at local x = 0.
 * Rays hitting the frame body are absorbed. Rays passing through
 * the rectangular opening propagate unimpeded.
 *
 * Local axis convention (same as Aperture / Filter):
 *   - Local X is the optical axis (normal to the slit plane)
 *   - Local Y is horizontal (slit width direction)
 *   - Local Z is vertical (slit height direction)
 */
export class SlitAperture extends OpticalComponent {
    slitWidth: number;       // mm — horizontal opening (local Y)
    slitHeight: number;      // mm — vertical opening (local Z)
    housingDiameter: number; // mm — outer frame size

    constructor(
        slitWidth: number = 5,
        slitHeight: number = 20,
        housingDiameter: number = 25,
        name: string = "Slit Aperture"
    ) {
        super(name);
        this.slitWidth = slitWidth;
        this.slitHeight = slitHeight;
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

        // Check if ray passes through the rectangular opening
        const hu = hitPoint.x;  // horizontal (width)
        const hv = hitPoint.y;  // vertical (height)
        const halfW = this.slitWidth / 2;
        const halfH = this.slitHeight / 2;

        // If inside the opening, ray passes through — no intersection
        if (Math.abs(hu) < halfW && Math.abs(hv) < halfH) {
            return null;
        }

        // Check if within housing bounds (circular housing)
        const rSq = hu * hu + hv * hv;
        const outerR = this.housingDiameter / 2;
        if (rSq > outerR * outerR) {
            return null;  // Misses entirely
        }

        // Hit the frame body — will be absorbed
        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone()
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb: ray hit the slit frame
        return { rays: [] };
    }

    // ABCD matrix — identity (slit is just a stop, no optical power).
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    // Aperture radius for Solver2 beam clipping — use half the slit width.
    getApertureRadius(): number {
        return this.slitWidth / 2;
    }

    /** Override: slit clips only in X direction, Y is unobstructed */
    getComponentABCD(): {
        abcdX: [number, number, number, number];
        abcdY: [number, number, number, number];
        apertureRadius: number;
    } {
        return {
            abcdX: this.getABCD(),
            abcdY: [1, 0, 0, 1],
            apertureRadius: this.getApertureRadius()
        };
    }
}
