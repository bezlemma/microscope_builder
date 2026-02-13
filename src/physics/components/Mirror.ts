import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

export class Mirror extends OpticalComponent {
    diameter: number;   // mm — circular aperture diameter
    thickness: number;  // mm — mirror body thickness

    constructor(diameter: number = 20, thickness: number = 2, name: string = "Mirror") {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // The visual cylinder is centered at origin with the given thickness.
        // Its two flat faces sit at x = -thickness/2 and x = +thickness/2.
        // Test both planes and return the closest hit.
        const radius = this.diameter / 2;
        const halfThickness = this.thickness / 2;
        
        const denom = rayLocal.direction.x;
        if (Math.abs(denom) < 1e-6) return null; // Parallel to both planes
        
        let bestT = Infinity;
        let bestHit: HitRecord | null = null;
        
        for (const planeX of [-halfThickness, halfThickness]) {
            const t = (planeX - rayLocal.origin.x) / denom;
            if (t > 0.001 && t < bestT) {
                const hitPoint = rayLocal.origin.clone().add(
                    rayLocal.direction.clone().multiplyScalar(t)
                );
                // Circular aperture check (in YZ plane)
                if (hitPoint.y * hitPoint.y + hitPoint.z * hitPoint.z <= radius * radius) {
                    bestT = t;
                    // Normal points outward from the face
                    const normal = new Vector3(planeX > 0 ? 1 : -1, 0, 0);
                    bestHit = {
                        t: t,
                        point: hitPoint,
                        normal: normal,
                        localPoint: hitPoint
                    };
                }
            }
        }
        
        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // If the ray approaches from the same side as the outward normal,
        // it's hitting from inside the mirror body → absorb (opaque metal).
        if (ray.direction.dot(hit.normal) >= 0) {
            return { rays: [] };
        }
        
        // Ray approaching from outside → reflect
        const reflectedDir = reflectVector(ray.direction, hit.normal);

        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    /**
     * ABCD matrix for Solver 2. Flat mirror = identity.
     * (Curved mirrors would use [[1, 0], [-2/R, 1]].)
     */
    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.diameter / 2;
    }
}
