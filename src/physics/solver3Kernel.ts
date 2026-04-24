import { Matrix4, Vector3 } from 'three';
import { BeamFieldSnapshot, CameraKernelSnapshot, PMTKernelSnapshot, TraceSceneSnapshot } from './kernelTypes';
import { HitRecord, Ray, Coherence, childRay } from './types';
import { Solver2 } from './Solver2';
import { type FirstHitHintCandidate, type PackedFirstHitHints, unpackFirstHitHintCandidates } from './solver3FirstHitHints';
import { createJsPackedCameraSamples, type PackedCameraSamples, unpackCameraSample } from './solver3Sampling';
import { type AnalyticHit, type PackedAnalyticHits, unpackAnalyticHit } from './solver3AnalyticNarrowPhase';

export interface Solver3Result {
    emissionImage: Float32Array;
    excitationImage: Float32Array;
    sampleCountsImage: Uint32Array;
    paths: Ray[][];
    resX: number;
    resY: number;
}

interface PathBundleReservoir {
    selected: Ray[][][];
    seen: number;
    maxBundles: number;
}

function createPathBundleReservoir(maxBundles: number): PathBundleReservoir {
    return {
        selected: [],
        seen: 0,
        maxBundles: Math.max(0, maxBundles),
    };
}

function considerPathBundle(reservoir: PathBundleReservoir, bundle: Ray[][]): void {
    if (bundle.length === 0 || reservoir.maxBundles <= 0) return;
    reservoir.seen += 1;
    if (reservoir.selected.length < reservoir.maxBundles) {
        reservoir.selected.push(bundle);
        return;
    }
    const replaceIndex = Math.floor(Math.random() * reservoir.seen);
    if (replaceIndex < reservoir.maxBundles) {
        reservoir.selected[replaceIndex] = bundle;
    }
}

function materializeReservoirPaths(reservoir: PathBundleReservoir): Ray[][] {
    const allPaths: Ray[][] = [];
    for (const bundle of reservoir.selected) {
        allPaths.push(...bundle);
    }
    return allPaths;
}

function buildSampleTerminatedPath(path: Ray[], rayAtSample: Ray, samplePoint: Vector3): Ray[] {
    const terminalRay = childRay(rayAtSample, {
        origin: samplePoint.clone(),
        direction: rayAtSample.direction.clone(),
        intensity: rayAtSample.intensity,
        opticalPathLength: rayAtSample.opticalPathLength + (rayAtSample.interactionDistance ?? 0),
        terminationPoint: samplePoint.clone(),
    });
    return [...path, terminalRay];
}

/**
 * Drawn reverse-ray paths should end at (or near) the sample — never continue
 * past it through the excitation-side optics or into the source. For any path
 * where the kernel didn't already clip at the sample AABB, walk the segments
 * and truncate the first one that crosses (or is already past) the sample's
 * centre plane projected onto the ray. Returns a truncated copy suitable for
 * visualisation; the physics result is unaffected.
 */
function truncatePathAtSample(path: Ray[], samplePos: { x: number; y: number; z: number }): Ray[] {
    if (path.length === 0) return path;
    for (let i = 0; i < path.length; i++) {
        const ray = path[i];
        const dx = samplePos.x - ray.origin.x;
        const dy = samplePos.y - ray.origin.y;
        const dz = samplePos.z - ray.origin.z;
        const tProj = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z;
        if (tProj < -0.001) {
            // Origin is already past the sample — drop this segment and the rest.
            return path.slice(0, i);
        }
        const rayDist = ray.interactionDistance ?? Infinity;
        if (tProj <= rayDist) {
            // Ray crosses the sample plane — clip it here.
            const clipped: Ray = { ...ray, interactionDistance: tProj };
            return [...path.slice(0, i), clipped];
        }
    }
    return path;
}

export class Solver3Kernel {
    private traceScene: TraceSceneSnapshot;
    private beamField: BeamFieldSnapshot;
    private maxDepth: number = 20;

    constructor(traceScene: TraceSceneSnapshot, beamField: BeamFieldSnapshot) {
        this.traceScene = traceScene;
        this.beamField = beamField;
    }

    render(camera: CameraKernelSnapshot, maxVisPaths: number = 32): Solver3Result {
        return this.renderPackedCameraSamples(camera, createJsPackedCameraSamples(camera, null, camera.sensorResX * camera.sensorResY * Math.max(1, camera.samplesPerPixel)), maxVisPaths);
    }

    *renderGenerator(camera: CameraKernelSnapshot, maxVisPaths: number = 32): Generator<{ progress: number }, Solver3Result, void> {
        return yield* this.renderPackedCameraSamplesGenerator(camera, createJsPackedCameraSamples(camera, null, camera.sensorResX * camera.sensorResY * Math.max(1, camera.samplesPerPixel)), maxVisPaths);
    }

    renderPackedCameraSamples(
        camera: CameraKernelSnapshot,
        samples: PackedCameraSamples,
        maxVisPaths: number = 32,
        firstHitHints?: PackedFirstHitHints,
        analyticHits?: PackedAnalyticHits,
    ): Solver3Result {
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;
        const emissionImage = new Float32Array(resX * resY);
        const excitationImage = new Float32Array(resX * resY);
        const sampleCountsImage = new Uint32Array(resX * resY);
        const reservoir = createPathBundleReservoir(maxVisPaths);

        const wlList = this.getActiveWavelengths();
        const wlNorm = Math.max(1, wlList.length);

        for (let py = 0; py < resY; py++) {
            for (let sampleIndex = samples.rowOffsets[py]; sampleIndex < samples.rowOffsets[py + 1]; sampleIndex++) {
                const sample = unpackCameraSample(samples, sampleIndex);
                const sampleHintCandidates = firstHitHints
                    ? unpackFirstHitHintCandidates(firstHitHints, sampleIndex)
                    : undefined;
                const analyticHit = analyticHits ? unpackAnalyticHit(analyticHits, sampleIndex) : undefined;
                const px = Math.max(0, Math.min(resX - 1, Math.round(sample.px)));
                const bundle: Ray[][] = [];
                let sampleRadiance = 0;
                let sampleExcitation = 0;

                for (const wl of wlList) {
                    const backwardRay: Ray = {
                        origin: sample.origin.clone(),
                        direction: sample.direction.clone(),
                        wavelength: wl,
                        intensity: 1.0,
                        polarization: { x: { re: sample.polarization.x, im: 0 }, y: { re: sample.polarization.y, im: 0 } },
                        opticalPathLength: 0,
                        footprintRadius: 0.1,
                        coherenceMode: Coherence.Incoherent,
                        isBackward: true,
                        sourceId: `solver3_cam_${camera.id}_px${px}_py${py}_s${sampleIndex - samples.rowOffsets[py]}_wl${Math.round(wl * 1e9)}`,
                    };

                    const result = this.traceBackward(backwardRay, camera.id, sampleHintCandidates, analyticHit);
                    sampleRadiance += result.radiance;
                    sampleExcitation += result.excitation;
                    if (result.radiance > 0 && result.path.length > 1) {
                        bundle.push(result.path);
                    }
                }

                emissionImage[py * resX + px] += sampleRadiance / wlNorm;
                excitationImage[py * resX + px] += sampleExcitation / wlNorm;
                sampleCountsImage[py * resX + px] += 1;
                if (bundle.length > 0) {
                    considerPathBundle(reservoir, bundle);
                }
            }
        }

        return {
            emissionImage,
            excitationImage,
            sampleCountsImage,
            paths: materializeReservoirPaths(reservoir),
            resX,
            resY,
        };
    }

    *renderPackedCameraSamplesGenerator(
        camera: CameraKernelSnapshot,
        samples: PackedCameraSamples,
        maxVisPaths: number = 32,
        firstHitHints?: PackedFirstHitHints,
        analyticHits?: PackedAnalyticHits,
    ): Generator<{ progress: number }, Solver3Result, void> {
        const resX = camera.sensorResX;
        const resY = camera.sensorResY;
        const emissionImage = new Float32Array(resX * resY);
        const excitationImage = new Float32Array(resX * resY);
        const sampleCountsImage = new Uint32Array(resX * resY);
        const reservoir = createPathBundleReservoir(maxVisPaths);
        const wlList = this.getActiveWavelengths();
        const wlNorm = Math.max(1, wlList.length);

        for (let py = 0; py < resY; py++) {
            for (let sampleIndex = samples.rowOffsets[py]; sampleIndex < samples.rowOffsets[py + 1]; sampleIndex++) {
                const sample = unpackCameraSample(samples, sampleIndex);
                const sampleHintCandidates = firstHitHints
                    ? unpackFirstHitHintCandidates(firstHitHints, sampleIndex)
                    : undefined;
                const analyticHit = analyticHits ? unpackAnalyticHit(analyticHits, sampleIndex) : undefined;
                const px = Math.max(0, Math.min(resX - 1, Math.round(sample.px)));
                const bundle: Ray[][] = [];
                let sampleRadiance = 0;

                let sampleExcitation = 0;
                for (const wl of wlList) {
                    const backwardRay: Ray = {
                        origin: sample.origin.clone(),
                        direction: sample.direction.clone(),
                        wavelength: wl,
                        intensity: 1.0,
                        polarization: { x: { re: sample.polarization.x, im: 0 }, y: { re: sample.polarization.y, im: 0 } },
                        opticalPathLength: 0,
                        footprintRadius: 0.1,
                        coherenceMode: Coherence.Incoherent,
                        isBackward: true,
                        sourceId: `solver3_cam_${camera.id}_px${px}_py${py}_s${sampleIndex - samples.rowOffsets[py]}_wl${Math.round(wl * 1e9)}`,
                    };

                    const result = this.traceBackward(backwardRay, camera.id, sampleHintCandidates, analyticHit);
                    sampleRadiance += result.radiance;
                    sampleExcitation += result.excitation;
                    if (result.radiance > 0 && result.path.length > 1) {
                        bundle.push(result.path);
                    }
                }

                emissionImage[py * resX + px] += sampleRadiance / wlNorm;
                excitationImage[py * resX + px] += sampleExcitation / wlNorm;
                sampleCountsImage[py * resX + px] += 1;
                if (bundle.length > 0) {
                    considerPathBundle(reservoir, bundle);
                }
            }

            yield { progress: (py + 1) / resY };
        }

        return {
            emissionImage,
            excitationImage,
            sampleCountsImage,
            paths: materializeReservoirPaths(reservoir),
            resX,
            resY,
        };
    }

    renderPMTPixel(pmt: PMTKernelSnapshot): { radiance: number; bestPath: Ray[] | null } {
        const sample = this.traceScene.sample;
        const activeWavelengths = new Set<number>();
        const sampleEmissionWl = (sample && sample.fluorescenceEfficiency > 0)
            ? sample.getEmissionWavelength() * 1e-9
            : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);

        const hasLamp = this.traceScene.components.some(component => component.kind === 'lamp');
        if (hasLamp) activeWavelengths.add(550e-9);
        for (const branch of this.beamField.branches) {
            if (branch.length === 0) continue;
            const wl = branch[0].wavelength;
            if (hasLamp && wl >= 300e-9 && wl <= 850e-9) continue;
            activeWavelengths.add(wl);
        }
        const wlList = Array.from(activeWavelengths);
        if (wlList.length === 0) wlList.push(532e-9);

        const sinThetaMax = Math.min(pmt.sensorNA, 1.0);
        const N = pmt.samplesPerPixel;
        let targetApertureCenter: Vector3 | null = null;
        let targetApertureRadius = 0;

        const searchRay = { origin: pmt.position, direction: pmt.forward } as Ray;
        for (const component of this.traceScene.components) {
            if (component.id === pmt.id) continue;
            const hit = component.chkIntersection(searchRay);
            if (!hit || hit.t >= 100) continue;
            if (component.kind === 'aperture' || component.kind === 'slitAperture') {
                targetApertureCenter = hit.point;
                targetApertureRadius = 1.0;
                break;
            }
        }

        let radianceSum = 0;
        let bestPath: Ray[] | null = null;
        let bestRadiance = 0;

        for (let s = 0; s < N; s++) {
            let backwardDir: Vector3;
            if (targetApertureCenter && Math.random() < 0.9) {
                const phi = Math.random() * 2 * Math.PI;
                const r = targetApertureRadius * Math.sqrt(Math.random());
                const pointInHole = targetApertureCenter.clone()
                    .add(pmt.uAxis.clone().multiplyScalar(r * Math.cos(phi)))
                    .add(pmt.vAxis.clone().multiplyScalar(r * Math.sin(phi)));
                backwardDir = pointInHole.clone().sub(pmt.position).normalize();
            } else {
                const phi = Math.random() * 2 * Math.PI;
                const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
                backwardDir = pmt.forward.clone().multiplyScalar(cosTheta)
                    .add(pmt.uAxis.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                    .add(pmt.vAxis.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                    .normalize();
            }

            for (const wl of wlList) {
                const polAngle = Math.random() * Math.PI;
                const backwardRay: Ray = {
                    origin: pmt.position.clone(),
                    direction: backwardDir,
                    wavelength: wl,
                    intensity: 1.0,
                    polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: 0.1,
                    coherenceMode: Coherence.Coherent,
                    isBackward: true,
                    sourceId: `pmt_bw_s${s}_wl${Math.round(wl * 1e9)}`,
                };

                const result = this.traceBackward(backwardRay, pmt.id);
                radianceSum += result.radiance;
                if (result.radiance > bestRadiance && result.path.length > 1) {
                    bestRadiance = result.radiance;
                    bestPath = result.path;
                }
            }
        }

        return { radiance: radianceSum / (N * wlList.length), bestPath };
    }

    traceBackward(
        startRay: Ray,
        originatorId?: string,
        firstHitHintCandidates?: FirstHitHintCandidate[],
        analyticHit?: AnalyticHit,
    ): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        const path: Ray[] = [startRay];
        let visualPathAtSample: Ray[] | null = null;
        let currentRay = startRay;
        let throughput = 1.0;
        let fluorescenceRadiance = 0;
        let excitationAtSample = 0;
        let absorbed = false;
        const sample = this.traceScene.sample;

        for (let depth = 0; depth < this.maxDepth; depth++) {
            let nearestT = Infinity;
            let nearestHit: HitRecord | null = null;
            let nearestComponent: (typeof this.traceScene.components)[number] | null = null;
            let skipHintedComponents: Set<number> | undefined;

            // At depth=0, prefer a Rust-computed analytic hit when the kernel
            // was able to prove the nearest hit without calling JS intersects.
            // componentIndex >= 0 = valid hit; -1 = no hit found; -2 = Rust saw
            // an unsupported candidate and cannot be trusted, fall back to JS.
            if (depth === 0 && analyticHit && analyticHit.componentIndex >= 0) {
                const comp = this.traceScene.components[analyticHit.componentIndex];
                if (comp && comp.id !== originatorId) {
                    const localPoint = new Vector3(
                        analyticHit.localPoint[0],
                        analyticHit.localPoint[1],
                        analyticHit.localPoint[2],
                    );
                    const localNormal = new Vector3(
                        analyticHit.localNormal[0],
                        analyticHit.localNormal[1],
                        analyticHit.localNormal[2],
                    );
                    const localToWorld = (comp as unknown as { localToWorld: Matrix4 }).localToWorld;
                    const worldPoint = localPoint.clone().applyMatrix4(localToWorld);
                    const worldNormal = localNormal.clone().transformDirection(localToWorld).normalize();
                    nearestT = analyticHit.t;
                    nearestHit = {
                        t: analyticHit.t,
                        point: worldPoint,
                        normal: worldNormal,
                        localPoint,
                        isBlocked: analyticHit.isBlocked,
                    };
                    nearestComponent = comp;
                }
            }

            if (nearestHit === null && depth === 0 && firstHitHintCandidates && firstHitHintCandidates.length > 0) {
                const hinted = this.findNearestIntersectionFromHints(currentRay, originatorId, firstHitHintCandidates);
                nearestT = hinted.nearestT;
                nearestHit = hinted.nearestHit;
                nearestComponent = hinted.nearestComponent;
                if (hinted.hintedComponentIndices.size > 0) {
                    skipHintedComponents = hinted.hintedComponentIndices;
                }
                if (hinted.isCertain) {
                    currentRay.interactionDistance = nearestT;
                }
                if (hinted.isCertain && nearestHit && nearestComponent) {
                    // The broad-phase order was sufficient to prove the nearest exact hit.
                } else {
                    for (let i = 0; i < this.traceScene.components.length; i++) {
                        if (skipHintedComponents?.has(i)) continue;
                        const component = this.traceScene.components[i];
                        if (depth === 0 && component.id === originatorId) continue;
                        const hit = component.chkIntersection(currentRay);
                        if (hit && hit.t < nearestT && hit.t > 0.001) {
                            nearestT = hit.t;
                            nearestHit = hit;
                            nearestComponent = component;
                        }
                    }
                }
            } else {
                for (const component of this.traceScene.components) {
                    if (depth === 0 && component.id === originatorId) continue;
                    const hit = component.chkIntersection(currentRay);
                    if (hit && hit.t < nearestT && hit.t > 0.001) {
                        nearestT = hit.t;
                        nearestHit = hit;
                        nearestComponent = component;
                    }
                }
            }

            if (!nearestHit || !nearestComponent) {
                currentRay.interactionDistance = 50;
                break;
            }

            currentRay.interactionDistance = nearestT;

            if (nearestComponent.kind === 'laser' || nearestComponent.kind === 'lamp') {
                const backgroundIntensity = Solver2.queryIntensityMultiBeam(
                    nearestHit.point.x, nearestHit.point.y, nearestHit.point.z, this.beamField.branches, currentRay.wavelength
                );
                const terminalRay: Ray = {
                    origin: nearestHit.point,
                    direction: currentRay.direction.clone(),
                    wavelength: currentRay.wavelength,
                    intensity: Math.max(0.1, backgroundIntensity),
                    polarization: currentRay.polarization,
                    opticalPathLength: currentRay.opticalPathLength + nearestT,
                    footprintRadius: currentRay.footprintRadius,
                    coherenceMode: Coherence.Coherent,
                    sourceId: currentRay.sourceId,
                    terminationPoint: nearestHit.point.clone(),
                };
                path.push(terminalRay);
                return {
                    radiance: backgroundIntensity * throughput + fluorescenceRadiance,
                    excitation: excitationAtSample,
                    path: visualPathAtSample ?? (sample ? truncatePathAtSample(path, sample.position) : path),
                    absorbed: false,
                };
            }

            if (nearestComponent.kind === 'sample' && sample) {
                const { chordLength, midT } = sample.computeChordLength(currentRay);
                throughput *= Math.exp(-sample.absorption * chordLength);
                if (!visualPathAtSample) {
                    visualPathAtSample = buildSampleTerminatedPath(path, currentRay, nearestHit.point);
                }

                // Single chord traversal that accumulates BOTH the mean excitation
                // intensity (for the excitation channel of the image) and the
                // fluorescence contribution (for the emission channel) per sample.
                // Previously these were two separate passes, which doubled the
                // number of expensive Solver-2 field queries per reverse ray.
                // Inlined vector math avoids ~O(10*segments) Vector3 allocations
                // per reverse ray (significant GC pressure at 65k rays/frame).
                const chordSegments = sample.computeChordSegments(currentRay);
                const emitsAtThisWl = sample.fluorescenceEfficiency > 0
                    ? sample.emissionTransmission(currentRay.wavelength * 1e9)
                    : 0;
                const doesFluoresce = emitsAtThisWl > 0.5;
                const excitationWl = sample.getExcitationWavelength() * 1e-9;
                const ox = currentRay.origin.x;
                const oy = currentRay.origin.y;
                const oz = currentRay.origin.z;
                const dx = currentRay.direction.x;
                const dy = currentRay.direction.y;
                const dz = currentRay.direction.z;
                const branches = this.beamField.branches;
                let excitationSum = 0;
                let excitationSamples = 0;
                let fluorescenceSum = 0;
                for (const segment of chordSegments) {
                    const segLen = segment.tEnd - segment.tStart;
                    if (segLen <= 0) continue;
                    const numSamples = Math.max(4, Math.ceil(segLen * 10));
                    const invNumSamples = 1 / numSamples;
                    let segRadianceSum = 0;
                    for (let i = 0; i < numSamples; i++) {
                        const fraction = (i + Math.random()) * invNumSamples;
                        const t = segment.tStart + fraction * segLen;
                        const intensity = Solver2.queryIntensityMultiBeam(
                            ox + dx * t, oy + dy * t, oz + dz * t,
                            branches,
                            excitationWl,
                        );
                        segRadianceSum += intensity;
                        excitationSum += intensity;
                        excitationSamples++;
                    }
                    if (doesFluoresce) {
                        fluorescenceSum += segRadianceSum * invNumSamples * sample.fluorescenceEfficiency * emitsAtThisWl * segLen;
                    }
                }
                if (excitationSamples > 0) {
                    excitationAtSample += excitationSum / excitationSamples;
                }
                if (doesFluoresce) {
                    fluorescenceRadiance += fluorescenceSum * throughput;
                }

                const bounds = sample.getVolumeIntersection(currentRay);
                const jumpT = bounds
                    ? bounds.tFar + 0.01
                    : (midT > 0 ? midT + 20 : nearestT + 30);
                const nextRay = childRay(currentRay, {
                    origin: currentRay.origin.clone().add(currentRay.direction.clone().multiplyScalar(jumpT)),
                    direction: currentRay.direction.clone(),
                    intensity: currentRay.intensity,
                    opticalPathLength: currentRay.opticalPathLength + jumpT,
                });
                currentRay = nextRay;
                path.push(nextRay);
                continue;
            }

            const result = nearestComponent.interact(currentRay, nearestHit);
            if (result.rays.length === 0) {
                absorbed = true;
                break;
            }

            let totalIntensity = 0;
            for (const child of result.rays) totalIntensity += child.intensity;
            if (totalIntensity < 1e-12) {
                absorbed = true;
                break;
            }

            let randomWeight = Math.random() * totalIntensity;
            let selectedChild = result.rays[0];
            for (const child of result.rays) {
                randomWeight -= child.intensity;
                if (randomWeight <= 0) {
                    selectedChild = child;
                    break;
                }
            }

            if (currentRay.intensity > 1e-12) {
                throughput *= totalIntensity / currentRay.intensity;
            }

            if (result.passthrough && result.rays.length === 1) {
                selectedChild.sourceId = currentRay.sourceId;
                path.push(selectedChild);
                currentRay = selectedChild;
                continue;
            }

            selectedChild.interactionDistance = undefined;
            selectedChild.sourceId = currentRay.sourceId;
            path.push(selectedChild);
            currentRay = selectedChild;

            if (throughput < 1e-6) {
                absorbed = true;
                break;
            }
        }

        if (path.length > 0) {
            const last = path[path.length - 1];
            if (last.interactionDistance === undefined || last.interactionDistance > 2000) {
                last.interactionDistance = 2000;
            }
        }

        // Reverse-ray visualization preference: the drawn path should end at
        // the sample, never continue past it through the condenser / aperture
        // / laser on the far side. See `truncatePathAtSample` for details.
        const visualPath = visualPathAtSample ?? (sample ? truncatePathAtSample(path, sample.position) : path);
        return { radiance: fluorescenceRadiance, excitation: excitationAtSample, path: visualPath, absorbed };
    }

    private getActiveWavelengths(): number[] {
        const activeWavelengths = new Set<number>();
        const sample = this.traceScene.sample;
        const sampleEmissionWl = (sample && sample.fluorescenceEfficiency > 0)
            ? sample.getEmissionWavelength() * 1e-9
            : null;
        if (sampleEmissionWl) activeWavelengths.add(sampleEmissionWl);
        for (const branch of this.beamField.branches) {
            if (branch.length > 0) activeWavelengths.add(branch[0].wavelength);
        }
        const wlList = Array.from(activeWavelengths);
        if (wlList.length === 0) wlList.push(532e-9);
        return wlList;
    }

    private findNearestIntersectionFromHints(
        ray: Ray,
        originatorId: string | undefined,
        candidates: FirstHitHintCandidate[],
    ): {
        nearestT: number;
        nearestHit: HitRecord | null;
        nearestComponent: TraceSceneSnapshot['components'][number] | null;
        isCertain: boolean;
        hintedComponentIndices: Set<number>;
    } {
        let nearestT = Infinity;
        let nearestHit: HitRecord | null = null;
        let nearestComponent: TraceSceneSnapshot['components'][number] | null = null;
        const hintedComponentIndices = new Set<number>();

        const sorted = [...candidates].sort((a, b) => a.tNear - b.tNear);
        for (let i = 0; i < sorted.length; i++) {
            const candidate = sorted[i];
            if (candidate.componentIndex < 0 || candidate.componentIndex >= this.traceScene.components.length) continue;
            const component = this.traceScene.components[candidate.componentIndex];
            if (component.id === originatorId) continue;
            hintedComponentIndices.add(candidate.componentIndex);

            const hit = component.chkIntersection(ray);
            if (hit && hit.t < nearestT && hit.t > 0.001) {
                nearestT = hit.t;
                nearestHit = hit;
                nearestComponent = component;
            }

            const nextTNear = sorted[i + 1]?.tNear ?? Infinity;
            if (nearestHit && nearestT <= nextTNear + 1e-6) {
                return {
                    nearestT,
                    nearestHit,
                    nearestComponent,
                    isCertain: true,
                    hintedComponentIndices,
                };
            }
        }

        return {
            nearestT,
            nearestHit,
            nearestComponent,
            isCertain: false,
            hintedComponentIndices,
        };
    }
}
