import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3 } from 'three';

export class Blocker extends OpticalComponent {
    width: number;
    height: number;
    depth: number;

    constructor(width: number = 20, height: number = 40, depth: number=5, name: string = "Blocker") {
        super(name);
        this.width = width;
        this.height = height;
        this.depth = depth;
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Simple AABB Intersection in Local Space
        // Box is centered at 0,0,0
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        const halfD = this.depth / 2;

        const min = new Vector3(-halfD, -halfH, -halfW); // Local X is depth/thickness? 
        // Be careful with orientation. Frame convention: Z is optical axis?
        // Wait, Lens Z is optical axis. Mirror Normal is Z.
        // Blocker Normal should be Z. So it blocks things coming along Z.
        // Dimension: Width (X), Height (Y), Thickness (Z).
        
        // Let's assume standard box centered at origin.
        const boundsMin = new Vector3(-this.width/2, -this.height/2, -this.depth/2);
        const boundsMax = new Vector3(this.width/2, this.height/2, this.depth/2);

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
            normal: new Vector3(0,0,1) // Approximation, need real normal logic if we reflect
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Absorb: No output rays
        return { rays: [] };
    }
}
