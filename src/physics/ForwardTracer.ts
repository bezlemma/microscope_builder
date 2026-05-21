import { Vector3 } from 'three';
import { Ray, InteractionResult } from './types';
import { OpticalComponent } from './Component';
import { Card } from './components/Card';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { QPD } from './components/QPD';
import { PointSourceBase } from './components/PointSourceBase';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';
import { TrappedBead } from './components/TrappedBead';
import { Camera } from './components/Camera';
import type { GaussianBeamSegment } from './BeamField';

/** A component counts as an emitter when forward rays hitting it should be
 *  absorbed by its housing rather than refracted/reflected. */
function isEmitter(c: OpticalComponent): boolean {
    return c instanceof Laser
        || c instanceof Lamp
        || c instanceof PointSourceBase
        || c instanceof ConeSource3D
        || c instanceof WedgeSource2D
        || c instanceof StructuredSource;
}

function componentIor(component: OpticalComponent | null): number {
    if (!component || !('ior' in component)) return 1.5;
    const value = (component as { ior: unknown }).ior;
    return typeof value === 'number' && Number.isFinite(value) ? value : 1.5;
}

interface BeamletDraft extends GaussianBeamSegment {
    bundleKey: string;
    fallbackRadius: number;
    sourceRadius?: number;
}

interface BroadPhaseCandidate {
    index: number;
    nearT: number;
}

const MIN_RELATIVE_BRANCH_INTENSITY = 1e-9;

export interface ForwardTraceResult {
    paths: Ray[][];
    beamSegments: GaussianBeamSegment[][];
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

function writeComponentBroadPhaseBounds(component: OpticalComponent, out: Float64Array, offset: number): void {
    component.updateMatrices();
    const min = component.bounds.min;
    const max = component.bounds.max;
    const center = new Vector3(
        (min.x + max.x) * 0.5,
        (min.y + max.y) * 0.5,
        (min.z + max.z) * 0.5,
    ).applyMatrix4(component.localToWorld);
    const sx = max.x - min.x;
    const sy = max.y - min.y;
    const sz = max.z - min.z;
    out[offset] = center.x;
    out[offset + 1] = center.y;
    out[offset + 2] = center.z;
    out[offset + 3] = 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
}

function lampSpectralWavelengths(lamp: Lamp): number[] {
    const wavelengths = lamp.spectralWavelengths.filter(wavelength =>
        Number.isFinite(wavelength) && wavelength > 0
    );
    return wavelengths.length > 0 ? wavelengths : [550];
}

function lampEffectiveSourcePointCount(lamp: Lamp): number {
    const sourcePointCount = Math.min(
        32,
        Math.max(1, Math.round(Number.isFinite(lamp.sourcePointCount) ? lamp.sourcePointCount : 1)),
    );
    const emitterRadius = Number.isFinite(lamp.emitterRadius) ? Math.max(0, lamp.emitterRadius) : 0;
    return emitterRadius > 0 ? sourcePointCount : 1;
}

function lampSourceKey(lamp: Lamp, wavelengthNm: number, sourcePointIndex: number, sourcePointCount: number): string {
    return sourcePointCount > 1
        ? `${lamp.id}_${wavelengthNm}nm_pt${sourcePointIndex}`
        : `${lamp.id}_${wavelengthNm}nm`;
}

export class ForwardTracer {
    maxDepth: number = 32;
    scene: OpticalComponent[];
    private emitters: Set<OpticalComponent>;
    private broadPhaseBounds: Float64Array;
    private broadPhaseCandidates: BroadPhaseCandidate[] = [];

    constructor(scene: OpticalComponent[]) {
        this.scene = scene.filter(c => !c.isGhost);
        this.emitters = new Set(this.scene.filter(isEmitter));
        this.broadPhaseBounds = new Float64Array(this.scene.length * 4);
        for (let i = 0; i < this.scene.length; i++) {
            writeComponentBroadPhaseBounds(this.scene[i], this.broadPhaseBounds, i * 4);
        }
    }

    private collectBroadPhaseCandidates(ray: Ray): BroadPhaseCandidate[] {
        const candidates = this.broadPhaseCandidates;
        candidates.length = 0;

        for (let i = 0; i < this.scene.length; i++) {
            const offset = i * 4;
            const nearT = raySphereNearT(
                ray.origin.x, ray.origin.y, ray.origin.z,
                ray.direction.x, ray.direction.y, ray.direction.z,
                this.broadPhaseBounds[offset],
                this.broadPhaseBounds[offset + 1],
                this.broadPhaseBounds[offset + 2],
                this.broadPhaseBounds[offset + 3],
            );
            if (nearT !== null) {
                candidates.push({ index: i, nearT });
            }
        }

        candidates.sort((a, b) => a.nearT - b.nearT || a.index - b.index);
        return candidates;
    }

    trace(sources: Ray[]): Ray[][] {
        this.resetTraceAccumulators();
        const allPaths: Ray[][] = [];

        for (const sourceRay of sources) {
            const o = sourceRay.origin;
            const d = sourceRay.direction;
            if (
                isNaN(o.x) || isNaN(o.y) || isNaN(o.z) ||
                isNaN(d.x) || isNaN(d.y) || isNaN(d.z)
            ) {
                console.warn("ForwardTracer: Skipping invalid source ray (NaN values)", sourceRay);
                continue;
            }

            sourceRay.interactionDistance = undefined;
            sourceRay.interactionComponentId = undefined;
            const path: Ray[] = [sourceRay];
            this.traceRecursive(sourceRay, path, 0, allPaths);
        }

        return allPaths;
    }

    private resetTraceAccumulators(): void {
        for (const component of this.scene) {
            if (component instanceof Card) component.resetHits();
            else if (component instanceof QPD) component.resetAccumulator();
            else if (component instanceof TrappedBead) component.resetAccumulator();
            else if (component instanceof Camera) component.resetPacketHits();
        }
    }

    traceWithBeamSegments(sources: Ray[]): ForwardTraceResult {
        const paths = this.trace(sources);
        const beamSegments = this.buildBeamSegments(paths);
        return { paths, beamSegments };
    }

    buildBeamSegments(allPaths: Ray[][]): GaussianBeamSegment[][] {
        const beamletPaths = allPaths.filter(path => {
            const source = path[0];
            if (!source) return false;
            if (source.isBackward) return false;
            if (source.sourceId?.startsWith('pmt_preview_')) return false;
            return true;
        });

        if (beamletPaths.length === 0) return [];

        const sourceTargets = this.resolveSourceTargets(beamletPaths);
        const sourceRadii = this.resolveSourceRadii();
        const sourceWeightSums = new Map<string, number>();

        for (let pathIndex = 0; pathIndex < beamletPaths.length; pathIndex++) {
            const path = beamletPaths[pathIndex];
            const sourceKey = this.getSourceKey(path, pathIndex);
            sourceWeightSums.set(
                sourceKey,
                (sourceWeightSums.get(sourceKey) ?? 0) + Math.max(path[0].powerWeight ?? path[0].intensity, 0)
            );
        }

        const sourceScales = new Map<string, number>();
        for (const [sourceKey, weightSum] of sourceWeightSums) {
            const target = sourceTargets.get(sourceKey) ?? weightSum;
            sourceScales.set(sourceKey, weightSum > 1e-12 ? target / weightSum : 0);
        }

        const draftBranches: BeamletDraft[][] = [];
        const allDrafts: BeamletDraft[] = [];

        for (let pathIndex = 0; pathIndex < beamletPaths.length; pathIndex++) {
            const path = beamletPaths[pathIndex];
            const sourceKey = this.getSourceKey(path, pathIndex);
            const powerScale = sourceScales.get(sourceKey) ?? 1;
            const sourceRadius = sourceRadii.get(sourceKey);
            const branch = this.buildBeamletBranch(path, sourceKey, powerScale, sourceRadius);
            if (branch.length === 0) continue;
            draftBranches.push(branch);
            allDrafts.push(...branch);
        }

        this.estimateBeamletFootprints(allDrafts);

        return draftBranches.map(branch =>
            branch.map(({
                fallbackRadius: _fallbackRadius,
                sourceRadius: _sourceRadius,
                ...segment
            }) => segment)
        );
    }

    private traceRecursive(currentRay: Ray, currentPath: Ray[], depth: number, allPaths: Ray[][]) {
        if (depth >= this.maxDepth) {
            allPaths.push([...currentPath]);
            return;
        }

        const o = currentRay.origin;
        const d = currentRay.direction;
        if (
            isNaN(o.x) || isNaN(o.y) || isNaN(o.z) ||
            isNaN(d.x) || isNaN(d.y) || isNaN(d.z)
        ) {
            console.warn("ForwardTracer: Ray became NaN during trace. Terminating path.");
            allPaths.push([...currentPath]);
            return;
        }

        let nearestT = Infinity;
        let nearestHit = null;
        let nearestComponent = null;

        const candidates = this.collectBroadPhaseCandidates(currentRay);
        let nearestIndex = Infinity;
        for (const candidate of candidates) {
            if (candidate.nearT > nearestT) break;

            const component = this.scene[candidate.index];
            const hit = component.chkIntersection(currentRay, nearestT);

            if (
                hit
                && hit.t > 0.001
                && (hit.t < nearestT || (hit.t === nearestT && candidate.index < nearestIndex))
            ) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
                nearestIndex = candidate.index;
            }
        }

        if (!nearestHit || !nearestComponent) {
            allPaths.push([...currentPath]);
            return;
        }

        currentRay.interactionDistance = nearestT;
        currentRay.interactionComponentId = nearestComponent.id;

        if (this.emitters.has(nearestComponent)) {
            allPaths.push([...currentPath]);
            return;
        }

        const result: InteractionResult = nearestComponent.interact(currentRay, nearestHit);

        if (result.rays.length === 0) {
            allPaths.push([...currentPath]);
            return;
        }

        if (result.passthrough && result.rays.length === 1) {
            const nextRay = result.rays[0];
            nextRay.interactionDistance = undefined;
            nextRay.interactionComponentId = undefined;
            nextRay.isMainRay = (currentRay.isMainRay === true);
            nextRay.sourceId = currentRay.sourceId;
            nextRay.sourceKind = currentRay.sourceKind;

            currentPath.push(nextRay);
            this.traceRecursive(nextRay, currentPath, depth + 1, allPaths);
            currentPath.pop();
            return;
        }

        const mainChildIndex = currentRay.isMainRay === true && result.rays.length > 1
            ? result.rays.reduce((bestIndex, ray, index, rays) =>
                ray.intensity > rays[bestIndex].intensity ? index : bestIndex, 0)
            : 0;

        for (let i = 0; i < result.rays.length; i++) {
            const nextRay = result.rays[i];

            nextRay.interactionDistance = undefined;
            nextRay.interactionComponentId = undefined;

            nextRay.isMainRay = currentRay.isMainRay === true
                && (result.rays.length === 1 || i === mainChildIndex);
            nextRay.sourceId = currentRay.sourceId;
            nextRay.sourceKind = currentRay.sourceKind;

            const sourceIntensity = Math.max(currentPath[0]?.intensity ?? currentRay.intensity, 1e-30);
            const relativeIntensity = nextRay.intensity / sourceIntensity;
            if (relativeIntensity < MIN_RELATIVE_BRANCH_INTENSITY) {
                currentPath.push(nextRay);
                allPaths.push([...currentPath]);
                currentPath.pop();
                continue;
            }

            currentPath.push(nextRay);
            this.traceRecursive(nextRay, currentPath, depth + 1, allPaths);
            currentPath.pop();
        }
    }

    private getSourceKey(path: Ray[], pathIndex: number): string {
        return path[0]?.sourceId ?? `path_${pathIndex}`;
    }

    private resolveSourceTargets(allPaths: Ray[][]): Map<string, number> {
        const targets = new Map<string, number>();

        for (const component of this.scene) {
            if (component instanceof Laser) {
                targets.set(component.id, component.power);
                continue;
            }

            if (component instanceof Lamp) {
                const spectralWavelengths = lampSpectralWavelengths(component);
                const sourcePointCount = lampEffectiveSourcePointCount(component);
                for (const wavelengthNm of spectralWavelengths) {
                    for (let pointIndex = 0; pointIndex < sourcePointCount; pointIndex++) {
                        targets.set(
                            lampSourceKey(component, wavelengthNm, pointIndex, sourcePointCount),
                            (component.power / spectralWavelengths.length) / sourcePointCount,
                        );
                    }
                }
            }
        }

        for (const path of allPaths) {
            const sourceKey = path[0]?.sourceId;
            if (!sourceKey || targets.has(sourceKey)) continue;
            targets.set(sourceKey, path[0].intensity);
        }

        return targets;
    }

    private resolveSourceRadii(): Map<string, number> {
        const radii = new Map<string, number>();

        for (const component of this.scene) {
            if (component instanceof Laser) {
                radii.set(component.id, component.beamRadius);
                continue;
            }

            if (component instanceof Lamp) {
                radii.set(component.id, component.beamRadius);
                const sourcePointCount = lampEffectiveSourcePointCount(component);
                for (const wavelengthNm of lampSpectralWavelengths(component)) {
                    radii.set(`${component.id}_${wavelengthNm}nm`, component.beamRadius);
                    for (let pointIndex = 0; pointIndex < sourcePointCount; pointIndex++) {
                        radii.set(
                            lampSourceKey(component, wavelengthNm, pointIndex, sourcePointCount),
                            component.beamRadius,
                        );
                    }
                }
            }
        }

        return radii;
    }

    private buildBeamletBranch(
        path: Ray[],
        sourceKey: string,
        powerScale: number,
        sourceRadius?: number
    ): BeamletDraft[] {
        const segments: BeamletDraft[] = [];

        for (let i = 0; i < path.length; i++) {
            const ray = path[i];
            let power = (ray.powerWeight ?? ray.intensity) * powerScale;
            if (power < 1e-6) continue;

            const fallbackRadius = Math.max(ray.footprintRadius || sourceRadius || 0.05, 0.05);
            const sourceEnvelopeRadius = sourceRadius !== undefined && Number.isFinite(sourceRadius)
                ? Math.max(sourceRadius, fallbackRadius)
                : undefined;

            if (ray.entryPoint) {
                const internalPoints: Vector3[] = [ray.entryPoint.clone()];
                if (ray.internalPath) {
                    for (const p of ray.internalPath) internalPoints.push(p.clone());
                }
                internalPoints.push(ray.origin.clone());

                const glassComponent = this.findComponentAt(ray.entryPoint);
                const glassId = glassComponent?.id ?? 'glass';
                const glassIOR = componentIor(glassComponent);
                const glassAbsorption = glassComponent?.absorptionCoeff ?? 0;

                let totalInternalLength = 0;
                for (let ip = 0; ip < internalPoints.length - 1; ip++) {
                    totalInternalLength += internalPoints[ip].distanceTo(internalPoints[ip + 1]);
                }

                let traversed = 0;
                for (let ip = 0; ip < internalPoints.length - 1; ip++) {
                    const start = internalPoints[ip];
                    const end = internalPoints[ip + 1];
                    const direction = end.clone().sub(start);
                    const length = direction.length();
                    if (length < 1e-6) continue;
                    direction.normalize();

                    const remainingAfterStart = totalInternalLength - traversed;
                    const opticalPathStart = ray.opticalPathLength - remainingAfterStart * glassIOR;

                    segments.push({
                        start,
                        end,
                        direction,
                        wavelength: ray.wavelength,
                        bandwidth: ray.bandwidth,
                        power,
                        footprintStart: fallbackRadius,
                        footprintEnd: fallbackRadius,
                        polarization: {
                            x: { ...ray.polarization.x },
                            y: { ...ray.polarization.y },
                            z: ray.polarization.z ? { ...ray.polarization.z } : { re: 0, im: 0 },
                        },
                        opticalPathLength: opticalPathStart,
                        refractiveIndex: glassIOR,
                        coherenceMode: ray.coherenceMode,
                        sourceId: sourceKey,
                        bundleKey: `${sourceKey}|glass|${i}|${glassId}|${ip}`,
                        fallbackRadius,
                        sourceRadius: sourceEnvelopeRadius,
                    });

                    if (glassAbsorption > 0) {
                        power *= Math.exp(-glassAbsorption * length);
                    }
                    traversed += length;
                }
            }

            if (ray.suppressVisualization) break;

            const segmentLength = this.resolveAirSegmentLength(path, i);
            if (segmentLength < 1e-6) continue;

            const end = ray.origin.clone().add(ray.direction.clone().multiplyScalar(segmentLength));

            segments.push({
                start: ray.origin.clone(),
                end,
                direction: ray.direction.clone(),
                wavelength: ray.wavelength,
                bandwidth: ray.bandwidth,
                power,
                footprintStart: fallbackRadius,
                footprintEnd: fallbackRadius,
                polarization: {
                    x: { ...ray.polarization.x },
                    y: { ...ray.polarization.y },
                    z: ray.polarization.z ? { ...ray.polarization.z } : { re: 0, im: 0 },
                },
                opticalPathLength: ray.opticalPathLength,
                refractiveIndex: 1.0,
                coherenceMode: ray.coherenceMode,
                sourceId: sourceKey,
                bundleKey: `${sourceKey}|air|${i}|${ray.interactionComponentId ?? ray.exitSurfaceId ?? 'exit'}`,
                fallbackRadius,
                sourceRadius: sourceEnvelopeRadius,
            });
        }

        return segments;
    }

    private resolveAirSegmentLength(path: Ray[], index: number): number {
        const ray = path[index];
        if (ray.interactionDistance !== undefined) {
            return ray.interactionDistance;
        }

        if (ray.terminationPoint) {
            return ray.origin.distanceTo(ray.terminationPoint);
        }

        if (index < path.length - 1) {
            return path[index + 1].origin.clone().sub(ray.origin).length();
        }

        return 200;
    }

    private estimateBeamletFootprints(drafts: BeamletDraft[]): void {
        const groups = new Map<string, BeamletDraft[]>();

        for (const draft of drafts) {
            if (!groups.has(draft.bundleKey)) groups.set(draft.bundleKey, []);
            groups.get(draft.bundleKey)!.push(draft);
        }

        for (const group of groups.values()) {
            for (const draft of group) {
                draft.footprintStart = this.estimateLocalRadius(draft, group, 'start');
                draft.footprintEnd = this.estimateLocalRadius(draft, group, 'end');
                draft.beamRadiusStart = this.estimateEnvelopeRadius(draft, group, 'start');
                draft.beamRadiusEnd = this.estimateEnvelopeRadius(draft, group, 'end');
            }
        }
    }

    private estimateLocalRadius(
        target: BeamletDraft,
        cohort: BeamletDraft[],
        endpoint: 'start' | 'end'
    ): number {
        const point = endpoint === 'start' ? target.start : target.end;
        let nearest = Infinity;

        for (const other of cohort) {
            if (other === target) continue;
            const dirDot = Math.abs(target.direction.dot(other.direction));
            if (dirDot < 0.5) continue;

            const otherPoint = endpoint === 'start' ? other.start : other.end;
            const distance = point.distanceTo(otherPoint);
            if (distance > 1e-6 && distance < nearest) {
                nearest = distance;
            }
        }

        if (!Number.isFinite(nearest)) {
            return target.fallbackRadius;
        }

        return Math.max(nearest * 0.5, 0.05);
    }

    private estimateEnvelopeRadius(
        target: BeamletDraft,
        cohort: BeamletDraft[],
        endpoint: 'start' | 'end'
    ): number {
        const points: Vector3[] = [];
        for (const other of cohort) {
            const dirDot = Math.abs(target.direction.dot(other.direction));
            if (dirDot < 0.5) continue;
            points.push(endpoint === 'start' ? other.start : other.end);
        }

        if (points.length < 2) {
            return Math.max(target.sourceRadius ?? target.fallbackRadius, 0.05);
        }

        const center = new Vector3();
        for (const point of points) center.add(point);
        center.multiplyScalar(1 / points.length);

        let maxRadius = 0;
        let rmsRadius2 = 0;
        for (const point of points) {
            const radius = point.distanceTo(center);
            maxRadius = Math.max(maxRadius, radius);
            rmsRadius2 += radius * radius;
        }
        const rmsRadius = Math.sqrt(rmsRadius2 / points.length);

        return Math.max(maxRadius, rmsRadius * 1.7, 0.05);
    }

    private findComponentAt(point: Vector3): OpticalComponent | null {
        // Transform the query point into each component's local frame and
        // test against its declared bounds. This correctly identifies glass
        // volumes regardless of shape, instead of relying on a position-to-point
        // distance that failed for thick or elongated components.
        let best: OpticalComponent | null = null;
        let bestVolume = Infinity;

        for (const c of this.scene) {
            if (isEmitter(c)) continue;
            c.updateMatrices();
            const localPoint = point.clone().applyMatrix4(c.worldToLocal);
            if (!c.bounds.containsPoint(localPoint)) continue;
            // Prefer the tightest-fitting bounds when multiple components cover
            // the same point (e.g. lens inside an objective casing).
            const size = c.bounds.getSize(new Vector3());
            const vol = size.x * size.y * size.z;
            if (vol < bestVolume) {
                bestVolume = vol;
                best = c;
            }
        }

        return best;
    }
}
