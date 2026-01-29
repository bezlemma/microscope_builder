import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3 } from 'three';

export class Laser extends OpticalComponent {
    wavelength: number = 532; // nm (default green)
    beamRadius: number = 2;   // mm (half-width of beam)
    
    constructor(name: string = "Laser Source") {
        super(name);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Laser Housing Geometry (Matching Visualizer)
        // Box position: [-25, 0, 0] (Center). Size: [50, 15, 25].
        // Min: [-50, -7.5, -12.5]
        // Max: [0, 7.5, 12.5]
        
        const boundsMin = new Vector3(-50, -7.5, -12.5);
        const boundsMax = new Vector3(0, 7.5, 12.5);

        // Ray-Box Intersection (Slab method)
        let tMin = (boundsMin.x - rayLocal.origin.x) / rayLocal.direction.x;
        let tMax = (boundsMax.x - rayLocal.origin.x) / rayLocal.direction.x;

        if (tMin > tMax) [tMin, tMax] = [tMax, tMin];

        let tyMin = (boundsMin.y - rayLocal.origin.y) / rayLocal.direction.y;
        let tyMax = (boundsMax.y - rayLocal.origin.y) / rayLocal.direction.y;

        if (tyMin > tyMax) [tyMin, tyMax] = [tyMax, tyMin];

        if ((tMin > tyMax) || (tyMin > tMax)) return null;

        if (tyMin > tMin) tMin = tyMin;
        if (tyMax < tMax) tMax = tyMax;

        let tzMin = (boundsMin.z - rayLocal.origin.z) / rayLocal.direction.z;
        let tzMax = (boundsMax.z - rayLocal.origin.z) / rayLocal.direction.z;

        if (tzMin > tzMax) [tzMin, tzMax] = [tzMax, tzMin];

        if ((tMin > tzMax) || (tzMin > tMax)) return null;

        if (tzMin > tMin) tMin = tzMin;
        if (tzMax < tMax) tMax = tzMax;

        if (tMin < 0 && tMax < 0) return null;
        
        const t = tMin > 0 ? tMin : tMax;
        
        return {
            t: t,
            point: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t)),
            normal: new Vector3(1,0,0), // TODO: Real normal
            localPoint: rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t))
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] }; 
    }
}

