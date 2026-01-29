import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { reflectVector } from '../math_solvers';

export class Mirror extends OpticalComponent {
    width: number;
    height: number;

    constructor(width: number, height: number, name: string = "Mirror") {
        super(name);
        this.width = width;
        this.height = height;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Plane at x = 0 (Normal 1,0,0)
        
        const denom = rayLocal.direction.x;
        if (Math.abs(denom) < 1e-6) return null; // Parallel to plane

        const t = -rayLocal.origin.x / denom;

        if (t > 0.001) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // Circular aperture check (in YZ plane)
            const radius = this.width / 2;
            // Check radius squared against y^2 + z^2
            if (hitPoint.y * hitPoint.y + hitPoint.z * hitPoint.z <= radius * radius) {
                return {
                    t: t,
                    point: hitPoint,
                    normal: new Vector3(1, 0, 0),
                    localPoint: hitPoint
                };
            }
        }
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Always reflect
        // Ensure normal opposes ray
        const normal = ray.direction.dot(hit.normal) < 0 ? hit.normal : hit.normal.clone().negate();
        const reflectedDir = reflectVector(ray.direction, normal);

        return {
            rays: [{
                ...ray,
                origin: hit.point,
                direction: reflectedDir,
                opticalPathLength: ray.opticalPathLength + hit.t // Air
            }]
        };
    }
}
