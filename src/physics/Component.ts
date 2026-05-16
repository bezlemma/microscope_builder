import { Matrix4, Vector3, Quaternion, Box3, Euler } from 'three';
import { Ray, HitRecord, InteractionResult } from './types';
import { cleanVec } from './math_solvers';
import { v4 as uuidv4 } from 'uuid';

function rayLocalBoundsNearT(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    box: Box3,
): number | null {
    let tMin = -Infinity;
    let tMax = Infinity;
    const eps = 1e-20;

    if (Math.abs(dx) < eps) {
        if (ox < box.min.x || ox > box.max.x) return null;
    } else {
        const inv = 1 / dx;
        let t1 = (box.min.x - ox) * inv;
        let t2 = (box.max.x - ox) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
    }

    if (Math.abs(dy) < eps) {
        if (oy < box.min.y || oy > box.max.y) return null;
    } else {
        const inv = 1 / dy;
        let t1 = (box.min.y - oy) * inv;
        let t2 = (box.max.y - oy) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
    }

    if (Math.abs(dz) < eps) {
        if (oz < box.min.z || oz > box.max.z) return null;
    } else {
        const inv = 1 / dz;
        let t1 = (box.min.z - oz) * inv;
        let t2 = (box.max.z - oz) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
    }

    return tMax > 0.001 ? Math.max(0, tMin) : null;
}

function raySphereNearT(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    cx: number, cy: number, cz: number,
    radius: number,
): number | null {
    const toCx = cx - ox;
    const toCy = cy - oy;
    const toCz = cz - oz;
    const along = toCx * dx + toCy * dy + toCz * dz;
    if (along < -radius) return null;
    const dist2 = toCx * toCx + toCy * toCy + toCz * toCz - along * along;
    const radius2 = radius * radius;
    if (dist2 > radius2) return null;
    const halfChord = Math.sqrt(Math.max(0, radius2 - dist2));
    const tFar = along + halfChord;
    if (tFar <= 0.001) return null;
    return Math.max(0, along - halfChord);
}

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
    private _worldBoundsVersion: number = -1;
    private _worldBoundsCenter: Vector3 = new Vector3();
    private _worldBoundsRadius: number = 0;
    private _rayLocalOriginScratch: Vector3 = new Vector3();
    private _rayLocalDirectionScratch: Vector3 = new Vector3();
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

    private updateWorldBoundsSphere(): void {
        if (this._worldBoundsVersion === this.version) return;
        const min = this.bounds.min;
        const max = this.bounds.max;
        this._worldBoundsCenter.set(
            (min.x + max.x) * 0.5,
            (min.y + max.y) * 0.5,
            (min.z + max.z) * 0.5,
        ).applyMatrix4(this.localToWorld);
        const sx = max.x - min.x;
        const sy = max.y - min.y;
        const sz = max.z - min.z;
        this._worldBoundsRadius = 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
        this._worldBoundsVersion = this.version;
    }

    /** Clear aperture radius [mm]. Used by Solver 3 aperture importance sampling
     *  and by the measurement overlay. Default: 0 (no aperture info). */
    getApertureRadius(): number {
        return 0;
    }

    abstract intersect(rayLocal: Ray): HitRecord | null;
    abstract interact(ray: Ray, hit: HitRecord): InteractionResult;

    // Template method for tracing
    chkIntersection(rayWorld: Ray, maxDistance: number = Infinity): HitRecord | null {
        // Ensure matrices are fresh before checking intersection
        // This fixes the "Blocker ignored" and "Lens Snapping" bugs caused by stale matrices
        this.updateMatrices();
        this.updateWorldBoundsSphere();

        const sphereCenter = this._worldBoundsCenter;
        const sphereT = raySphereNearT(
            rayWorld.origin.x, rayWorld.origin.y, rayWorld.origin.z,
            rayWorld.direction.x, rayWorld.direction.y, rayWorld.direction.z,
            sphereCenter.x, sphereCenter.y, sphereCenter.z,
            this._worldBoundsRadius,
        );
        if (sphereT === null || sphereT > maxDistance) {
            return null;
        }

        // Transform Ray to Local
        const rayLocalOrigin = cleanVec(this._rayLocalOriginScratch.copy(rayWorld.origin).applyMatrix4(this.worldToLocal));
        const rayLocalDir = cleanVec(this._rayLocalDirectionScratch.copy(rayWorld.direction).transformDirection(this.worldToLocal)).normalize();

        const boundsT = rayLocalBoundsNearT(
            rayLocalOrigin.x, rayLocalOrigin.y, rayLocalOrigin.z,
            rayLocalDir.x, rayLocalDir.y, rayLocalDir.z,
            this.bounds,
        );
        if (boundsT === null || boundsT > maxDistance) {
            return null;
        }

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

            return {
                ...hitLocal, // Preserve all custom properties (like hitElement for Objective)
                t: hitLocal.t,
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
