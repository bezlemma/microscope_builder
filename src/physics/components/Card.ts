import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3, Matrix4 } from 'three';

export class Card extends OpticalComponent {
    width: number;
    height: number;
    hits: { localPoint: Vector3, ray: Ray }[] = [];

    constructor(width: number, height: number, name: string) {
        super(name);
        this.width = width;
        this.height = height;
    }

    intersect(localRay: Ray): HitRecord | null {
        // Plane intersection at z=0 (Local frame)
        // Normal is (0,0,1)
        if (Math.abs(localRay.direction.z) < 1e-6) return null; // Parallel

        const t = -localRay.origin.z / localRay.direction.z;
        if (t < 0) return null;

        const point = localRay.origin.clone().add(localRay.direction.clone().multiplyScalar(t));

        // Check bounds (Rectangle)
        if (Math.abs(point.x) <= this.width / 2 && Math.abs(point.y) <= this.height / 2) {
            return {
                t,
                point: point.clone(), // This helps debugging, but Solver needs World point. 
                                      // Wait, chkIntersection handles transformation.
                normal: new Vector3(0, 0, 1),
                localPoint: point
            };
        }
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Record the hit for visualization
        this.hits.push({ localPoint: hit.localPoint, ray });
        
        // Pass the ray through unaffected (Viewing card probe)
        return { 
            rays: [{ 
                ...ray, 
                origin: hit.point // Continue from hit point
            }] 
        };
    }
    
    // Clear hits before new trace
    resetHits() {
        this.hits = [];
    }
}
