import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';

/**
 * DoubleSlit — two parallel rectangular slit openings in a flat plate.
 *
 * Geometry: flat plate at local z = 0 with two vertical slits
 * separated by a center bar. Rays passing through either opening
 * propagate; rays hitting the plate body are absorbed.
 *
 * Local axes (same as SlitAperture):
 *   Local Z = optical axis (normal to plane)
 *   Local X = horizontal (slits separated along X)
 *   Local Y = vertical (slit height direction)
 */
export class DoubleSlit extends OpticalComponent {
    slitWidth: number;
    slitSeparation: number;
    slitHeight: number;
    housingDiameter: number;

    constructor(
        slitWidth: number = 0.5,
        slitSeparation: number = 2,
        slitHeight: number = 20,
        housingDiameter: number = 25,
        name: string = 'Double Slit',
    ) {
        super(name);
        this.slitWidth = slitWidth;
        this.slitSeparation = slitSeparation;
        this.slitHeight = slitHeight;
        this.housingDiameter = housingDiameter;
        const r = housingDiameter / 2;
        this.bounds.set(new Vector3(-r, -r, -1), new Vector3(r, r, 1));
    }

    /** Check if point (u, v) falls inside either slit opening. */
    private isInsideSlit(u: number, v: number): boolean {
        const halfSep = this.slitSeparation / 2;
        const halfW = this.slitWidth / 2;
        const halfH = this.slitHeight / 2;
        if (Math.abs(v) > halfH) return false;
        // Left slit centered at u = -halfSep
        if (Math.abs(u + halfSep) < halfW) return true;
        // Right slit centered at u = +halfSep
        if (Math.abs(u - halfSep) < halfW) return true;
        return false;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const dw = rayLocal.direction.z;
        if (Math.abs(dw) < 1e-6) return null;

        const t = -rayLocal.origin.z / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(
            rayLocal.direction.clone().multiplyScalar(t),
        );

        const hu = hitPoint.x;
        const hv = hitPoint.y;

        // Outside housing entirely — miss
        const outerR = this.housingDiameter / 2;
        if (hu * hu + hv * hv > outerR * outerR) return null;

        const normal = new Vector3(0, 0, dw < 0 ? 1 : -1);

        if (this.isInsideSlit(hu, hv)) {
            // Clean pass through a slit opening
            return {
                t, point: hitPoint, normal, localPoint: hitPoint.clone(),
                isBlocked: false,
            };
        }

        // Hit the plate body — mark as blocked
        return { t, point: hitPoint, normal, localPoint: hitPoint.clone(), isBlocked: true };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // If blocked (plate body), absorb
        if (hit.isBlocked) {
            return { rays: [] };
        }

        // Pass through slit opening
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                opticalPathLength: ray.opticalPathLength + hit.t,
            })],
            passthrough: true,
        };
    }
}
