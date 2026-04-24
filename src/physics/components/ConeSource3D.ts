import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Box3, Vector3 } from 'three';

/**
 * ConeSource3D — point emitter constrained to a forward-facing cone.
 *
 * Light is emitted along the component's local +Z axis (the "forward"
 * direction set by pointAlong) with directions uniformly distributed inside
 * a cone of half-angle `halfAngle`. Equivalent to a diverging point source
 * with a limited numerical aperture.
 */
export class ConeSource3D extends OpticalComponent {
    /** Emission wavelength in nanometers. */
    wavelength: number = 532;
    /** Cosmetic beam waist for downstream beamlet footprint estimates (mm). */
    beamRadius: number = 0.25;
    /** Total optical power emitted (watts). */
    power: number = 1;
    /** Half-angle of the emission cone (radians). */
    halfAngle: number = Math.PI / 12; // 15°
    /** Legacy alias (kept so older callers can keep working). */
    get coneAngle(): number { return this.halfAngle; }
    set coneAngle(v: number) { this.halfAngle = v; }

    private static readonly HOUSING = new Box3(
        new Vector3(-3, -3, -3),
        new Vector3(3, 3, 3),
    );

    constructor(name: string = 'Cone Source 3D') {
        super(name);
        this.bounds = ConeSource3D.HOUSING.clone();
        this.pointAlong(1, 0, 0);
    }

    intersect(_rayLocal: Ray): HitRecord | null { return null; }
    interact(_ray: Ray, _hit: HitRecord): InteractionResult { return { rays: [] }; }
}
