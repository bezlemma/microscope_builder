import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Box3, Vector3 } from 'three';

/**
 * StructuredSource — emits a collimated pattern of rays whose transverse layout
 * comes from rasterizing a single ASCII character at the source aperture.
 *
 * The character is rendered into a small bitmap; SourceRayFactory places one
 * ray at each set pixel, propagating forward along the component's local +Z.
 * Handy for sanity-checking image formation (is the mickey right-side up? flipped?)
 * because the pattern is instantly recognizable on the far side of a lens.
 */
export class StructuredSource extends OpticalComponent {
    /** Emission wavelength in nanometers. */
    wavelength: number = 532;
    /** Pattern radius over which the structured rays are emitted (mm). */
    beamRadius: number = 5;
    /** Total optical power emitted (watts). */
    power: number = 1;
    /** Legacy aperture diameter retained for old scene files (mm). */
    diameter: number = 10;
    /** The character rasterized into the pattern. */
    asciiChar: string = 'A';

    private static readonly HOUSING = new Box3(
        new Vector3(-6, -6, -3),
        new Vector3(6, 6, 3),
    );

    constructor(name: string = 'Structured Source') {
        super(name);
        this.bounds = StructuredSource.HOUSING.clone();
        this.pointAlong(1, 0, 0);
    }

    intersect(_rayLocal: Ray): HitRecord | null { return null; }
    interact(_ray: Ray, _hit: HitRecord): InteractionResult { return { rays: [] }; }
}
