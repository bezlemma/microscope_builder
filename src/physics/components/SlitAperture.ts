import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';

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
        const r = housingDiameter / 2;
        this.bounds.set(new Vector3(-r, -r, -1), new Vector3(r, r, 1));
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

        // Check if within housing bounds (circular housing)
        const rSq = hu * hu + hv * hv;
        const outerR = this.housingDiameter / 2;
        if (rSq > outerR * outerR) {
            return null;  // Misses entirely
        }

        const isBlocked = !(Math.abs(hu) < halfW && Math.abs(hv) < halfH);

        // Hit the frame body — will be absorbed
        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);
        return {
            t,
            point: hitPoint,
            normal,
            localPoint: hitPoint.clone(),
            isBlocked
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            // Absorb: ray hit the slit frame
            return { rays: [] };
        }
        
        // Pass through opening
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    getApertureRadius(): number {
        return this.slitWidth / 2;
    }
}
