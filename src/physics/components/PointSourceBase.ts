import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Box3, Vector3 } from 'three';

/**
 * PointSourceBase — shared fields for point-emitter light sources.
 *
 * Emits `power` watts from a single world point. The actual ray distribution
 * (spherical, cone, fan, structured) is produced by SourceRayFactory based on
 * the concrete subclass. Subclasses override the emission geometry.
 *
 * Wavelength is stored in nanometers (matching Laser/Lamp convention) so the
 * UI and spectral color helpers receive a value they can use directly.
 */
export class PointSourceBase extends OpticalComponent {
    /** Emission wavelength in nanometers. */
    wavelength: number = 532;
    /** Cosmetic beam waist for downstream beamlet footprint estimates (mm). */
    beamRadius: number = 0.25;
    /** Total optical power emitted (watts). */
    power: number = 1;

    private static readonly HOUSING = new Box3(
        new Vector3(-3, -3, -3),
        new Vector3(3, 3, 3),
    );

    constructor(name: string = 'Point Source') {
        super(name);
        this.bounds = PointSourceBase.HOUSING.clone();
        // Default: emit along +X to match Laser/Lamp defaults.
        this.pointAlong(1, 0, 0);
    }

    intersect(_rayLocal: Ray): HitRecord | null { return null; }
    interact(_ray: Ray, _hit: HitRecord): InteractionResult { return { rays: [] }; }
}
