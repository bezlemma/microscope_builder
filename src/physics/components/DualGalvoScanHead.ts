import { Vector3, Quaternion } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult } from '../types';
import { Mirror } from './Mirror';
import { AnimationChannel, generateChannelId } from '../PropertyAnimator';

/**
 * DualGalvoScanHead — Two galvo mirrors stacked vertically (Y-separated in local space).
 *
 * This is a composite component: it creates two real Mirror children that are
 * added to the scene and traced by the solver like any other component.
 * The scan head itself has no optical interaction — it only positions/orients
 * its child mirrors and provides a visual housing.
 *
 * WARNING FOR PRESET AUTHORS: do not use DualGalvoScanHead as a convenient
 * single animated mirror. It is only for a coupled two-mirror X/Y scan head.
 * For one steering or scan surface, create a normal Mirror and animate its
 * panAngle or tiltAngle.
 *
 * LOCAL COORDINATE FRAME (when oriented with pointAlong):
 *   local +Z = beam propagation direction (world forward)
 *   local +Y = world +Z (upward, toward Mirror 2)
 *   local +X = world lateral
 *
 * BEAM PATH (nominal, no scanning):
 *   Enters local +Z → Mirror 1 deflects to local +Y →
 *   Mirror 2 deflects to local -X → exits component.
 *
 * Mirror 1 (X scan): face normal (0, 1, -1)/sqrt(2), pivots around local Y
 * Mirror 2 (Y scan): face normal (-1, -1, 0)/sqrt(2), pivots around local X
 */
export class DualGalvoScanHead extends OpticalComponent {
    mirrorSpacing: number; // mm — vertical separation between mirrors
    mirrorDiameter: number; // mm
    mirrorThickness: number; // mm

    /** Child mirror components — must be added to the scene alongside this component. */
    readonly mirror1: Mirror;
    readonly mirror2: Mirror;

    // Scan angles in radians (getter/setter to auto-sync child mirrors)
    private _scanX: number = 0;
    private _scanY: number = 0;

    get scanX(): number { return this._scanX; }
    set scanX(v: number) {
        this._scanX = v;
        this._syncMirrors();
        this.version++;
    }

    get scanY(): number { return this._scanY; }
    set scanY(v: number) {
        this._scanY = v;
        this._syncMirrors();
        this.version++;
    }

    // Declarative animation parameters
    scanAmplitudeX: number = 0; // Half-angle in radians
    scanAmplitudeY: number = 0; // Half-angle in radians
    scanHzX: number = 0;
    scanHzY: number = 0;

    constructor(
        mirrorSpacing: number = 15,
        mirrorDiameter: number = 12,
        name: string = "Dual Galvo Scan Head"
    ) {
        super(name);
        this.mirrorSpacing = mirrorSpacing;
        this.mirrorDiameter = mirrorDiameter;
        this.mirrorThickness = 1;

        // Create real Mirror children
        this.mirror1 = new Mirror(mirrorDiameter, this.mirrorThickness, "Galvo M1");
        this.mirror2 = new Mirror(mirrorDiameter, this.mirrorThickness, "Galvo M2");
        this.mirror1.isSubComponent = true;
        this.mirror2.isSubComponent = true;

        // Bounds encompass both mirrors (for housing visual)
        const extent = Math.max(mirrorSpacing, mirrorDiameter) + 5;
        this.bounds.min.set(-extent, -5, -extent);
        this.bounds.max.set(extent, mirrorSpacing + 5, extent);

        this._syncMirrors();
    }

    /**
     * Generates standard AnimationChannels for this component if amplitudes and Hz are > 0.
     */
    getAnimationChannels(): AnimationChannel[] {
        const channels: AnimationChannel[] = [];
        if (this.scanAmplitudeX > 0 && this.scanHzX > 0) {
            channels.push({
                id: generateChannelId(),
                targetId: this.id,
                property: 'scanX',
                from: -this.scanAmplitudeX,
                to: this.scanAmplitudeX,
                easing: 'sinusoidal',
                periodMs: 1000 / this.scanHzX,
                repeat: true,
                restoreValue: 0,
            });
        }
        if (this.scanAmplitudeY > 0 && this.scanHzY > 0) {
            channels.push({
                id: generateChannelId(),
                targetId: this.id,
                property: 'scanY',
                from: -this.scanAmplitudeY,
                to: this.scanAmplitudeY,
                easing: 'sinusoidal',
                periodMs: 1000 / this.scanHzY,
                repeat: true,
                restoreValue: 0,
            });
        }
        return channels;
    }

    private _syncing = false;

    /**
     * Sync child mirror world transforms from this component's position/rotation
     * plus scan angles.
     */
    private _syncMirrors(): void {
        if (!this.mirror1 || !this.mirror2) return;
        if (this._syncing) return;
        this._syncing = true;

        const halfT = this.mirrorThickness / 2;

        // Mirror 1: face normal (0,1,-1)/sqrt(2), scan around local Y
        const n1 = new Vector3(0, 1, -1).normalize();
        const q1base = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n1);
        const q1scan = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this._scanX);
        const q1local = q1scan.multiply(q1base);

        // Mirror 2: face normal (-1,-1,0)/sqrt(2), scan around local X
        const n2 = new Vector3(-1, -1, 0).normalize();
        const q2base = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n2);
        const q2scan = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this._scanY);
        const q2local = q2scan.multiply(q2base);

        // Mirror slab positions in scan-head-local space
        const p1local = n1.clone().multiplyScalar(-halfT);
        const p2local = n2.clone().multiplyScalar(-halfT).add(new Vector3(0, this.mirrorSpacing, 0));

        // Transform to world space
        const wp1 = p1local.applyQuaternion(this.rotation).add(this.position);
        const wr1 = this.rotation.clone().multiply(q1local);
        const wp2 = p2local.applyQuaternion(this.rotation).add(this.position);
        const wr2 = this.rotation.clone().multiply(q2local);

        const eps = 1e-10;
        if (!this.mirror1.position.equals(wp1) || Math.abs(this.mirror1.rotation.dot(wr1)) < 1 - eps) {
            this.mirror1.position.copy(wp1);
            this.mirror1.rotation.copy(wr1);
            this.mirror1.version++;
        }
        if (!this.mirror2.position.equals(wp2) || Math.abs(this.mirror2.rotation.dot(wr2)) < 1 - eps) {
            this.mirror2.position.copy(wp2);
            this.mirror2.rotation.copy(wr2);
            this.mirror2.version++;
        }

        this._syncing = false;
    }

    // Override transform methods to keep child mirrors in sync

    override setPosition(x: number, y: number, z: number): void {
        super.setPosition(x, y, z);
        this._syncMirrors();
    }

    override pointAlong(dx: number, dy: number, dz: number): void {
        super.pointAlong(dx, dy, dz);
        this._syncMirrors();
    }

    override setRotation(x: number, y: number, z: number): void {
        super.setRotation(x, y, z);
        this._syncMirrors();
    }

    override recomputeRotation(): void {
        super.recomputeRotation();
        this._syncMirrors();
    }

    override updateMatrices(): void {
        super.updateMatrices();
        this._syncMirrors();
    }

    getManagedSubcomponents(): OpticalComponent[] {
        return [this.mirror1, this.mirror2];
    }

    // No optical interaction — child mirrors handle everything
    intersect(_rayLocal: Ray): HitRecord | null {
        return null;
    }

    interact(_ray: Ray, _hit: HitRecord): InteractionResult {
        return { rays: [] };
    }
}
