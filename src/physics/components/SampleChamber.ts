import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../types';
import { intersectAABB } from '../math_solvers';
import { Vector3, Box3 } from 'three';

/**
 * SampleChamber — L/X Sample Holder.
 *
 * A hollow open-top cube with circular holes cut in all 4 side faces (±X, ±Y).
 * Objectives can snap into the side holes via Alt+drag.
 * The Mickey specimen sits inside at the center with ears facing +Z.
 *
 * Physics: transmits all rays unchanged (no refraction modeled).
 *
 * Snap ports: 4 positions at the center of each face, with rotation so that
 * an objective placed there faces inward toward the sample.
 */
export class SampleChamber extends OpticalComponent {
    /** Cube side length (mm). */
    cubeSize: number;
    /** Wall thickness (mm). */
    wallThickness: number;
    /** Diameter of circular bore holes on each face (mm). */
    boreDiameter: number;
    /** Snap positions for objectives (in local coordinates).
     *  Each entry: position (x,y), Euler rotation (rx,ry,rz) to face inward,
     *  and axisDir ('x'|'y') indicating the free-movement axis. */
    snapPorts: { x: number; y: number; rx: number; ry: number; rz: number; axisDir: 'x' | 'y' }[];

    constructor(
        cubeSize: number = 40,
        wallThickness: number = 3,
        boreDiameter: number = 21,
        name: string = "L/X Sample Holder"
    ) {
        super(name);
        this.cubeSize = cubeSize;
        this.wallThickness = wallThickness;
        this.boreDiameter = boreDiameter;

        // 4 snap ports — one on each face.
        // Euler rotation orients objective W (local Z) to face inward.
        const half = cubeSize / 2;
        this.snapPorts = [
            // +X face: objective W → -X (inward),  Ry(-π/2)
            { x: half, y: 0, rx: 0, ry: -Math.PI / 2, rz: 0, axisDir: 'x' },
            // -X face: objective W → +X (inward),  Ry(+π/2)
            { x: -half, y: 0, rx: 0, ry: Math.PI / 2, rz: 0, axisDir: 'x' },
            // +Y face: objective W → -Y (inward),  Rx(+π/2)
            { x: 0, y: half, rx: Math.PI / 2, ry: 0, rz: 0, axisDir: 'y' },
            // -Y face: objective W → +Y (inward),  Rx(-π/2)
            { x: 0, y: -half, rx: -Math.PI / 2, ry: 0, rz: 0, axisDir: 'y' },
        ];

        this._updateBounds();
    }

    private _updateBounds(): void {
        const half = this.cubeSize / 2;
        this.bounds = new Box3(
            new Vector3(-half, -half, -half),
            new Vector3(half, half, half)
        );
    }

    intersect(rayLocal: Ray): HitRecord | null {
        const half = this.cubeSize / 2;

        const box = new Box3(
            new Vector3(-half, -half, -half),
            new Vector3(half, half, half)
        );

        const { hit, tMin, tMax } = intersectAABB(rayLocal.origin, rayLocal.direction, box);
        if (!hit) return null;

        const t = tMin > 0.001 ? tMin : tMax;
        if (t < 0.001) return null;

        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));

        const eps = 0.01;
        let normal = new Vector3(0, 0, 1);
        if (Math.abs(point.x - half) < eps) normal = new Vector3(1, 0, 0);
        else if (Math.abs(point.x + half) < eps) normal = new Vector3(-1, 0, 0);
        else if (Math.abs(point.y - half) < eps) normal = new Vector3(0, 1, 0);
        else if (Math.abs(point.y + half) < eps) normal = new Vector3(0, -1, 0);
        else if (Math.abs(point.z - half) < eps) normal = new Vector3(0, 0, 1);
        else if (Math.abs(point.z + half) < eps) normal = new Vector3(0, 0, -1);

        return {
            t,
            point,
            normal,
            localPoint: point.clone()
        };
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Fully transparent — pass ray straight through
        return {
            rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
                opticalPathLength: ray.opticalPathLength + hit.t
            })]
        };
    }

    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.cubeSize / 2;
    }
}
