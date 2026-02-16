import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export class Camera extends OpticalComponent {
    width: number;
    height: number;
    sensorResX: number;
    sensorResY: number;

    // Solver 3 render results (stored on the camera that produced them)
    solver3Image: Float32Array | null = null;
    forwardImage: Float32Array | null = null;  // Forward excitation signal (Solver 2 beam at sensor)
    solver3Paths: Ray[][] | null = null;
    solver3Stale: boolean = true;

    constructor(width: number = 13, height: number = 13, name: string = "Camera Sensor") {
        super(name);
        this.width = width;
        this.height = height;
        this.sensorResX = 64;
        this.sensorResY = 64;
    }

    /** Clear Solver 3 results (called when scene changes) */
    markSolver3Stale(): void {
        this.solver3Stale = true;
        this.solver3Image = null;
        this.forwardImage = null;
        this.solver3Paths = null;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Sensor plane at w=0, facing +w direction
        const ow = rayLocal.origin.z;
        const dw = rayLocal.direction.z;

        if (Math.abs(dw) < 1e-6) return null;

        const t = -ow / dw;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Check bounds in uv transverse plane
        const hu = hitPoint.x;  // u coordinate
        const hv = hitPoint.y;  // v coordinate
        if (Math.abs(hu) > this.width / 2 || Math.abs(hv) > this.height / 2) {
            return null;
        }

        return {
            t: t,
            point: hitPoint,
            normal: new Vector3(0, 0, 1),  // +w normal
            localPoint: hitPoint
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb
        return { rays: [] };
    }
}
