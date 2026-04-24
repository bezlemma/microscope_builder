import { PointSourceBase } from './PointSourceBase';

/**
 * PointSource3D — isotropic point emitter.
 *
 * Radiates rays over the full 4π steradians of solid angle. SourceRayFactory
 * samples the sphere uniformly; the `power` is split evenly across samples.
 * Useful for modeling fluorophore emission, black-body radiators, or an
 * "ideal point" for backward-ray-tracing PSF tests.
 */
export class PointSource3D extends PointSourceBase {
    constructor(name: string = 'Point Source 3D') { super(name); }
}
