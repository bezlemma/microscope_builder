import { Matrix4, Vector3, Quaternion, Box3, Euler } from 'three';
import { Ray, HitRecord, InteractionResult } from './types';
import { cleanVec } from './math_solvers';
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
    version: number = 0; // Increments on every mutation — used by React to detect changes on mutable objects
    absorptionCoeff: number = 0; // Beer-Lambert absorption coefficient [mm⁻¹], 0 = transparent

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
        this.version++;
    }

    setRotation(x: number, y: number, z: number) {
        this.rotation.setFromEuler(new Euler(x, y, z));
        this.updateMatrices();
        this.version++;
    }

    updateMatrices() {
        this.localToWorld.compose(this.position, this.rotation, new Vector3(1, 1, 1));
        this.worldToLocal.copy(this.localToWorld).invert();
    }

    abstract intersect(rayLocal: Ray): HitRecord | null;
    abstract interact(ray: Ray, hit: HitRecord): InteractionResult;

    // Template method for tracing
    chkIntersection(rayWorld: Ray): HitRecord | null {
        // Ensure matrices are fresh before checking intersection
        // This fixes the "Blocker ignored" and "Lens Snapping" bugs caused by stale matrices
        this.updateMatrices();

        // Transform Ray to Local
        const rayLocalOrigin = cleanVec(rayWorld.origin.clone().applyMatrix4(this.worldToLocal));
        const rayLocalDir = cleanVec(rayWorld.direction.clone().transformDirection(this.worldToLocal)).normalize();

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
                ...hitLocal, // Preserve all custom properties (like hitElement for Objective)
                t: tWorld,
                point: pointWorld,
                normal: normalWorld,
                localPoint: hitLocal.point,
                localNormal: hitLocal.normal.clone(),
                localDirection: rayLocalDir.clone()
            };
        }

        return null;
    }
}
