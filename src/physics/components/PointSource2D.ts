import { PointSourceBase } from './PointSourceBase';

/**
 * PointSource2D — radial emitter confined to the component's local XZ plane.
 *
 * Rays are emitted in all directions within the local Y=0 plane (the optical
 * table plane once `pointAlong` has been applied). Useful for 2D educational
 * demos where vertical spread is distracting.
 */
export class PointSource2D extends PointSourceBase {
    constructor(name: string = 'Point Source 2D') { super(name); }
}
