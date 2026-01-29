import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Vector3, Box3 } from 'three';

export class ObjectiveCasing extends OpticalComponent {
    // Visual-only component representing the objective housing.
    // Does NOT block rays (for now), so we can see inside. 
    // Or we can implement 'Window' logic? for now just pass-through.
    
    constructor(name: string = "Objective Housing") {
        super(name);
        // Larger bounds for visual selection
        this.bounds = new Box3(new Vector3(-10, -10, -20), new Vector3(10, 10, 5));
    }

    intersect(rayLocal: Ray): HitRecord | null {
        // Return null to let rays pass through?
        // OR return a hit but interact() returns the ray unchanged?
        // If we return null, we can't select it easily if it doesn't have a collider?
        // But for RayTracing physics, we want it transparent.
        // For UI selection, the UI uses Raycaster against Meshes. 
        // This 'intersect' is for PHYSICS rays.
        
        // So: Physics = Invisible.
        return null;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        return { rays: [ray] };
    }
}
