import { Ray, InteractionResult } from './types';
import { OpticalComponent } from './Component';

export class Solver1 {
    maxDepth: number = 20;
    scene: OpticalComponent[];

    constructor(scene: OpticalComponent[]) {
        this.scene = scene;
    }

    trace(sources: Ray[]): Ray[][] {
        const allPaths: Ray[][] = [];

        for (const sourceRay of sources) {
            const path: Ray[] = [sourceRay];
            this.traceRecursive(sourceRay, path, 0);
            allPaths.push(path);
        }

        return allPaths;
    }

    private traceRecursive(currentRay: Ray, currentPath: Ray[], depth: number) {
        if (depth >= this.maxDepth) return;

        let nearestT = Infinity;
        let nearestHit = null;
        let nearestComponent = null;

        // 1. Find Nearest Intersection
        for (const component of this.scene) {
            // Check intersection (Broadphase handled inside Component if optimized, for now Direct)
            const hit = component.chkIntersection(currentRay);
            
            // console.log(`Checking ${component.name}: Hit=${!!hit} T=${hit?.t}`);

            if (hit && hit.t < nearestT && hit.t > 0.001) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
            }
        }

        // 2. Terminate if no hit
        if (!nearestHit || !nearestComponent) {
            // Extend ray to infinity or bounding box for visualization?
            // VISUALIZATION TRICK: Modifying the current ray's length isn't easy as it's Vector3 direction.
            // We just store the Rays. The Visualizer will draw them. 
            // The segment ends at 'nearestT' if hit, or 'Length' if not.
            // But Ray struct doesn't have length. We need "RaySegment".
            // Implementation Detail: trace() should probably return Segments (start, end).
            // But currentRay is adequate for starting point.
            return; 
        }

        // 3. Interact
        currentRay.interactionDistance = nearestT;
        const result: InteractionResult = nearestComponent.interact(currentRay, nearestHit);

        // 4. Handle children
        // Visualizer needs to know where the ray ENDED.
        // We can't mutate currentRay. 
        // We need a path structure which is Points, not Rays.
        // Or we need the next ray to start at the hit point.
        
        for (const childRay of result.rays) {
            childRay.interactionDistance = undefined; // Reset for the new segment
            currentPath.push(childRay);
            this.traceRecursive(childRay, currentPath, depth + 1);
        }
    }
}
