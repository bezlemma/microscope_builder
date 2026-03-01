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

    /**
     * Pan angle (radians) — direction the component faces in the XY plane.
     * Tilt angle (radians) — tip out of the XY plane (0 = vertical on table).
     *
     * The quaternion is always: q = Ry(tilt) · Rz(pan) · Rx(π/2)
     * Animation just sets these scalars — no Euler decomposition needed.
     */
    panAngle: number = 0;
    tiltAngle: number = 0;

    /** Tracks last version for which matrices were computed (dirty-flag). */
    private _matrixVersion: number = -1;
    private static readonly UNIT_SCALE = new Vector3(1, 1, 1);

    /**
     * The local-space forward axis (optical axis / w).
     * All component geometry is defined with +X as the optical axis.
     * Use `getForwardDirection()` to get this in world space.
     */
    static readonly LOCAL_FORWARD = Object.freeze(new Vector3(1, 0, 0));

    constructor(name: string = "Unnamed Component") {
        this.id = uuidv4();
        this.name = name;
        this.position = new Vector3(0, 0, 0);
        this.rotation = new Quaternion(); // Identity — geometry is X-forward by definition
        this.worldToLocal = new Matrix4();
        this.localToWorld = new Matrix4();
        this.bounds = new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10)); // Default bounds
        this.updateMatrices();
    }

    setPosition(x: number, y: number, z: number) {
        this.position.set(x, y, z);
        this.version++;
    }

    /** Returns the component's forward direction (optical axis) in world space. */
    getForwardDirection(): Vector3 {
        return OpticalComponent.LOCAL_FORWARD.clone().applyQuaternion(this.rotation).normalize();
    }

    /**
     * Recompute the quaternion from panAngle and tiltAngle.
     * q = Ry(tilt) · Rz(pan) · Rx(π/2)
     *
     * This is the ONLY place the quaternion is derived from pan/tilt.
     * All animation and galvo scan code sets panAngle/tiltAngle then calls this.
     */
    recomputeRotation(): void {
        // X-forward convention: pan rotates around Z, tilt rotates around Y.
        // Identity = optical axis along +X.
        const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.panAngle);
        const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.tiltAngle);
        // q = Ry(tilt) · Rz(pan)
        this.rotation.copy(qy.multiply(qz));
        this.version++;
    }

    setRotation(x: number, y: number, z: number) {
        // Build quaternion from Euler
        this.rotation.setFromEuler(new Euler(x, y, z));
        // Extract panAngle/tiltAngle from local +X (forward axis)
        const forward = new Vector3(1, 0, 0).applyQuaternion(this.rotation);
        this.panAngle = Math.atan2(forward.y, forward.x);
        const xyLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y);
        this.tiltAngle = Math.atan2(forward.z, xyLen);
        this.version++;
    }

    /**
     * Orient this component so its local +X axis points along the given
     * world-space direction. This is the "forward" / optical axis for all optics.
     *
     * GEOMETRY CONVENTION (X-forward):
     *   - Local +X = optical axis / forward direction
     *   - Local +Y = "right" on the table (perpendicular to beam, horizontal)
     *   - Local +Z = "up" (toward viewer in top-down scene)
     *
     * With IDENTITY rotation (no pointAlong), local = world:
     *   - Optical axis along world +X (horizontal on table)
     *   - Component extends in YZ plane
     *   - Correct default orientation for all components
     *
     * RULES FOR PRESET AUTHORS:
     *   - "emits along +X"     → pointAlong(1, 0, 0) — or just use identity
     *   - "sensor faces left"  → pointAlong(-1, 0, 0)
     *   - "objective faces -Y" → pointAlong(0, -1, 0)
     */
    pointAlong(dx: number, dy: number, dz: number) {
        const forward = new Vector3(dx, dy, dz).normalize();
        // Default up = world +Z (toward the viewer in top-down scene).
        // Falls back to world +Y when pointing along the Z axis.
        let upHint = new Vector3(0, 0, 1);
        if (Math.abs(forward.dot(upHint)) > 0.99) {
            upHint = new Vector3(0, 1, 0);
        }
        const right = new Vector3().crossVectors(upHint, forward).normalize();
        const up = new Vector3().crossVectors(forward, right).normalize();

        // Build rotation matrix: columns = [forward, right, up]
        // local X → forward, local Y → right, local Z → up
        const m = new Matrix4().makeBasis(forward, right, up);
        this.rotation.setFromRotationMatrix(m);

        // Extract panAngle from the forward direction projected to XY plane
        this.panAngle = Math.atan2(forward.y, forward.x);
        // tiltAngle = how much the forward direction is out of the XY plane
        const xyLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y);
        this.tiltAngle = Math.atan2(forward.z, xyLen);
        this.version++;
    }

    updateMatrices() {
        if (this._matrixVersion === this.version) return;
        this.localToWorld.compose(this.position, this.rotation, OpticalComponent.UNIT_SCALE);
        this.worldToLocal.copy(this.localToWorld).invert();
        this._matrixVersion = this.version;
    }

    // ── Solver 2 Interface (Gaussian Beam ABCD) ──────────────────────
    // Default implementations return identity / zero. Components override
    // these to provide their own optical transfer properties.

    /** ABCD ray transfer matrix [A, B, C, D]. Default: identity (no optical effect). */
    getABCD(_rayDirection?: Vector3, _wavelengthSI?: number): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    /** Clear aperture radius [mm]. Default: 0 (no aperture info). */
    getApertureRadius(): number {
        return 0;
    }

    /**
     * Full ABCD descriptor for Solver 2 with separate tangential/sagittal matrices.
     * Override in components with astigmatic behavior (CylindricalLens, SlitAperture, PrismLens).
     */
    getComponentABCD(_rayDirection?: Vector3, _wavelengthSI?: number): {
        abcdX: [number, number, number, number];
        abcdY: [number, number, number, number];
        apertureRadius: number;
    } {
        const abcd = this.getABCD(_rayDirection, _wavelengthSI);
        return { abcdX: abcd, abcdY: abcd, apertureRadius: this.getApertureRadius() };
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
