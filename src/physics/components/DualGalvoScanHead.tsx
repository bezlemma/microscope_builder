import { Vector3, Quaternion } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { reflectVector } from '../math_solvers';

/**
 * DualGalvoScanHead — A specialized component representing two galvo mirrors.
 * 
 * In a real confocal microscope, X and Y scanning are often done by two
 * separate mirrors separated by a small distance.
 * 
 * This component models two mirrors separated by 'mirrorSpacing' mm.
 *   - Mirror 1 (X) pivots about (-mirrorSpacing/2, 0, 0)
 *   - Mirror 2 (Y) pivots about (-mirrorSpacing/2, mirrorSpacing, 0)
 */
export class DualGalvoScanHead extends OpticalComponent {
    mirrorSpacing: number; // mm
    mirrorDiameter: number; // mm
    
    // Scan angles in radians
    scanX: number = 0;
    scanY: number = 0;

    constructor(
        mirrorSpacing: number = 15,
        mirrorDiameter: number = 12,
        name: string = "Dual Galvo Scan Head"
    ) {
        super(name);
        this.mirrorSpacing = mirrorSpacing;
        this.mirrorDiameter = mirrorDiameter;
        // Default bounds
        this.bounds.min.set(-20, -20, -20);
        this.bounds.max.set(20, 20, 20);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const radius = this.mirrorDiameter / 2;
        const halfS = this.mirrorSpacing / 2;

        // Mirror 1 (X scan) at local (-halfS, 0, 0)
        // Incoming beam is along +X. Mirror 1 reflects it towards Mirror 2.
        const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.scanX);
        const n1 = new Vector3(-1, 1, 0).normalize().applyQuaternion(q1);
        const p1 = new Vector3(-halfS, 0, 0);

        // Mirror 2 (Y scan) at local (-halfS, this.mirrorSpacing, 0)
        // It receives the beam traveling along +Y from Mirror 1.
        const q2 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.scanY);
        const n2 = new Vector3(0, -1, 1).normalize().applyQuaternion(q2);
        const p2 = new Vector3(-halfS, this.mirrorSpacing, 0);

        let bestT = Infinity;
        let bestHit: HitRecord | null = null;

        // Mirror 1 check
        const d1 = rayLocal.direction.dot(n1);
        if (Math.abs(d1) > 1e-6) {
            const t = n1.dot(p1.clone().sub(rayLocal.origin)) / d1;
            if (t > 0.001) {
                const hit = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                if (hit.distanceTo(p1) <= radius) {
                    bestT = t;
                    bestHit = { t, point: hit, normal: n1, localPoint: hit };
                }
            }
        }

        // Mirror 2 check
        const d2 = rayLocal.direction.dot(n2);
        if (Math.abs(d2) > 1e-6) {
            const t = n2.dot(p2.clone().sub(rayLocal.origin)) / d2;
            if (t > 0.001 && t < bestT) {
                const hit = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
                if (hit.distanceTo(p2) <= radius) {
                    bestT = t;
                    bestHit = { t, point: hit, normal: n2, localPoint: hit };
                }
            }
        }

        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        if (ray.direction.dot(hit.normal) >= 0) return { rays: [] };
        const reflectedDir = reflectVector(ray.direction, hit.normal);
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: reflectedDir,
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.mirrorDiameter / 2;
    }
}
