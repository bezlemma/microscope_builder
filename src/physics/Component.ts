import { Matrix4, Vector3, Quaternion, Box3 } from 'three';
import { Ray, HitRecord, InteractionResult } from './types';
import { intersectAABB } from './math_solvers';
import { v4 as uuidv4 } from 'uuid';

export interface Surface {
    intersect(rayLocal: Ray): HitRecord | null;
    interact(ray: Ray, hit: HitRecord): InteractionResult;
}

export abstract class OpticalComponent implements Surface {
    declare id: string;
    declare name: string;
    declare position: Vector3;
    declare rotation: Quaternion;
    declare worldToLocal: Matrix4;
    declare localToWorld: Matrix4;
    declare bounds: Box3; // Local bounds

    constructor(name: string = "Unnamed Component") {
        this.id = uuidv4();
        this.name = name;
        this.position = new Vector3(0, 0, 0);
        this.rotation = new Quaternion();
        this.worldToLocal = new Matrix4();
        this.localToWorld = new Matrix4();
        this.bounds = new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10)); // Default bounds
        this.updateMatrices();
    }

    setPosition(x: number, y: number, z: number) {
        this.position.set(x, y, z);
        this.updateMatrices();
    }

    setRotation(x: number, y: number, z: number) {
        this.rotation.setFromEuler(new Euler(x, y, z));
        this.updateMatrices();
    }

    updateMatrices() {
        this.localToWorld.compose(this.position, this.rotation, new Vector3(1, 1, 1));
        this.worldToLocal.copy(this.localToWorld).invert();
    }

    abstract intersect(rayLocal: Ray): HitRecord | null;
    abstract interact(ray: Ray, hit: HitRecord): InteractionResult;

    // Template method for tracing
    chkIntersection(rayWorld: Ray): HitRecord | null {
        // Broadphase
        // Note: For simple components, transforming AABB to world is cheaper than ray to local for bounding check
        // but typically we transform ray to local for exact check anyway.
        // Here we just skip AABB for now to ensure correctness first, add optimization later.
        
        // Transform Ray to Local
        const rayLocalOrigin = rayWorld.origin.clone().applyMatrix4(this.worldToLocal);
        const rayLocalDir = rayWorld.direction.clone().transformDirection(this.worldToLocal).normalize();
        
        const rayLocal: Ray = { 
            ...rayWorld, 
            origin: rayLocalOrigin, 
            direction: rayLocalDir 
        };

        const hitLocal = this.intersect(rayLocal);

        if (hitLocal) {
            // Transform hit back to world
            const pointWorld = hitLocal.point.clone().applyMatrix4(this.localToWorld);
            const normalWorld = hitLocal.normal.clone().transformDirection(this.localToWorld).normalize();
            
            // Re-calculate t in world space (distance might scale if we had scaling, but we assume scale=1)
            const tWorld = pointWorld.distanceTo(rayWorld.origin);

            return {
                t: tWorld,
                point: pointWorld,
                normal: normalWorld,
                localPoint: hitLocal.point
            };
        }

        return null;
    }
}

import { Euler } from 'three';
