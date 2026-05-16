import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';

/**
 * Aperture / Iris — an adjustable circular stop.
 *
 * Geometry: annular stop/tube centered on the local optical axis.
 * Rays hitting the ring body, outer barrel, or inner bore wall are absorbed.
 * Rays passing through the central opening continue unimpeded.
 *
 * For Solver2, the aperture radius is used for beam clipping checks.
 */
export class Aperture extends OpticalComponent {
    openingDiameter: number;  // mm — inner opening diameter (adjustable)
    housingDiameter: number;  // mm — outer housing diameter (fixed)
    thickness: number;        // mm — body length along optical axis

    constructor(
        openingDiameter: number = 10,
        housingDiameter: number = 25,
        name: string = "Aperture",
        thickness: number = 1
    ) {
        super(name);
        this.openingDiameter = openingDiameter;
        this.housingDiameter = housingDiameter;
        this.thickness = thickness;
        this.updateBounds();
    }

    updateBounds(): void {
        const r = Math.max(this.housingDiameter / 2, 0.001);
        const halfT = Math.max(this.thickness / 2, 0.001);
        this.bounds.set(new Vector3(-r, -r, -halfT), new Vector3(r, r, halfT));
        this.version++;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const innerR = Math.max(0, Math.min(this.openingDiameter / 2, this.housingDiameter / 2));
        const outerR = Math.max(this.housingDiameter / 2, innerR + 0.001);
        const halfT = Math.max(this.thickness / 2, 0.001);
        const innerRSq = innerR * innerR;
        const outerRSq = outerR * outerR;

        let tClosest = Infinity;
        let normalClosest: Vector3 | null = null;
        let blockedClosest = false;

        const consider = (t: number, normal: Vector3, isBlocked: boolean) => {
            if (t <= 0.001 || t >= tClosest) return;
            tClosest = t;
            normalClosest = normal;
            blockedClosest = isBlocked;
        };

        const { origin, direction } = rayLocal;
        const dz = direction.z;

        // Front/back annular caps. A cap hit inside the bore is a pass-through
        // hit so aperture targeting and ray visual history still see the stop.
        if (Math.abs(dz) > 1e-6) {
            for (const capZ of [-halfT, halfT]) {
                const t = (capZ - origin.z) / dz;
                if (t <= 0.001 || t >= tClosest) continue;
                const x = origin.x + direction.x * t;
                const y = origin.y + direction.y * t;
                const rSq = x * x + y * y;
                if (rSq > outerRSq) continue;
                consider(t, new Vector3(0, 0, Math.sign(capZ)), rSq >= innerRSq);
            }
        }

        // Outer barrel.
        const dx = direction.x;
        const dy = direction.y;
        const radialA = dx * dx + dy * dy;
        if (radialA > 1e-12) {
            const tryCylinder = (radius: number, blocksInsideBore: boolean) => {
                const b = 2 * (origin.x * dx + origin.y * dy);
                const c = origin.x * origin.x + origin.y * origin.y - radius * radius;
                const det = b * b - 4 * radialA * c;
                if (det < 0) return;
                const sqrtDet = Math.sqrt(det);
                for (const t of [(-b - sqrtDet) / (2 * radialA), (-b + sqrtDet) / (2 * radialA)]) {
                    if (t <= 0.001 || t >= tClosest) continue;
                    const z = origin.z + dz * t;
                    if (z < -halfT || z > halfT) continue;
                    const x = origin.x + dx * t;
                    const y = origin.y + dy * t;
                    const normal = new Vector3(x, y, 0).normalize();
                    consider(t, normal, blocksInsideBore);
                }
            };

            if (innerR > 0.001) tryCylinder(innerR, true);
            tryCylinder(outerR, true);
        }

        if (tClosest === Infinity || !normalClosest) return null;

        const hitPoint = origin.clone().add(direction.clone().multiplyScalar(tClosest));
        return {
            t: tClosest,
            point: hitPoint,
            normal: normalClosest,
            localPoint: hitPoint.clone(),
            isBlocked: blockedClosest,
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (hit.isBlocked) {
            // Absorb: ray hit the ring body
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
        return this.openingDiameter / 2;
    }
}
