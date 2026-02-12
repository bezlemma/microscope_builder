import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3 } from 'three';

export class Blocker extends OpticalComponent {
    width: number;
    height: number;
    depth: number;

    constructor(width: number = 20, height: number = 40, depth: number = 5, name: string = "Blocker") {
        super(name);
        this.width = width;
        this.height = height;
        this.depth = depth;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Cylindrical Intersection (Axis X - Thickness along X)
        // "Face" is in YZ plane.
        const radius = this.width / 2;
        const halfDepth = this.depth / 2;

        const oy = rayLocal.origin.y;
        const oz = rayLocal.origin.z;
        const dy = rayLocal.direction.y;
        const dz = rayLocal.direction.z;

        let tClosest = Infinity;
        let normalClosest: Vector3 | null = null;
        
        // 1. Check Cylinder Wall / Rim: y^2 + z^2 = r^2  (Cylinder Axis X)
        // Note: Blocker "Face" is usually flat. So the "Cylinder Wall" is the rim.
        // The "Caps" are the main blocking faces.
        
        const A = dy*dy + dz*dz;
        const B = 2 * (oy*dy + oz*dz);
        const C = oy*oy + oz*oz - radius*radius;

        if (Math.abs(A) > 1e-6) {
            const det = B*B - 4*A*C;
            if (det >= 0) {
                const sqrtDet = Math.sqrt(det);
                const t1 = (-B - sqrtDet) / (2*A);
                const t2 = (-B + sqrtDet) / (2*A);

                [t1, t2].forEach(t => {
                   if (t > 0.001 && t < tClosest) {
                       const x = rayLocal.origin.x + t * rayLocal.direction.x;
                       if (x >= -halfDepth && x <= halfDepth) {
                           tClosest = t;
                           const hitP = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                           normalClosest = new Vector3(0, hitP.y, hitP.z).normalize();
                       }
                   }
                });
            }
        }

        // 2. Check Caps (X = -halfDepth, X = +halfDepth)
        const d_x = rayLocal.direction.x;
        if (Math.abs(d_x) > 1e-6) {
             const caps = [-halfDepth, halfDepth];
             caps.forEach(capX => {
                 const t = (capX - rayLocal.origin.x) / d_x;
                 if (t > 0.001 && t < tClosest) {
                      const hitP = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                      // Check radius in YZ plane
                      if (hitP.y*hitP.y + hitP.z*hitP.z <= radius*radius) {
                          tClosest = t;
                          normalClosest = new Vector3(Math.sign(capX), 0, 0); // point along X
                      }
                 }
             });
        }

        if (tClosest < Infinity && normalClosest) {
            const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(tClosest));
            return {
                t: tClosest,
                point: hitPoint,
                normal: normalClosest,
                localPoint: hitPoint
            };
        }

        return null;
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb: No output rays
        return { rays: [] };
    }
}
