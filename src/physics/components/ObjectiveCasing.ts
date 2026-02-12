import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { Vector3, Box3 } from 'three';

export class ObjectiveCasing extends OpticalComponent {
    constructor(name: string = "Objective Housing") {
        super(name);
        this.bounds = new Box3(new Vector3(-10, -10, -20), new Vector3(10, 10, 5));
    }

    intersect(_rayLocal: Ray): HitRecord | null {
        // Physics-invisible: rays pass through the housing
        return null;
    }

    interact(ray: Ray, _hit: HitRecord): InteractionResult {
        return { rays: [childRay(ray, {})] };
    }
}
