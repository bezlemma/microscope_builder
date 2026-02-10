import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, Coherence } from '../types';
import { Vector3 } from 'three';

/**
 * PointSource - Emits diverging rays from a single point into a cone.
 * Used to demonstrate infinity-corrected imaging systems where the sample
 * (at the front focal plane of the objective) emits light that gets collimated.
 */
export class PointSource extends OpticalComponent {
    wavelength: number = 532; // nm (default green)
    coneAngle: number = 25;   // Half-angle of emission cone (degrees)
    rayCount: number = 11;    // Number of rays to emit
    
    constructor(name: string = "Point Source") {
        super(name);
    }

    /**
     * Generate source rays - a fan of diverging rays in the XY plane
     * aimed along +X (toward the objective)
     */
    generateRays(): Ray[] {
        const rays: Ray[] = [];
        const halfAngleRad = (this.coneAngle * Math.PI) / 180;
        
        // Get world position and forward direction
        const worldPos = this.position.clone();
        const forward = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
        const up = new Vector3(0, 0, 1).applyQuaternion(this.rotation);
        
        // Create a fan of rays in the XY plane (horizontal spread)
        for (let i = 0; i < this.rayCount; i++) {
            // Angle from -halfAngle to +halfAngle
            const angle = (i / (this.rayCount - 1) - 0.5) * 2 * halfAngleRad;
            
            // Rotate forward direction around up axis by angle
            const dir = forward.clone();
            dir.applyAxisAngle(up, angle);
            
            rays.push({
                origin: worldPos.clone(),
                direction: dir.normalize(),
                wavelength: this.wavelength * 1e-9,
                intensity: 1.0,
                opticalPathLength: 0,
                polarization: {x: {re: 1, im: 0}, y: {re: 0, im: 0}},
                footprintRadius: 0,
                coherenceMode: Coherence.Coherent
            });
        }
        
        return rays;
    }

    intersect(_rayLocal: Ray): HitRecord | null {
        // Point source has no geometry for ray tracing purposes
        // Rays should pass right through without interaction
        // Selection is handled separately by the visualizer's mesh onClick
        return null;
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        // Absorb any rays that hit the source
        return { rays: [] }; 
    }
}
