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
        // Plane at w = 0 (z = 0)
        // Normal (0,0,1)
        
        const denom = rayLocal.direction.z;
        if (Math.abs(denom) < 1e-6) return null; // Parallel to plane

        const t = -rayLocal.origin.z / denom;

        if (t > 0.001) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
            
            // Rectangular bounds check
            if (Math.abs(hitPoint.x) <= this.width / 2 && Math.abs(hitPoint.y) <= this.height / 2) {
                return {
                    t: t,
                    point: hitPoint,
                    normal: new Vector3(0, 0, 1),
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
