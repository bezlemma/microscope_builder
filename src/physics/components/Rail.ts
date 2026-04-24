import { Vector3, Box3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';

/**
 * Rail — an optical rail that mounts between two holes on the optical table.
 *
 * Rails constrain component movement to a single axis. They do not interact
 * with light (intersect returns null).
 *
 * Rails sit on the table surface (Z = TABLE_Z) and rise 5mm above it.
 * They do not create Z-level entries in the ZLevelBar.
 */
export class Rail extends OpticalComponent {
    /** Table surface Z position — matches InfiniteTable plane position. */
    static readonly TABLE_Z = -42;
    /** Rail height above table surface in mm. */
    static readonly RAIL_HEIGHT = 5;

    /** First endpoint (hole position, XY in world coords, Z = TABLE_Z). */
    holeA: Vector3;
    /** Second endpoint (hole position, XY in world coords, Z = TABLE_Z). */
    holeB: Vector3;
    /** Cross-section width in mm (visual only). */
    profileWidth: number;
    /** Cross-section height in mm (visual only). */
    profileHeight: number;

    constructor(
        holeA: Vector3 = new Vector3(0, 0, Rail.TABLE_Z),
        holeB: Vector3 = new Vector3(100, 0, Rail.TABLE_Z),
        name: string = 'Optical Rail'
    ) {
        super(name);
        this.holeA = holeA.clone();
        this.holeA.z = Rail.TABLE_Z;
        this.holeB = holeB.clone();
        this.holeB.z = Rail.TABLE_Z;
        this.profileWidth = 12;
        this.profileHeight = Rail.RAIL_HEIGHT;
        this.axisLock = { x: false, y: false, z: true };
        this._updateFromEndpoints();
    }

    /** Unit direction vector from holeA to holeB (in XY plane). */
    get axisDir(): Vector3 {
        const d = this.holeB.clone().sub(this.holeA);
        d.z = 0;
        return d.normalize();
    }

    /** Length of the rail in mm (XY distance). */
    get length(): number {
        const d = this.holeB.clone().sub(this.holeA);
        d.z = 0;
        return d.length();
    }

    /** Update position, bounds, and orientation from endpoints. */
    _updateFromEndpoints(): void {
        this.holeA.z = Rail.TABLE_Z;
        this.holeB.z = Rail.TABLE_Z;

        const mid = this.holeA.clone().add(this.holeB).multiplyScalar(0.5);
        mid.z = Rail.TABLE_Z + this.profileHeight / 2 + 0.1;
        this.position.copy(mid);

        const dir = this.axisDir;
        if (dir.length() > 0.001) {
            this.pointAlong(dir.x, dir.y, 0);
        }

        const halfLen = this.length / 2;
        const hw = this.profileWidth / 2;
        const hh = this.profileHeight / 2;
        this.bounds = new Box3(
            new Vector3(-hw, -hh, -halfLen),
            new Vector3(hw, hh, halfLen)
        );
        this.version++;
    }

    override setPosition(x: number, y: number, _z: number): void {
        const dx = x - this.position.x;
        const dy = y - this.position.y;
        this.holeA.x += dx;
        this.holeA.y += dy;
        this.holeB.x += dx;
        this.holeB.y += dy;
        this.holeA.z = Rail.TABLE_Z;
        this.holeB.z = Rail.TABLE_Z;
        this.position.set(x, y, Rail.TABLE_Z + this.profileHeight / 2 + 0.1);
        this.version++;
    }

    setEndpoints(a: Vector3, b: Vector3): void {
        this.holeA.copy(a);
        this.holeB.copy(b);
        this._updateFromEndpoints();
    }

    setEndpointA(a: Vector3): void {
        this.holeA.copy(a);
        this._updateFromEndpoints();
    }

    setEndpointB(b: Vector3): void {
        this.holeB.copy(b);
        this._updateFromEndpoints();
    }

    // Rails don't interact with light
    intersect(_rayLocal: Ray): HitRecord | null {
        return null;
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        return { rays: [] };
    }
}
