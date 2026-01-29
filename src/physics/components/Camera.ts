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
        // Plane intersection at z=0 (or whatever local axis we choose)
        // Let's assume the sensor is in the UV plane (XY locally), facing +W (Z).
        // Actually, if light travels +X in world, and we rotate camera to face -X.
        // In local space, light comes from +W or -W?
        // Let's stick to convention: Component Local W is Optical Axis. 
        // Sensor is at W=0.
        
        if (Math.abs(rayLocal.direction.z) < 1e-6) return null; // Parallel to plane

        const t = -rayLocal.origin.z / rayLocal.direction.z;
        if (t < 0.001) return null;

        const hitPoint = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        // Check bounds
        if (Math.abs(hitPoint.x) > this.width / 2 || Math.abs(hitPoint.y) > this.height / 2) {
            return null;
        }

        return {
            t: t,
            point: hitPoint,
            normal: new Vector3(0, 0, 1),
            localPoint: hitPoint
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Absorb
        return { rays: [] };
    }
}
