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

    /** Axis lock — prevents movement along locked axes during dragging.
     *  Default: Z locked (components stay on the table surface). */
    axisLock: { x: boolean; y: boolean; z: boolean } = { x: false, y: false, z: true };

    /**
     * Pan angle (radians) — direction the component faces in the XY plane.
     * Tilt angle (radians) — tip out of the XY plane (0 = vertical on table).
     *
     * The quaternion is always: q = Ry(tilt) · Rz(pan) · Rx(π/2)
     * Animation just sets these scalars — no Euler decomposition needed.
     */
    panAngle: number = 0;
    tiltAngle: number = 0;
    rollAngle: number = 0;  // Roll around the optical axis (radians)

    /** True for managed sub-components (e.g. DualGalvoScanHead child mirrors).
     *  Sub-components are hidden from the scene list and not independently selectable. */
    isSubComponent: boolean = false;

    /** True if this is a ghost component. Ghost components serve as visual reference markers
     *  and are ignored by all ray tracers and wave solvers. */
    isGhost?: boolean;

    /** Tracks last version for which matrices were computed (dirty-flag). */
    private _matrixVersion: number = -1;
    private static readonly UNIT_SCALE = new Vector3(1, 1, 1);

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
        this.version++;
    }

    /**
     * Build the "no-roll" quaternion for a given pan/tilt. Canonical basis:
     *   forward (local +Z)  = spherical(pan, tilt)
     *   upHint              = world +Z (falls back to world +Y if forward is
     *                         parallel to world +Z)
     *   right               = upHint × forward
     *   up                  = forward × right
     * The returned quaternion maps local (X, Y, Z) → (right, up, forward).
     * This matches pointAlong() EXACTLY, so the scalar representation and
     * pointAlong's quaternion agree for the same pan/tilt.
     */
    private static buildBaseQuaternion(pan: number, tilt: number, out: Quaternion): Quaternion {
        const forward = new Vector3(
            Math.cos(tilt) * Math.cos(pan),
            Math.cos(tilt) * Math.sin(pan),
            Math.sin(tilt),
        );
        let upHint = new Vector3(0, 0, 1);
        if (Math.abs(forward.dot(upHint)) > 0.99) upHint = new Vector3(0, 1, 0);
        const right = new Vector3().crossVectors(upHint, forward).normalize();
        const up = new Vector3().crossVectors(forward, right).normalize();
        const m = new Matrix4().makeBasis(right, up, forward);
        out.setFromRotationMatrix(m);
        return out;
    }

    /**
     * Recompute the quaternion from panAngle, tiltAngle, and rollAngle.
     * Uses the same basis construction as pointAlong() so the scalar state
     * round-trips to the same quaternion. Roll rotates about the local +Z
     * (optical) axis after the base orientation is built.
     */
    recomputeRotation(): void {
        OpticalComponent.buildBaseQuaternion(this.panAngle, this.tiltAngle, this.rotation);
        if (this.rollAngle !== 0) {
            const qRoll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.rollAngle);
            this.rotation.multiply(qRoll);
        }
        this.version++;
    }

    setRotation(x: number, y: number, z: number) {
        // Build quaternion from Euler (preserves exact backward compat for
        // callers that still pass Euler XYZ).
        this.rotation.setFromEuler(new Euler(x, y, z));
        // Extract pan/tilt from the resulting forward direction, and recover
        // roll by comparing the actual "up" vector to the no-roll "up". Any
        // subsequent recomputeRotation() will reproduce this exact quaternion.
        const forward = new Vector3(0, 0, 1).applyQuaternion(this.rotation);
        this.panAngle = Math.atan2(forward.y, forward.x);
        const xyLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y);
        this.tiltAngle = Math.atan2(forward.z, xyLen);

        const baseQ = OpticalComponent.buildBaseQuaternion(this.panAngle, this.tiltAngle, new Quaternion());
        const upWithoutRoll = new Vector3(0, 1, 0).applyQuaternion(baseQ);
        const upActual = new Vector3(0, 1, 0).applyQuaternion(this.rotation);
        const cross = new Vector3().crossVectors(upWithoutRoll, upActual);
        const sinRoll = cross.dot(forward);
        const cosRoll = upWithoutRoll.dot(upActual);
        this.rollAngle = Math.atan2(sinRoll, cosRoll);

        this.version++;
    }

    /**
     * Orient this component so its local +Z axis points along the given
     * world-space direction. This is the "forward" direction for all optics:
     *   - Lasers/Lamps emit along local +Z
     *   - Cameras/Cards detect on local Z=0 plane, facing +Z
     *   - Lenses/Mirrors have their optical axis along local Z
     *
     * SCENE CONVENTION: The scene is viewed top-down from +Z.
     *   - Local Y ("up" on the component, where labels are) maps to world +Z
     *     (toward the viewer), so labels are always readable from the default view.
     *   - When pointing along the Z axis, local Y falls back to world +Y.
     *
     * RULES FOR PRESET AUTHORS:
     *   - "faces toward beam"  → pointAlong opposite to beam travel direction
     *   - "emits along +X"     → pointAlong(1, 0, 0)
     *   - "sensor faces left"  → pointAlong(-1, 0, 0)
     *   - "objective faces -Y" → pointAlong(0, -1, 0)
     */
    pointAlong(dx: number, dy: number, dz: number) {
        const forward = new Vector3(dx, dy, dz).normalize();
        this.panAngle = Math.atan2(forward.y, forward.x);
        const xyLen = Math.sqrt(forward.x * forward.x + forward.y * forward.y);
        this.tiltAngle = Math.atan2(forward.z, xyLen);
        this.rollAngle = 0;
        // recomputeRotation() builds the quaternion via the same canonical basis
        // construction, keeping scalar pan/tilt/roll in sync with the quaternion.
        this.recomputeRotation();
    }

    updateMatrices() {
        if (this._matrixVersion === this.version) return;
        this.localToWorld.compose(this.position, this.rotation, OpticalComponent.UNIT_SCALE);
        this.worldToLocal.copy(this.localToWorld).invert();
        this._matrixVersion = this.version;
    }

    // ── Solver 2 Legacy q-Fallback Interface ─────────────────────────
    // Production Solver 2 now uses Solver 1 beamlets directly. These hooks
    // remain for legacy analytic segments and compatibility code paths.

    /** Legacy q-fallback paraxial transform [A, B, C, D]. Default: identity. */
    getParaxialTransform(_rayDirection?: Vector3, _wavelengthSI?: number): [number, number, number, number] {
        return [1, 0, 0, 1];
    }

    /** Clear aperture radius [mm]. Default: 0 (no aperture info). */
    getApertureRadius(): number {
        return 0;
    }

    /**
     * Full legacy q-fallback descriptor with separate tangential/sagittal transforms.
     * Override in components with astigmatic behavior (CylindricalLens, SlitAperture, PrismLens).
     */
    getParaxialProfile(_rayDirection?: Vector3, _wavelengthSI?: number): {
        transformX: [number, number, number, number];
        transformY: [number, number, number, number];
        apertureRadius: number;
    } {
        const transform = this.getParaxialTransform(_rayDirection, _wavelengthSI);
        return { transformX: transform, transformY: transform, apertureRadius: this.getApertureRadius() };
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
