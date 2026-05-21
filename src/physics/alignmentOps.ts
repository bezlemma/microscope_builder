// Geometric / paraxial alignment helpers — used by the right-click context
// menu (src/ui/ComponentContextMenu.tsx) to do one-shot optical "snaps":
// move a component to a chosen focal plane, image plane, Fourier plane, or
// align its optical axis to the incoming beam.
//
// V1 is intentionally paraxial: it treats every focusing element as a thin
// lens, assumes a straight optical axis from the source forward, and ignores
// fold mirrors when chaining through multiple lenses. The same operations
// can be re-invoked after the user introduces a fold mirror to update the
// downstream layout.

import { Vector3 } from 'three';
import type { Ray } from './types';
import { OpticalComponent } from './Component';
import { IdealLens } from './components/IdealLens';
import { SphericalLens } from './components/SphericalLens';
import { AsphericLens } from './components/AsphericLens';
import { Objective } from './components/Objective';
import { Sample } from './components/Sample';
import { Lamp } from './components/Lamp';
import { Laser } from './components/Laser';
import { PointSourceBase } from './components/PointSourceBase';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';

/** Returns a focal length [mm] for any component the snap operations can use,
 *  or null if the component isn't a single-focal-length focusing optic. */
export function getFocalLength(c: OpticalComponent): number | null {
    if (c instanceof IdealLens) return c.focalLength;
    if (c instanceof Objective) return c.focalLength;
    if (c instanceof SphericalLens) return c.focalLength;
    if (c instanceof AsphericLens) return c.focalLength;
    return null;
}

export function isFocusingOptic(c: OpticalComponent): boolean {
    return getFocalLength(c) !== null;
}

function isSourceOrSample(c: OpticalComponent): boolean {
    return c instanceof Sample
        || c instanceof Lamp
        || c instanceof Laser
        || c instanceof PointSourceBase
        || c instanceof ConeSource3D
        || c instanceof WedgeSource2D
        || c instanceof StructuredSource;
}

/** "Image of a laser" makes no sense to most users — a laser is approximately
 *  a collimated beam waist, not an extended object. Show only real imageable
 *  objects in the image-plane submenu. */
export function isImageableObject(c: OpticalComponent): boolean {
    return isSourceOrSample(c) && !(c instanceof Laser);
}

/** World-space optical axis (component's local +Z, rotated into world). */
export function getOpticalAxis(c: OpticalComponent): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(c.rotation).normalize();
}

/** Move `target` one focal length along `lens`'s optical axis. `downstream`
 *  (default true) picks the +Z side of the lens — i.e. the side rays exit. */
export function moveToFocalPlaneOf(
    target: OpticalComponent,
    lens: OpticalComponent,
    downstream = true,
): boolean {
    const f = getFocalLength(lens);
    if (f === null || !Number.isFinite(f)) return false;
    const axis = getOpticalAxis(lens);
    const sign = downstream ? 1 : -1;
    const newPos = lens.position.clone().addScaledVector(axis, sign * f);
    target.setPosition(newPos.x, newPos.y, newPos.z);
    return true;
}

/** Back focal (Fourier) plane. For a thin lens this is identical to
 *  moveToFocalPlaneOf; we keep a separate function so the menu can label the
 *  intent and so future Objective-aware back-focal-distance math can plug in. */
export function moveToFourierPlaneOf(
    target: OpticalComponent,
    lens: OpticalComponent,
): boolean {
    return moveToFocalPlaneOf(target, lens, true);
}

/** Paraxial image-plane chain: project all focusing optics in the scene onto
 *  the source's forward axis, take the upstream subset (positive signed
 *  distance from the source), and apply the thin-lens equation through each
 *  in order. Returns false if no upstream lens exists or the chain diverges. */
export function moveToImagePlaneOf(
    target: OpticalComponent,
    source: OpticalComponent,
    scene: OpticalComponent[],
): boolean {
    const axis = getOpticalAxis(source);
    type LensEntry = { comp: OpticalComponent; s: number };
    const lenses: LensEntry[] = [];
    for (const c of scene) {
        if (c.id === source.id || c.id === target.id) continue;
        if (!isFocusingOptic(c)) continue;
        const s = c.position.clone().sub(source.position).dot(axis);
        if (s > 0.5) lenses.push({ comp: c, s });
    }
    lenses.sort((a, b) => a.s - b.s);
    if (lenses.length === 0) return false;

    let imagePos = source.position.clone();
    for (const { comp } of lenses) {
        const f = getFocalLength(comp)!;
        // Signed object distance from this lens back to the current image.
        const u = comp.position.clone().sub(imagePos).dot(axis);
        if (u <= 0.01) continue;
        const denom = u - f;
        if (Math.abs(denom) < 1e-6) return false; // image at infinity
        const v = (u * f) / denom; // signed image distance, along +axis
        imagePos = comp.position.clone().addScaledVector(axis, v);
    }
    if (!Number.isFinite(imagePos.x) || !Number.isFinite(imagePos.y) || !Number.isFinite(imagePos.z)) return false;
    target.setPosition(imagePos.x, imagePos.y, imagePos.z);
    return true;
}

/** Snap `target` onto the nearest forward-trace beam: translate it onto the
 *  closest point along the beam's centerline AND rotate so its local +Z axis
 *  matches the ray direction. We prefer main rays so the snap lands on the
 *  beam's actual centerline, not an edge ray of the bundle. */
export function alignAxisToIncomingBeam(
    target: OpticalComponent,
    forwardRays: Ray[][],
): boolean {
    type Hit = { point: Vector3; dir: Vector3; dist2: number };
    let bestMain: Hit | null = null;
    let bestAny: Hit | null = null;
    const tp = target.position;

    for (const path of forwardRays) {
        for (let i = 0; i < path.length; i++) {
            const ray = path[i];
            // Skip the ray segment whose start is this component itself —
            // otherwise we snap to where we already are. forward tracer stamps the
            // interaction id on the ray that's about to hit; the NEXT ray
            // starts at that hit and has no interactionComponentId of `target`.
            const segStart = ray.origin;
            const next = path[i + 1];
            // Segment end: next ray's origin if available, else project forward
            // a generous distance so terminal rays still get considered.
            const segEnd = next
                ? next.origin
                : segStart.clone().addScaledVector(ray.direction, 5000);
            const segDir = segEnd.clone().sub(segStart);
            const segLen = segDir.length();
            if (segLen < 1e-3) continue;
            segDir.divideScalar(segLen);

            // Closest point on segment to target.position.
            const v = tp.clone().sub(segStart);
            const tParam = Math.max(0, Math.min(segLen, v.dot(segDir)));
            const closest = segStart.clone().addScaledVector(segDir, tParam);
            const dist2 = closest.distanceToSquared(tp);

            const hit: Hit = { point: closest, dir: segDir.clone(), dist2 };
            if (!bestAny || dist2 < bestAny.dist2) bestAny = hit;
            if (ray.isMainRay) {
                if (!bestMain || dist2 < bestMain.dist2) bestMain = hit;
            }
        }
    }

    const winner = bestMain ?? bestAny;
    if (!winner) return false;
    target.setPosition(winner.point.x, winner.point.y, winner.point.z);
    target.pointAlong(winner.dir.x, winner.dir.y, winner.dir.z);
    return true;
}
