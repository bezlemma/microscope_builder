import { Vector3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

export class Camera extends OpticalComponent {
    width: number;
    height: number;

    constructor(width: number = 20, height: number = 15, name: string = "Camera Sensor") {
        super(name);
        this.width = width;
        this.height = height;
        // Default orientation: Facing -Z (standard for cameras in this setup? or along Optical Axis?)
        // Standard in this engine: Light travels +X. So Camera should face -X.
        // We'll set rotation in the scene, geometry assumes XY plane, centered.
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
