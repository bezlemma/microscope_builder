import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { intersectAABB } from '../math_solvers';
import { Vector3, Box3 } from 'three';

export class Laser extends OpticalComponent {
    wavelength: number = 532; // nm (default green)
    beamRadius: number = 2;   // mm (half-width of beam)

    private static readonly HOUSING = new Box3(
        new Vector3(-50, -7.5, -12.5),
        new Vector3(0, 7.5, 12.5)
    );
    
    constructor(name: string = "Laser Source") {
        super(name);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Laser.HOUSING);
        if (!hit) return null;

        const t = tMin > 0 ? tMin : tMax;
        if (t < 0) return null;

        return {
            t,
            point: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t)),
            normal: new Vector3(1, 0, 0),
            localPoint: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t))
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] }; 
    }
}

