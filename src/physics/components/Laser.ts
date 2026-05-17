import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { intersectAABB } from '../math_solvers';
import { Vector3, Box3 } from 'three';

export class Laser extends OpticalComponent {
    wavelength: number = 488; // nm (default — common Ar-ion / DPSS line for fluorescence)
    beamRadius: number = 2;   // mm (1/e² beam half-width)
    power: number = 1.0;      // Watts (optical output power)
    isOn: boolean = true;     // User-facing emission toggle; preserves configured power.
    /** Linear polarization angle in the source's transverse local XY plane.
     *  90 degrees maps to local +X, which is table-visible for the default +X beam. */
    polarizationAngle: number = Math.PI / 2;

    private static readonly HOUSING = new Box3(
        new Vector3(-19, -20, -68),
        new Vector3(19, 20, 2)
    );
    
    constructor(name: string = "Laser Source") {
        super(name);
        this.bounds = Laser.HOUSING.clone();
        // Default: beam fires along +X (in the optical table XY plane)
        this.pointAlong(1, 0, 0);
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, Laser.HOUSING);
        if (!hit) return null;

        // Use the first positive t to avoid self-intersection when a ray starts
        // exactly on the housing boundary.
        const t = tMin > 0.001 ? tMin : tMax;
        if (t < 0.001) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        return {
            t,
            point,
            normal: new Vector3(0, 0, 1),
            localPoint: point.clone()
        };
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb external rays hitting the housing
        return { rays: [] }; 
    }
}
