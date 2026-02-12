import { Ray, InteractionResult } from './types';
import { OpticalComponent } from './Component';

export class Solver1 {
    maxDepth: number = 20; // Maximum number of bounces to prevent infinite loops
    scene: OpticalComponent[];

    constructor(scene: OpticalComponent[]) {
        this.scene = scene;
    }

    trace(sources: Ray[]): Ray[][] {
        const allPaths: Ray[][] = [];

        for (const sourceRay of sources) {
            // Safety Check: Ensure source ray is valid
            if (isNaN(sourceRay.origin.x) || isNaN(sourceRay.direction.x)) {
                console.warn("Solver1: Skipping invalid source ray (NaN values)", sourceRay);
                continue;
            }

            const path: Ray[] = [sourceRay];
            this.traceRecursive(sourceRay, path, 0, allPaths);
        }

        return allPaths;
    }

    private traceRecursive(currentRay: Ray, currentPath: Ray[], depth: number, allPaths: Ray[][]) {
        // 0. Safety Checks
        if (depth >= this.maxDepth) {
            allPaths.push([...currentPath]);
            return;
        }

        if (isNaN(currentRay.origin.length()) || isNaN(currentRay.direction.length())) {
             console.warn("Solver1: Ray became NaN during trace. Terminating path.");
             allPaths.push([...currentPath]);
             return;
        }

        let nearestT = Infinity;
        let nearestHit = null;
        let nearestComponent = null;

        // 1. Find Nearest Intersection
        for (const component of this.scene) {
            const hit = component.chkIntersection(currentRay);
            
            // t > 0.001 prevents self-intersection (shadow acne)
            if (hit && hit.t < nearestT && hit.t > 0.001) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
            }
        }

        // 2. Terminate if no hit (Ray goes to infinity)
        if (!nearestHit || !nearestComponent) {
            allPaths.push([...currentPath]);
            return; 
        }

        // 3. Interact
        // Store where the ray ended its segment.
        currentRay.interactionDistance = nearestT;
        
        // component.interact() calculates the physics (reflection, refraction, etc.)
        const result: InteractionResult = nearestComponent.interact(currentRay, nearestHit);

        // 4. Handle Termination (Blocker/Absorber)
        // If no child rays are returned, the light stopped (absorbed or blocked).
        if (result.rays.length === 0) {
            allPaths.push([...currentPath]);
            return;
        }

        // 5. Handle Branching (Refraction, Reflection, Splitting)
        // Spawn new rays for the next segments.
        for (const childRay of result.rays) {
            // CRITICAL: Reset interaction distance for the new ray.
            childRay.interactionDistance = undefined; 
            
            // If ray was absorbed internally (e.g. TIR trapped in prism),
            // add it to path for visualization but don't trace further
            if (childRay.intensity <= 0) {
                allPaths.push([...currentPath, childRay]);
                continue;
            }
            
            // Branch the path history
            const nextPath = [...currentPath, childRay];
            
            this.traceRecursive(childRay, nextPath, depth + 1, allPaths);
        }
    }
}
