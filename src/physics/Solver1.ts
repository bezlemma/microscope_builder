import { Ray, InteractionResult } from './types';
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';

export class Solver1 {
    maxDepth: number = 20;
    scene: OpticalComponent[];

    constructor(scene: OpticalComponent[]) {
        this.scene = scene;
    }

    trace(sources: Ray[]): Ray[][] {
        const allPaths: Ray[][] = [];

        for (const sourceRay of sources) {

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


        for (const component of this.scene) {
            const hit = component.chkIntersection(currentRay);


            if (hit && hit.t < nearestT && hit.t > 0.001) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
            }
        }


        if (!nearestHit || !nearestComponent) {
            allPaths.push([...currentPath]);
            return;
        }

        currentRay.interactionDistance = nearestT;
        currentRay.interactionComponentId = nearestComponent.id;

        // Terminate rays that re-enter a Laser housing
        if (nearestComponent instanceof Laser) {
            allPaths.push([...currentPath]);
            return;
        }


        const result: InteractionResult = nearestComponent.interact(currentRay, nearestHit);


        if (result.rays.length === 0) {
            allPaths.push([...currentPath]);
            return;
        }

        // Passthrough components (e.g., card) don't break the ray path visually
        if (result.passthrough && result.rays.length === 1) {
            const nextRay = result.rays[0];
            nextRay.isMainRay = (currentRay.isMainRay === true);
            nextRay.sourceId = currentRay.sourceId;
            
            // Critical! Pushing the current ray preserves the interaction line
            const nextPath = [...currentPath, nextRay];
            this.traceRecursive(nextRay, nextPath, depth + 1, allPaths);
            return;
        }


        for (let i = 0; i < result.rays.length; i++) {
            const nextRay = result.rays[i];

            nextRay.interactionDistance = undefined;
            nextRay.interactionComponentId = undefined;

            nextRay.isMainRay = (currentRay.isMainRay === true);
            nextRay.sourceId = currentRay.sourceId;


            if (nextRay.intensity < 1e-6) {
                allPaths.push([...currentPath, nextRay]);
                continue;
            }


            const nextPath = [...currentPath, nextRay];

            this.traceRecursive(nextRay, nextPath, depth + 1, allPaths);
        }
    }
}
