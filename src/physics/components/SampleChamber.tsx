import { Sample } from './Sample';
import { Vector3, Box3 } from 'three';

/**
 * SampleChamber — L/X Sample Holder.
 *
 * Extends Sample to inherit fluorescence spectral properties AND Mickey Mouse
 * intersection geometry (SPHERES). The chamber walls are transparent with
 * holes for objectives; rays interact only with the Mickey specimen inside.
 *
 * Snap ports: 4 positions at the center of each face, with rotation so that
 * an objective placed there faces inward toward the sample.
 */
export class SampleChamber extends Sample {
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
        cubeSize: number = 100,
        wallThickness: number = 3,
        boreDiameter: number = 30, // wide enough to fit water dipping objectives
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
            // +X face: objective local -Z → -X (inward). local Z → +X. Ry(+π/2)
            { x: half, y: 0, rx: 0, ry: Math.PI / 2, rz: 0, axisDir: 'x' },
            // -X face: objective local -Z → +X (inward). local Z → -X. Ry(-π/2)
            { x: -half, y: 0, rx: 0, ry: -Math.PI / 2, rz: 0, axisDir: 'x' },
            // +Y face: objective local -Z → -Y (inward). local Z → +Y. Rx(-π/2)
            { x: 0, y: half, rx: -Math.PI / 2, ry: 0, rz: 0, axisDir: 'y' },
            // -Y face: objective local -Z → +Y (inward). local Z → -Y. Rx(+π/2)
            { x: 0, y: -half, rx: Math.PI / 2, ry: 0, rz: 0, axisDir: 'y' },
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

    // intersect() and computeChordLength() are inherited from Sample
    // (Mickey SPHERE-based), so Solver3 backward rays interact with
    // the specimen geometry, not the transparent chamber walls.

    getABCD(): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    getApertureRadius(): number {
        return this.cubeSize / 2;
    }
}
