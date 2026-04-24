import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Box3, Vector3 } from 'three';

/**
 * WedgeSource2D — planar fan emitter.
 *
 * Emits rays confined to the component's local X-Z plane (the optical-table
 * plane once `pointAlong` has oriented the source), fanning out within an
 * angular wedge of total angular width `subtendedAngle` centered on local +Z.
 * Useful for demonstrating refraction / focusing in a single plane.
 */
export class WedgeSource2D extends OpticalComponent {
    /** Emission wavelength in nanometers. */
    wavelength: number = 532;
    /** Cosmetic beam waist for downstream beamlet footprint estimates (mm). */
    beamRadius: number = 0.25;
    /** Total optical power emitted (watts). */
    power: number = 1;
    /** Total angular width of the emission fan (radians). */
    subtendedAngle: number = Math.PI / 3; // 60°
    get coneAngle(): number { return this.subtendedAngle / 2; }
    set coneAngle(v: number) { this.subtendedAngle = v * 2; }

    private static readonly HOUSING = new Box3(
        new Vector3(-3, -3, -3),
        new Vector3(3, 3, 3),
    );

    constructor(name: string = 'Wedge Source 2D') {
        super(name);
        this.bounds = WedgeSource2D.HOUSING.clone();
        this.pointAlong(1, 0, 0);
    }

    intersect(_rayLocal: Ray): HitRecord | null { return null; }
    interact(_ray: Ray, _hit: HitRecord): InteractionResult { return { rays: [] }; }
}
