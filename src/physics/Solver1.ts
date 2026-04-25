import { Vector3 } from 'three';
import { Ray, InteractionResult } from './types';
import { OpticalComponent } from './Component';
import { Laser } from './components/Laser';
import { Lamp } from './components/Lamp';
import { PointSourceBase } from './components/PointSourceBase';
import { ConeSource3D } from './components/ConeSource3D';
import { WedgeSource2D } from './components/WedgeSource2D';
import { StructuredSource } from './components/StructuredSource';
import type { GaussianBeamSegment } from './Solver2';

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

interface BeamletDraft extends GaussianBeamSegment {
    bundleKey: string;
    fallbackRadius: number;
}

export interface ForwardTraceResult {
    paths: Ray[][];
    beamSegments: GaussianBeamSegment[][];
}

function initialQ(waistRadius: number, wavelengthMm: number): { re: number; im: number } {
    return { re: 0, im: Math.PI * waistRadius * waistRadius / wavelengthMm };
}

function propagateFreeSpace(q: { re: number; im: number }, distance: number): { re: number; im: number } {
    return { re: q.re + distance, im: q.im };
}

function createLegacyQPair(
    beamRadiusMm: number,
    wavelengthSI: number,
    segmentLength: number,
    refractiveIndex: number
): { qStart: { re: number; im: number }; qEnd: { re: number; im: number } } {
    // In a medium with index n, use λ_medium = λ₀/n in q(0) and propagate with the
    // physical distance z. Applying BOTH λ/n and z/n would double-count the index.
    const wavelengthMm = wavelengthSI * 1e3;
    const effectiveWavelength = wavelengthMm / Math.max(refractiveIndex, 1e-6);
    const qStart = initialQ(beamRadiusMm, effectiveWavelength);
    const qEnd = propagateFreeSpace(qStart, segmentLength);
    return { qStart, qEnd };
}

export class Solver1 {
    maxDepth: number = 20;
    scene: OpticalComponent[];
    private emitters: Set<OpticalComponent>;

    constructor(scene: OpticalComponent[]) {
        this.scene = scene.filter(c => !c.isGhost);
        this.emitters = new Set(this.scene.filter(isEmitter));
    }

    trace(sources: Ray[]): Ray[][] {
        const allPaths: Ray[][] = [];

        for (const sourceRay of sources) {
            const o = sourceRay.origin;
            const d = sourceRay.direction;
            if (
                isNaN(o.x) || isNaN(o.y) || isNaN(o.z) ||
                isNaN(d.x) || isNaN(d.y) || isNaN(d.z)
            ) {
                console.warn("Solver1: Skipping invalid source ray (NaN values)", sourceRay);
                continue;
            }

            sourceRay.interactionDistance = undefined;
            sourceRay.interactionComponentId = undefined;
            const path: Ray[] = [sourceRay];
            this.traceRecursive(sourceRay, path, 0, allPaths);
        }

        return allPaths;
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
                (sourceWeightSums.get(sourceKey) ?? 0) + Math.max(path[0].intensity, 0)
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
            branch.map(({ fallbackRadius: _fallbackRadius, ...segment }) => segment)
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
            console.warn("Solver1: Ray became NaN during trace. Terminating path.");
            allPaths.push([...currentPath]);
            return;
        }

        let nearestT = Infinity;
        let nearestHit = null;
        let nearestComponent = null;

        for (const component of this.scene) {
            const hit = component.chkIntersection(currentRay, nearestT);

            if (hit && hit.t < nearestT && hit.t > 0.001) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
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
            nextRay.isMainRay = (currentRay.isMainRay === true);
            nextRay.sourceId = currentRay.sourceId;

            currentPath.push(nextRay);
            this.traceRecursive(nextRay, currentPath, depth + 1, allPaths);
            currentPath.pop();
            return;
        }

        for (let i = 0; i < result.rays.length; i++) {
            const nextRay = result.rays[i];

            nextRay.interactionDistance = undefined;
            nextRay.interactionComponentId = undefined;

            nextRay.isMainRay = (currentRay.isMainRay === true);
            nextRay.sourceId = currentRay.sourceId;

            if (nextRay.intensity < 1e-6) {
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
                for (const wavelengthNm of component.spectralWavelengths) {
                    targets.set(`${component.id}_${wavelengthNm}nm`, component.additiveOpacity);
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
                for (const wavelengthNm of component.spectralWavelengths) {
                    radii.set(`${component.id}_${wavelengthNm}nm`, component.beamRadius);
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
            let power = ray.intensity * powerScale;
            if (power < 1e-6) continue;

            const fallbackRadius = Math.max(ray.footprintRadius || sourceRadius || 0.05, 0.05);

            if (ray.entryPoint) {
                const internalPoints: Vector3[] = [ray.entryPoint.clone()];
                if (ray.internalPath) {
                    for (const p of ray.internalPath) internalPoints.push(p.clone());
                }
                internalPoints.push(ray.origin.clone());

                const glassComponent = this.findComponentAt(ray.entryPoint);
                const glassId = glassComponent?.id ?? 'glass';
                const glassIOR = (glassComponent && 'ior' in glassComponent)
                    ? (glassComponent as any).ior as number
                    : 1.5;
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

                    const qPair = createLegacyQPair(fallbackRadius, ray.wavelength, length, glassIOR);
                    segments.push({
                        start,
                        end,
                        direction,
                        wavelength: ray.wavelength,
                        power,
                        qx_start: { ...qPair.qStart },
                        qx_end: { ...qPair.qEnd },
                        qy_start: { ...qPair.qStart },
                        qy_end: { ...qPair.qEnd },
                        footprintStart: fallbackRadius,
                        footprintEnd: fallbackRadius,
                        polarization: {
                            x: { ...ray.polarization.x },
                            y: { ...ray.polarization.y }
                        },
                        opticalPathLength: opticalPathStart,
                        refractiveIndex: glassIOR,
                        coherenceMode: ray.coherenceMode,
                        sourceId: sourceKey,
                        bundleKey: `${sourceKey}|glass|${i}|${glassId}|${ip}`,
                        fallbackRadius,
                    });

                    if (glassAbsorption > 0) {
                        power *= Math.exp(-glassAbsorption * length);
                    }
                    traversed += length;
                }
            }

            const segmentLength = this.resolveAirSegmentLength(path, i);
            if (segmentLength < 1e-6) continue;

            const end = ray.origin.clone().add(ray.direction.clone().multiplyScalar(segmentLength));
            const qPair = createLegacyQPair(fallbackRadius, ray.wavelength, segmentLength, 1.0);

            segments.push({
                start: ray.origin.clone(),
                end,
                direction: ray.direction.clone(),
                wavelength: ray.wavelength,
                power,
                qx_start: { ...qPair.qStart },
                qx_end: { ...qPair.qEnd },
                qy_start: { ...qPair.qStart },
                qy_end: { ...qPair.qEnd },
                footprintStart: fallbackRadius,
                footprintEnd: fallbackRadius,
                polarization: {
                    x: { ...ray.polarization.x },
                    y: { ...ray.polarization.y }
                },
                opticalPathLength: ray.opticalPathLength,
                refractiveIndex: 1.0,
                coherenceMode: ray.coherenceMode,
                sourceId: sourceKey,
                bundleKey: `${sourceKey}|air|${i}|${ray.interactionComponentId ?? ray.exitSurfaceId ?? 'exit'}`,
                fallbackRadius,
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
