import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export class Sample extends OpticalComponent {
    constructor(name: string = "Sample (Mickey)") {
        super(name);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Mickey Mouse Geometry (Local Space)
        // Head: Sphere r=0.5 at (0,0,0)
        // Left Ear: Sphere r=0.25 at (-0.5, 0.5, 0)
        // Right Ear: Sphere r=0.25 at (0.5, 0.5, 0)
        
        const spheres = [
            { center: new Vector3(0, 0, 0), radius: 0.5 },
            { center: new Vector3(-0.5, 0.5, 0), radius: 0.25 },
            { center: new Vector3(0.5, 0.5, 0), radius: 0.25 }
        ];

        let closestT = Infinity;
        let bestHit: HitRecord | null = null;

        for (const sphere of spheres) {
            const oc = rayLocal.origin.clone().sub(sphere.center);
            const b = oc.dot(rayLocal.direction);
            const c = oc.dot(oc) - sphere.radius * sphere.radius;
            const h = b * b - c;

            if (h >= 0) {
                const sqrtH = Math.sqrt(h);
                const t1 = -b - sqrtH;
                const t2 = -b + sqrtH;

                // Check t1
                if (t1 > 0.001 && t1 < closestT) {
                    closestT = t1;
                    const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t1));
                    bestHit = {
                        t: t1,
                        point: point,
                        normal: point.clone().sub(sphere.center).normalize(),
                        localPoint: point
                    };
                }
                 // Check t2 (only if inside)
                 else if (t2 > 0.001 && t2 < closestT) {
                    closestT = t2;
                    const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t2));
                    bestHit = {
                        t: t2,
                        point: point,
                        normal: point.clone().sub(sphere.center).normalize(),
                        localPoint: point
                    };
                }
            }
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Brightfield transmission: rays pass through the sample unchanged.
        // The sample geometry is used for visualization and future imaging solvers.
        const hitWorld = hit.point.clone();
        return {
            rays: [{
                ...ray,
                origin: hitWorld,
                direction: ray.direction.clone(),
                entryPoint: undefined  // Clear stale entryPoint from previous thick-lens interactions
            }]
        };
    }
}
