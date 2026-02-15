import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3 } from 'three';

export class Blocker extends OpticalComponent {
    diameter: number;   // mm — circular aperture diameter
    thickness: number;  // mm — body thickness along optical axis

    constructor(diameter: number = 20, thickness: number = 5, name: string = "Blocker") {
        super(name);
        this.diameter = diameter;
        this.thickness = thickness;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Cylindrical body (optical axis along x → w)
        // Transverse plane: u=y, v=z
        const radius = this.diameter / 2;
        const halfDepth = this.thickness / 2;

        const ou = rayLocal.origin.y;
        const ov = rayLocal.origin.z;
        const du = rayLocal.direction.y;
        const dv = rayLocal.direction.z;

        let tClosest = Infinity;
        let normalClosest: Vector3 | null = null;
        
        // 1. Check Cylinder Wall / Rim: u² + v² = r²  (cylinder axis along w)
        const A = du*du + dv*dv;
        const B = 2 * (ou*du + ov*dv);
        const C = ou*ou + ov*ov - radius*radius;

        if (Math.abs(A) > 1e-6) {
            const det = B*B - 4*A*C;
            if (det >= 0) {
                const sqrtDet = Math.sqrt(det);
                const t1 = (-B - sqrtDet) / (2*A);
                const t2 = (-B + sqrtDet) / (2*A);

                [t1, t2].forEach(t => {
                   if (t > 0.001 && t < tClosest) {
                       const w = rayLocal.origin.x + t * rayLocal.direction.x;
                       if (w >= -halfDepth && w <= halfDepth) {
                           tClosest = t;
                           const hitP = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                           normalClosest = new Vector3(0, hitP.y, hitP.z).normalize();  // radial normal in uv
                       }
                   }
                });
            }
        }

        // 2. Check Caps at w = ±halfDepth
        const dw = rayLocal.direction.x;
        if (Math.abs(dw) > 1e-6) {
             const caps = [-halfDepth, halfDepth];
             caps.forEach(capW => {
                 const t = (capW - rayLocal.origin.x) / dw;
                 if (t > 0.001 && t < tClosest) {
                      const hitP = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                      // Check radius in uv transverse plane
                      const hu = hitP.y;
                      const hv = hitP.z;
                      if (hu*hu + hv*hv <= radius*radius) {
                          tClosest = t;
                          normalClosest = new Vector3(Math.sign(capW), 0, 0);  // ±w normal
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
