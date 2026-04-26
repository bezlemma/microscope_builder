import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useAtom } from 'jotai';
import {
    componentsAtom,
    rayConfigAtom,
    solver3RenderTriggerAtom,
    solver3RenderingAtom,
    animatorAtom,
    animationPlayingAtom,
    animationSpeedAtom,
    scanAccumTriggerAtom,
    scanAccumProgressAtom,
    MAX_FORWARD_RAY_COUNT,
    MAX_REVERSE_PATH_COUNT,
    MIN_FORWARD_RAY_COUNT,
    MIN_REVERSE_PATH_COUNT,
    activeZLevelAtom,
    drawnRayCountsAtom,
    cameraImageTickAtom,
    isDraggingAtom,
    forwardRaysAtom,
} from '../state/store';
import type { AnimationChannel } from '../physics/PropertyAnimator';
import { useFrame } from '@react-three/fiber';

import { Coherence, Ray } from '../physics/types';
import { OpticalComponent } from '../physics/Component';
import { Solver1 } from '../physics/Solver1';
import { Card } from '../physics/components/Card';
import { Sample, type ColloidTrapZone } from '../physics/components/Sample';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { TrappedBead } from '../physics/components/TrappedBead';

import { RayVisualizer } from './RayVisualizer';

import { BundleWaveVisualizer } from './BundleWaveVisualizer';
import { GaussianBeamSegment, segmentBeamRadii } from '../physics/Solver2';
import { Solver3 } from '../physics/Solver3';
import { createSourceRays } from '../physics/SourceRayFactory';
import { serializeScene } from '../state/ubzSerializer';
import type { MainToWorker, WorkerToMain, SerializedPath } from '../physics/solver3Worker';

/** Re-hydrate structured-cloned rays from the worker into real Vector3s. */
function rehydratePath(path: SerializedPath): Ray[] {
    return path.map(r => ({
        origin: new Vector3(r.origin.x, r.origin.y, r.origin.z),
        direction: new Vector3(r.direction.x, r.direction.y, r.direction.z),
        wavelength: r.wavelength,
        intensity: r.intensity,
        opticalPathLength: r.opticalPathLength,
        footprintRadius: r.footprintRadius,
        coherenceMode: r.coherenceMode,
        sourceId: r.sourceId,
        isMainRay: r.isMainRay,
        polarization: r.polarization ?? { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        interactionDistance: r.interactionDistance,
        terminationPoint: r.terminationPoint
            ? new Vector3(r.terminationPoint.x, r.terminationPoint.y, r.terminationPoint.z)
            : undefined,
    }));
}

function syncManagedTrapBeads(components: OpticalComponent[]): boolean {
    const samples = new Map<string, Sample>();
    for (const component of components) {
        if (component instanceof Sample) samples.set(component.id, component);
    }

    let changed = false;
    for (const component of components) {
        if (!(component instanceof TrappedBead) || !component.parentSampleId) continue;
        const sample = samples.get(component.parentSampleId);
        if (!sample) continue;

        const rotationChanged = Math.abs(component.rotation.dot(sample.rotation)) < 1 - 1e-10;
        const positionChanged = !component.position.equals(sample.position);
        if (positionChanged || rotationChanged) {
            component.position.copy(sample.position);
            component.rotation.copy(sample.rotation);
            component.version++;
            changed = true;
        }

        const nextHalfSize = new Vector3(
            sample.flowCellWidth / 2,
            sample.flowCellHeight / 2,
            sample.flowCellDepth / 2,
        );
        if (!component.confinementHalfSize || !component.confinementHalfSize.equals(nextHalfSize)) {
            component.confinementHalfSize = nextHalfSize;
            component.constrainToFlowCell();
            changed = true;
        }
        if (component.iorMedium !== sample.fillMediumIndex) {
            component.iorMedium = sample.fillMediumIndex;
            changed = true;
        }
    }

    return changed;
}

function trapBeamHasPower(beamSegments: GaussianBeamSegment[][]): boolean {
    return beamSegments.some(branch => branch.some(segment =>
        segment.coherenceMode === Coherence.Coherent && segment.power > 1e-9
    ));
}

function colloidTrapZonesBySample(
    components: OpticalComponent[],
    beamSegments: GaussianBeamSegment[][],
): Map<string, ColloidTrapZone[]> {
    const zones = new Map<string, ColloidTrapZone[]>();
    if (!trapBeamHasPower(beamSegments)) return zones;

    for (const component of components) {
        if (!(component instanceof TrappedBead) || !component.parentSampleId) continue;
        const zone: ColloidTrapZone = {
            center: new Vector3(0, 0, 0),
            lateralRadius: component.trapCaptureRadius,
            axialRange: component.trapAxialCaptureRange,
            stiffnessPerSecond: 14,
        };
        const sampleZones = zones.get(component.parentSampleId) ?? [];
        sampleZones.push(zone);
        zones.set(component.parentSampleId, sampleZones);
    }

    return zones;
}

import { Draggable } from './Draggable';
import { getComponentVisualizer } from './componentPresentation';
import { OutlineColorContext } from './visualizers/ComponentVisualizers';
import { TutorialOverlay } from './TutorialOverlay';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { captureAnimatedValues, createScheduledRenderJob } from './renderJob';
import { useHaptic } from './useHaptic';

type PMTRasterChannel = Pick<AnimationChannel, 'targetId' | 'property' | 'from' | 'to'>;
type PMTRasterPlan = { pmt: PMT; xCh: PMTRasterChannel; yCh: PMTRasterChannel };

function resolvePMTRasterChannels(
    components: OpticalComponent[],
    channels: AnimationChannel[],
    pmt: PMT,
): { xCh: PMTRasterChannel; yCh: PMTRasterChannel } | null {
    const byId = new Map<string, OpticalComponent>();
    for (const c of components) byId.set(c.id, c);

    const resolveAxis = (targetId: string | null, property: string | null): PMTRasterChannel | null => {
        if (!targetId || !property) return null;
        const animated = channels.find(ch => ch.targetId === targetId && ch.property === property);
        if (animated) return animated;

        const target = byId.get(targetId) as OpticalComponent & {
            scanAmplitudeX?: number;
            scanAmplitudeY?: number;
        } | undefined;
        if (!target) return null;

        if (property === 'scanX' && typeof target.scanAmplitudeX === 'number' && target.scanAmplitudeX > 0) {
            return { targetId, property, from: -target.scanAmplitudeX, to: target.scanAmplitudeX };
        }
        if (property === 'scanY' && typeof target.scanAmplitudeY === 'number' && target.scanAmplitudeY > 0) {
            return { targetId, property, from: -target.scanAmplitudeY, to: target.scanAmplitudeY };
        }

        return null;
    };

    const xCh = resolveAxis(pmt.xAxisComponentId, pmt.xAxisProperty);
    const yCh = resolveAxis(pmt.yAxisComponentId, pmt.yAxisProperty);
    return xCh && yCh ? { xCh, yCh } : null;
}

function resolvePMTRasterPlans(
    components: OpticalComponent[],
    channels: AnimationChannel[],
): PMTRasterPlan[] {
    const plans: PMTRasterPlan[] = [];
    for (const comp of components) {
        if (!(comp instanceof PMT) || !comp.hasValidAxes()) continue;
        const rasterChannels = resolvePMTRasterChannels(components, channels, comp);
        if (rasterChannels) {
            plans.push({ pmt: comp, ...rasterChannels });
        }
    }
    return plans;
}


export const OpticalTable: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [rayConfig] = useAtom(rayConfigAtom);
    const [activeZ] = useAtom(activeZLevelAtom);
    const [rays, setRays] = useState<Ray[][]>([]);
    const [beamSegments, setBeamSegments] = useState<GaussianBeamSegment[][]>([]);
    const [solver3Paths, setSolver3Paths] = useState<Ray[][]>([]);
    const [solver3Trigger, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [isDragging] = useAtom(isDraggingAtom);
    const [, setForwardRays] = useAtom(forwardRaysAtom);
    const [, setSolver3Rendering] = useAtom(solver3RenderingAtom);
    // Actually we need the value for the guard
    const [solver3Rendering] = useAtom(solver3RenderingAtom);
    const [scanAccumConfig] = useAtom(scanAccumTriggerAtom);
    const [, setScanAccumProgress] = useAtom(scanAccumProgressAtom);
    const [, setDrawnRayCounts] = useAtom(drawnRayCountsAtom);
    const [, setCameraImageTick] = useAtom(cameraImageTickAtom);
    const haptic = useHaptic();

    // Keep the UI counter of drawn rays in sync with what the RayVisualizer sees.
    // Each path corresponds to one source-emitted ray (it may bounce through
    // several components, producing multiple segments — those are not counted
    // separately here).
    useEffect(() => {
        setDrawnRayCounts({ forward: rays.length, reverse: solver3Paths.length });
    }, [rays, solver3Paths, setDrawnRayCounts]);

    // (Sample / SampleChamber zoom-viewer auto-pinning is preset-specific —
    // see loadPresetAtom for OpenSPIM, which is the only preset where the
    // ray-vs-sample geometry is the primary thing the user wants to watch.
    // Other presets leave the user to pin manually.)

    // ─── Animation System ───
    const [animator] = useAtom(animatorAtom);
    const [animPlaying] = useAtom(animationPlayingAtom);
    const [animSpeed] = useAtom(animationSpeedAtom);
    const animStateRef = useRef({ playing: false, speed: 1.0 });
    animStateRef.current.playing = animPlaying;
    animStateRef.current.speed = animSpeed;
    const componentsRef = useRef(components);
    componentsRef.current = components;

    // Animation counter — increments force React re-render for fingerprint
    const [animTick, setAnimTick] = useState(0);
    const setAnimTickRef = useRef(setAnimTick);
    setAnimTickRef.current = setAnimTick;

    // Guard ref: when true, scan accumulation is running — skip useFrame and Solver 1
    const scanAccumActiveRef = useRef(false);
    const trapBeamSegsRef = useRef<GaussianBeamSegment[][]>([]);
    const lastTrapRedrawMsRef = useRef(0);

    useFrame((_, delta) => {
        if (scanAccumActiveRef.current) return; // Skip during scan accumulation
        const { playing, speed } = animStateRef.current;
        if (!playing) return;
        animator.playing = true;
        const mutated = animator.tick(delta * 1000 * speed, componentsRef.current);
        if (mutated) {
            // Force fingerprint recalculation by triggering a React re-render
            setAnimTickRef.current(t => t + 1);
        }
    });

    // ─── TrappedBead integrator ───────────────────────────────────────────
    // Runs every frame regardless of the master animation play state, because
    // the bead always experiences forces from the live beam — turning off the
    // global "play" button shouldn't freeze a trap any more than turning off
    // your monitor freezes one in a real lab.
    //
    // Solver 1 is intentionally not re-run for every bead Brownian/force step:
    // doing so continuously remounts thousands of ray line geometries and can
    // grow browser memory until interaction crashes the page. Static optics
    // changes rebuild the beam field; bead motion samples that cached field.
    useFrame(() => {
        if (scanAccumActiveRef.current) return;
        const currentComponents = componentsRef.current;
        const now = performance.now();
        let anyMoved = syncManagedTrapBeads(currentComponents);
        const trapBeamSegs = trapBeamSegsRef.current;
        const sampleTrapZones = colloidTrapZonesBySample(currentComponents, trapBeamSegs);

        for (const sample of currentComponents) {
            const zones = sampleTrapZones.get(sample.id) ?? [];
            if (sample instanceof Sample && sample.stepColloidDiffusion(now, zones)) {
                anyMoved = true;
            }
        }

        const beads = currentComponents.filter(c => c instanceof TrappedBead) as TrappedBead[];
        for (const bead of beads) {
            if (trapBeamSegs.length > 0) {
                bead.accumulateGradientTrapForce(trapBeamSegs);
            }
            if (bead.applyForceStep(now)) anyMoved = true;
        }
        if (anyMoved && now - lastTrapRedrawMsRef.current > 33) {
            lastTrapRedrawMsRef.current = now;
            setAnimTickRef.current(t => t + 1);
        }
    });

    // ─── Optics fingerprint: changes only when non-Card components change ───
    // Cards are passive detectors and don't affect the optical path, so moving
    // them should NOT trigger the expensive Solver1/Solver2 re-computation.
    // Uses component.version which is bumped on every property mutation.
    const opticsFingerprint = useMemo(() => {
        if (!components) return '';
        // Cards only affect optics when flagged opaque — otherwise they're passive.
        return components
            .filter(c => !(c instanceof Card) || (c as Card).opaque)
            .map(c => `${c.id}:${c.position.x},${c.position.y},${c.position.z}:${c.rotation.x},${c.rotation.y},${c.rotation.z},${c.rotation.w}:v${c.version}`)
            .join('|');
    }, [components, animTick]);

    // Refs to hold expensive solver results for card sampling effect
    const solverPathsRef = useRef<Ray[][]>([]);
    const beamSegsRef = useRef<GaussianBeamSegment[][]>([]);
    const solver3PathsRef = useRef<Ray[][]>([]);
    const lastOpticsFingerprintRef = useRef<string>('');
    const clampedForwardRayCount = Math.max(MIN_FORWARD_RAY_COUNT, Math.min(MAX_FORWARD_RAY_COUNT, rayConfig.rayCount));
    const clampedReversePathCount = Math.max(MIN_REVERSE_PATH_COUNT, Math.min(MAX_REVERSE_PATH_COUNT, rayConfig.reversePathCount));

    const traceCenterBeamSegments = () => {
        syncManagedTrapBeads(components);
        const solver1 = new Solver1(components);
        // We MUST trace a full ring cohort so Solver1 can estimate beam footprints geometrically.
        // A single center ray results in an unfocused 0.1mm beam that misses the sample off-axis.
        const sourceRays = createSourceRays(components, Math.max(8, Math.min(clampedForwardRayCount, 16)), 'full');
        return solver1.traceWithBeamSegments(sourceRays).beamSegments;
    };

    useEffect(() => {
        if (!components) return;
        if (scanAccumActiveRef.current) return; // Skip during scan accumulation
        syncManagedTrapBeads(components);
        const sceneChanged = lastOpticsFingerprintRef.current !== opticsFingerprint;
        lastOpticsFingerprintRef.current = opticsFingerprint;


        const cardsToReset = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardsToReset) {
            card.hits = [];
        }

        const solver = new Solver1(components);
        const sourceRays = createSourceRays(components, clampedForwardRayCount, 'full');

        const calculatedPaths = solver.trace(sourceRays);

        // Post-trace: detect beam splits via angle histogram population analysis.
        // Only needed when E&M solver is enabled — the branching path logic
        // relies on marginal rays to detect population splits.
        if (rayConfig.solver2Enabled) {
            const surviving = calculatedPaths.filter(p => {
                if (p.length < 2) return false;
                const last = p[p.length - 1];
                return last.intensity > 0 && !last.terminationPoint;
            });


            type SplitEntry = { path: Ray[]; exitRay: Ray; angle: number; sourceId?: string };
            const allSplitCandidates: SplitEntry[] = [];
            for (const p of surviving) {
                for (let i = p.length - 1; i >= 0; i--) {
                    if (p[i].exitSurfaceId) {
                        allSplitCandidates.push({
                            path: p,
                            exitRay: p[i],
                            angle: Math.atan2(p[i].direction.y, p[i].direction.x),
                            sourceId: p[0].sourceId
                        });
                        break;
                    }
                }
            }


            const splitBySource = new Map<string, SplitEntry[]>();
            for (const sc of allSplitCandidates) {
                const key = sc.sourceId || '__unknown__';
                if (!splitBySource.has(key)) splitBySource.set(key, []);
                splitBySource.get(key)!.push(sc);
            }

            for (const [, splitCandidates] of splitBySource) {
                if (splitCandidates.length >= 4) {

                    splitCandidates.sort((a, b) => a.angle - b.angle);


                    const gaps: number[] = [];
                    for (let i = 1; i < splitCandidates.length; i++) {
                        gaps.push(splitCandidates[i].angle - splitCandidates[i - 1].angle);
                    }

                    // IQR-based outlier detection on gaps.
                    // A gap is a split boundary if it's a statistical outlier —
                    // this naturally distinguishes "one spread-out population" from
                    // "two distinct clusters" regardless of absolute angle scale.
                    const sortedGaps = [...gaps].sort((a, b) => a - b);
                    const q1 = sortedGaps[Math.floor(sortedGaps.length * 0.25)];
                    const q3 = sortedGaps[Math.floor(sortedGaps.length * 0.75)];
                    const iqr = q3 - q1;
                    // Median-based floor: when gaps are uniform (IQR ≈ 0), the raw
                    // fence collapses to Q3 and flags tiny variations as splits.
                    // Requiring 3× the median gap prevents false positives.
                    const median = sortedGaps[Math.floor(sortedGaps.length * 0.5)];
                    const fence = Math.max(q3 + 1.5 * iqr, median * 3);

                    const splitIndices: number[] = [];
                    for (let i = 0; i < gaps.length; i++) {
                        if (gaps[i] > fence && gaps[i] > 0.01) {
                            splitIndices.push(i + 1);
                        }
                    }

                    if (splitIndices.length > 0) {
                        const boundaries = [0, ...splitIndices, splitCandidates.length];
                        const populations: SplitEntry[][] = [];
                        for (let i = 0; i < boundaries.length - 1; i++) {
                            const pop = splitCandidates.slice(boundaries[i], boundaries[i + 1]);
                            if (pop.length > 0) populations.push(pop);
                        }

                        // Identify the split component name from candidates' exitSurfaceId.
                        // e.g. "Prism:front" → "Prism". Only match main-ray paths that
                        // interact with this same component (prevents cross-laser contamination
                        // when multiple lasers are on the table).
                        const splitCompName = splitCandidates[0].exitRay.exitSurfaceId?.split(':')[0] ?? '';
                        const mainPathMatchesSplitComp = (p: Ray[]) =>
                            p.some(r => r.exitSurfaceId?.startsWith(splitCompName));

                        let mainRayExitAngle: number | null = null;
                        for (const p of calculatedPaths) {
                            if (p.length > 0 && p[0].isMainRay === true && mainPathMatchesSplitComp(p)) {
                                for (let i = p.length - 1; i >= 0; i--) {
                                    if (p[i].exitSurfaceId?.startsWith(splitCompName)) {
                                        mainRayExitAngle = Math.atan2(
                                            p[i].direction.y, p[i].direction.x
                                        );
                                        break;
                                    }
                                }
                                if (mainRayExitAngle !== null) break;
                            }
                        }


                        let mainRayPopIdx = -1;
                        if (mainRayExitAngle !== null) {
                            for (let pi = 0; pi < populations.length; pi++) {
                                const pop = populations[pi];
                                const minA = pop[0].angle;
                                const maxA = pop[pop.length - 1].angle;
                                const margin = (maxA - minA) * 0.5 + 0.05;
                                if (mainRayExitAngle >= minA - margin &&
                                    mainRayExitAngle <= maxA + margin) {
                                    mainRayPopIdx = pi;
                                    break;
                                }
                            }
                        }


                        const uncoveredPops = populations.filter((_, i) => i !== mainRayPopIdx);

                        if (uncoveredPops.length > 0) {
                            for (const pop of uncoveredPops) {
                                // Find the most central ring ray in this population
                                // and clone its full path as the white center line.
                                // This preserves the correct physical path (laser → prism
                                // internal → exit → infinity) instead of creating a
                                // synthetic ray that starts inside the prism.
                                const meanAngle = pop.reduce((s, e) => s + e.angle, 0) / pop.length;
                                const closest = pop.reduce((best, e) =>
                                    Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                                );
                                const syntheticPath = closest.path.map(
                                    r => ({ ...r, isMainRay: true })
                                );
                                calculatedPaths.push(syntheticPath);
                            }
                        }
                    }
                }
            } // end for splitBySource

            // Fallback: ensure every population of boundary-terminating rays has a
            // white center line. Fires for ANY ray that terminates in space (no
            // further object hit), regardless of whether it passed through a prism,
            // lens, or nothing. If populations are found that lack a main-ray path,
            // the most central ring ray is cloned as white.
            {
                // Paths terminating in space: last ray has positive intensity and
                // no interactionDistance (it went to infinity, not stopped by an object)
                const boundaryPaths = calculatedPaths.filter(p => {
                    if (p.length < 1) return false;
                    const last = p[p.length - 1];
                    return last.intensity > 0 && last.interactionDistance === undefined;
                });


                const boundaryBySource = new Map<string, typeof boundaryPaths>();
                for (const p of boundaryPaths) {
                    const key = p[0].sourceId || '__unknown__';
                    if (!boundaryBySource.has(key)) boundaryBySource.set(key, []);
                    boundaryBySource.get(key)!.push(p);
                }

                for (const [, sourcePaths] of boundaryBySource) {
                    if (sourcePaths.length >= 3) {
                        type BEntry = { path: Ray[]; angle: number; isMain: boolean };
                        const entries: BEntry[] = sourcePaths.map(p => ({
                            path: p,
                            angle: Math.atan2(
                                p[p.length - 1].direction.y,
                                p[p.length - 1].direction.x
                            ),
                            isMain: p[0].isMainRay === true
                        }));
                        entries.sort((a, b) => a.angle - b.angle);


                        const gaps: number[] = [];
                        for (let i = 1; i < entries.length; i++) {
                            gaps.push(entries[i].angle - entries[i - 1].angle);
                        }

                        if (gaps.length >= 2) {
                            const sortedGaps = [...gaps].sort((a, b) => a - b);
                            const q1 = sortedGaps[Math.floor(sortedGaps.length * 0.25)];
                            const q3 = sortedGaps[Math.floor(sortedGaps.length * 0.75)];
                            const iqr = q3 - q1;
                            // Median-based floor: prevents false splits when gaps are
                            // nearly uniform (single wide population through a lens).
                            const median = sortedGaps[Math.floor(sortedGaps.length * 0.5)];
                            const fence = Math.max(q3 + 1.5 * iqr, median * 3);


                            const splitIndices: number[] = [];
                            for (let i = 0; i < gaps.length; i++) {
                                if (gaps[i] > fence && gaps[i] > 0.01) {
                                    splitIndices.push(i + 1);
                                }
                            }


                            const bounds = [0, ...splitIndices, entries.length];
                            const populations: BEntry[][] = [];
                            for (let i = 0; i < bounds.length - 1; i++) {
                                const pop = entries.slice(bounds[i], bounds[i + 1]);
                                if (pop.length > 0) populations.push(pop);
                            }


                            for (const pop of populations) {
                                const hasMain = pop.some(e => e.isMain);
                                if (hasMain) continue;
                                if (pop.length < 2) continue;


                                const meanAngle = pop.reduce((s, e) => s + e.angle, 0) / pop.length;
                                const closest = pop.reduce((best, e) =>
                                    Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                                );
                                const syntheticPath = closest.path.map(
                                    r => ({ ...r, isMainRay: true })
                                );
                                calculatedPaths.push(syntheticPath);
                            }
                        } else if (!entries.some(e => e.isMain)) {

                            const meanAngle = entries.reduce((s, e) => s + e.angle, 0) / entries.length;
                            const closest = entries.reduce((best, e) =>
                                Math.abs(e.angle - meanAngle) < Math.abs(best.angle - meanAngle) ? e : best
                            );
                            const syntheticPath = closest.path.map(
                                r => ({ ...r, isMainRay: true })
                            );
                            calculatedPaths.push(syntheticPath);
                        }
                    }
                } // end for boundaryBySource

            } // end fallback split detection block
        } // end solver2Enabled guard

        setRays(calculatedPaths);
        setForwardRays(calculatedPaths);
        solverPathsRef.current = calculatedPaths;

        let beamSegs: GaussianBeamSegment[][] = [];
        const trappedBeads = components.filter(c => c instanceof TrappedBead) as TrappedBead[];
        if (rayConfig.solver2Enabled || trappedBeads.length > 0) {
            try {
                beamSegs = solver.buildBeamSegments(calculatedPaths);
            } catch (e) {
                console.warn('Solver 2 error:', e);
            }
        }
        trapBeamSegsRef.current = trappedBeads.length > 0 ? beamSegs : [];
        const visibleBeamSegs = rayConfig.solver2Enabled ? beamSegs : [];
        setBeamSegments(visibleBeamSegs);
        beamSegsRef.current = visibleBeamSegs;

        if (sceneChanged) {
            let hasCamera = false;
            for (const comp of components) {
                if (comp instanceof Camera) {
                    comp.markSolver3Stale();
                    hasCamera = true;
                }
            }
            // Auto-kick Solver-3 whenever the scene changes and there is a detector,
            // so camera images refresh without the user pressing "Render".
            // PMTs are handled by the dedicated raster effect below; the worker
            // path only produced preview rays and never published a PMT image.
            if (hasCamera && !solver3Rendering) {
                setSolver3Trigger(t => t + 1);
            }
            // Check if scan results should be invalidated:
            // Only clear if a NON-ANIMATED component changed since scan completed
            const animatedIds = new Set(animator.channels.map(ch => ch.targetId));
            let shouldClearScan = false;
            for (const comp of components) {
                if (comp instanceof Camera && (comp as Camera).scanFrames) {
                    const cam = comp as Camera;
                    const snapshot = cam.scanVersionSnapshot;
                    if (snapshot) {
                        // Check if any non-animated component version changed
                        for (const c of components) {
                            if (animatedIds.has(c.id)) continue; // skip animated components
                            const savedVersion = snapshot.get(c.id);
                            if (savedVersion === undefined || c.version !== savedVersion) {
                                shouldClearScan = true;
                                break;
                            }
                        }
                        if (shouldClearScan) {
                            cam.clearScanFrames();
                            cam.solver3Image = null;
                            cam.forwardImage = null;
                            cam.solver3Paths = null;
                        }
                    }
                }
            }
            setSolver3Paths([]);
            solver3PathsRef.current = [];
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opticsFingerprint, rayConfig]);

    // ─── Effect 1b: Solver 3 — backward trace from ALL detectors, run in a
    // worker pool.  Each worker runs an independent infinite-progressive
    // accumulator with its own RNG; the main thread merges N parallel
    // snapshots per camera by computing a weighted running average across
    // workers (sum(emAvg_w · count_w) / sum(count_w) per pixel).
    const SOLVER3_WORKER_COUNT = (() => {
        if (typeof navigator === 'undefined') return 1;
        const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 2;
        return Math.max(1, Math.min(8, cores - 1));
    })();
    const solver3WorkersRef = useRef<Worker[]>([]);
    const solver3JobIdRef = useRef<number>(0);
    const componentsRefForSolver3 = useRef(components);
    componentsRefForSolver3.current = components;

    // Per-(camera,worker) latest accumulator snapshot, for the main-thread
    // weighted-merge. Map<cameraId, snapshots[workerId]>.
    const workerAccumRef = useRef<Map<string, { em: Float32Array; ex: Float32Array; cnt: Uint32Array }[]>>(new Map());
    const workerCompleteRef = useRef<Set<number>>(new Set());
    const workerRayCountsRef = useRef<number[]>([]);
    const workerErrorRef = useRef(false);

    // Lazily spin up a pool of workers and wire the merging message handler.
    useEffect(() => {
        const workers: Worker[] = [];
        for (let w = 0; w < SOLVER3_WORKER_COUNT; w++) {
            const worker = new Worker(new URL('../physics/solver3Worker.ts', import.meta.url), {
                type: 'module',
            });
            workers.push(worker);

            const onMessage = (e: MessageEvent<WorkerToMain>) => {
                const msg = e.data;
                if (msg.jobId !== solver3JobIdRef.current) return;
                const currentComponents = componentsRefForSolver3.current;
                if (msg.type === 'progress') {
                    if (w === 0) {
                        // Use the first worker as the progress source so the
                        // bar advances at one steady rate rather than racing.
                        const cameras = currentComponents.filter(c => c instanceof Camera) as Camera[];
                        const totalWorkUnits = Math.max(cameras.length, 1);
                        const normalized = Math.max(0, Math.min(1, (msg.cameraIndex + msg.fraction) / totalWorkUnits));
                        setScanAccumProgress(normalized);
                    }
                } else if (msg.type === 'camera-done') {
                    const camera = currentComponents.find(c => c.id === msg.cameraId) as Camera | undefined;
                    if (!camera) return;

                    // Stash this worker's latest snapshot for the camera.
                    let snapshots = workerAccumRef.current.get(msg.cameraId);
                    if (!snapshots) {
                        snapshots = new Array(SOLVER3_WORKER_COUNT).fill(null) as { em: Float32Array; ex: Float32Array; cnt: Uint32Array }[];
                        workerAccumRef.current.set(msg.cameraId, snapshots);
                    }
                    snapshots[w] = {
                        em: msg.emissionImage,
                        ex: msg.excitationImage,
                        cnt: msg.sampleCountsImage,
                    };

                    // Merge across all workers we've heard from.  Each worker
                    // sends per-pixel running averages (em/ex) plus its
                    // accumulated sample counts; the global weighted average
                    // is sum(emAvg_w · count_w) / sum(count_w).
                    const pixels = camera.sensorResX * camera.sensorResY;
                    const merged = new Float32Array(pixels);
                    const mergedEx = new Float32Array(pixels);
                    const mergedCnt = new Uint32Array(pixels);
                    for (const snap of snapshots) {
                        if (!snap) continue;
                        for (let i = 0; i < pixels; i++) {
                            const c = snap.cnt[i];
                            merged[i] += snap.em[i] * c;
                            mergedEx[i] += snap.ex[i] * c;
                            mergedCnt[i] += c;
                        }
                    }
                    for (let i = 0; i < pixels; i++) {
                        const c = mergedCnt[i] > 0 ? mergedCnt[i] : 1;
                        merged[i] /= c;
                        mergedEx[i] /= c;
                    }

                    // Visualisation paths still use only the latest worker's
                    // sample (clipping by the sample plane below).  Across N
                    // workers we'd grow the path reservoir N×; capping at the
                    // global limit (500) keeps memory bounded.
                    const hydrated = msg.paths.map(rehydratePath);
                    const sampleComp = currentComponents.find(c => c instanceof Sample) as Sample | undefined;
                    const clipped: Ray[][] = hydrated.map(path => {
                        if (!sampleComp || path.length === 0) return path;
                        const sp = sampleComp.position;
                        for (let i = 0; i < path.length; i++) {
                            const r = path[i];
                            const dx = sp.x - r.origin.x;
                            const dy = sp.y - r.origin.y;
                            const dz = sp.z - r.origin.z;
                            const tProj = dx * r.direction.x + dy * r.direction.y + dz * r.direction.z;
                            if (tProj < -0.001) return path.slice(0, i);
                            const rayDist = r.interactionDistance ?? Infinity;
                            if (tProj <= rayDist) {
                                const clippedRay = { ...r, interactionDistance: tProj };
                                return [...path.slice(0, i), clippedRay];
                            }
                        }
                        return path;
                    }).filter(path => path.length > 0);
                    camera.solver3Image = merged;
                    camera.forwardImage = mergedEx;
                    const visiblePaths = clipped.length > 0 ? clipped : (camera.solver3Paths ?? []);
                    camera.solver3Paths = visiblePaths;
                    camera.solver3Stale = false;
                    camera.version++;
                    setCameraImageTick(t => t + 1);

                    if (clipped.length > 0) {
                        const currentPaths = solver3PathsRef.current || [];
                        const nextPaths = [...currentPaths, ...clipped];
                        if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                        setSolver3Paths(nextPaths);
                        solver3PathsRef.current = nextPaths;
                    }
                } else if (msg.type === 'pmt-done') {
                    if (w !== 0) return; // PMTs only need to run once.
                    const hydrated = msg.paths.map(rehydratePath);
                    const currentPaths = solver3PathsRef.current || [];
                    const nextPaths = [...currentPaths, ...hydrated];
                    if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                    setSolver3Paths(nextPaths);
                    solver3PathsRef.current = nextPaths;
                } else if (msg.type === 'complete') {
                    workerCompleteRef.current.add(w);
                    workerRayCountsRef.current[w] = msg.raysTraced;
                    if (workerCompleteRef.current.size >= SOLVER3_WORKER_COUNT) {
                        setScanAccumProgress(1);
                        setSolver3Rendering(false);
                        if (workerErrorRef.current) haptic.error();
                        else haptic.done();
                    }
                } else if (msg.type === 'error') {
                    console.warn(`[Solver3 worker ${w}] `, msg.message);
                    workerErrorRef.current = true;
                    workerCompleteRef.current.add(w);
                    workerRayCountsRef.current[w] = 0;
                    if (workerCompleteRef.current.size >= SOLVER3_WORKER_COUNT) {
                        setSolver3Rendering(false);
                        setScanAccumProgress(0);
                        haptic.error();
                    }
                }
            };
            worker.addEventListener('message', onMessage);
        }
        solver3WorkersRef.current = workers;
        return () => {
            for (const w of workers) w.terminate();
            solver3WorkersRef.current = [];
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (solver3Trigger === 0) return; // Skip initial mount
        if (!components) return;
        const workers = solver3WorkersRef.current;
        if (workers.length === 0) return;

        const cameras = components.filter(c => c instanceof Camera) as Camera[];
        if (cameras.length === 0) return;

        // Cancel any in-flight job on every worker, then assign a fresh id.
        const previousId = solver3JobIdRef.current;
        if (previousId > 0) {
            for (const w of workers) {
                w.postMessage({ type: 'cancel', jobId: previousId } as MainToWorker);
            }
        }
        const newJobId = previousId + 1;
        solver3JobIdRef.current = newJobId;

        // Reset per-worker accumulator state for the new job.
        workerAccumRef.current.clear();
        workerCompleteRef.current.clear();
        workerRayCountsRef.current = new Array(workers.length).fill(0);
        workerErrorRef.current = false;

        setSolver3Rendering(true);
        setScanAccumProgress(0);

        const sceneText = serializeScene(components);
        for (let w = 0; w < workers.length; w++) {
            const request: MainToWorker = {
                type: 'render',
                jobId: newJobId,
                sceneText,
                cameraIds: cameras.map(c => c.id),
                pmtIds: [],
                reversePathCount: clampedReversePathCount,
                forwardRayCount: clampedForwardRayCount,
                solver2Enabled: rayConfig.solver2Enabled,
                previewMode: isDragging,
                workerId: w,
                workerCount: workers.length,
            };
            workers[w].postMessage(request);
        }

        return () => {
            for (const w of workers) {
                w.postMessage({ type: 'cancel', jobId: newJobId } as MainToWorker);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [solver3Trigger]);

    // Re-render whenever drag state flips (drag start → preview mode, drag end → full quality).
    const lastDragRef = useRef(isDragging);
    useEffect(() => {
        if (lastDragRef.current === isDragging) return;
        lastDragRef.current = isDragging;
        setSolver3Trigger(t => t + 1);
    }, [isDragging, setSolver3Trigger]);

    // ─── Effect 1b': rod-count sliders (forward or reverse) also kick a fresh reverse trace ───
    const reverseCountRef = useRef(clampedReversePathCount);
    const forwardCountRef = useRef(clampedForwardRayCount);
    useEffect(() => {
        const reverseChanged = reverseCountRef.current !== clampedReversePathCount;
        const forwardChanged = forwardCountRef.current !== clampedForwardRayCount;
        if (!reverseChanged && !forwardChanged) return;
        reverseCountRef.current = clampedReversePathCount;
        forwardCountRef.current = clampedForwardRayCount;
        // Mark camera images stale so the UI shows "Updating…" while a new trace runs.
        for (const comp of components) {
            if (comp instanceof Camera) comp.markSolver3Stale();
        }
        setSolver3Trigger(t => t + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clampedReversePathCount, clampedForwardRayCount]);

    // ─── Effect 1b'': re-kick Solver-3 when the page comes back to the
    // foreground.  Mobile browsers (especially iOS Safari) suspend Web
    // Workers when the screen locks, the user app-switches, or the device
    // gets warm.  When the user returns, the worker may have been killed or
    // its event loop frozen — its `for (round = 0; ;)` infinite-progressive
    // loop never resumes posting `camera-done` and the image looks stuck.
    // A trigger bump here forces a fresh job, which spawns a fresh worker if
    // the old one is gone.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            // Only re-kick if there is at least one Camera in the scene; PMTs
            // have their own raster effect that re-runs on its own triggers.
            const hasCamera = components.some(c => c instanceof Camera);
            if (!hasCamera) return;
            for (const comp of components) {
                if (comp instanceof Camera) comp.markSolver3Stale();
            }
            setSolver3Trigger(t => t + 1);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [components, setSolver3Trigger]);

    // ─── Effect 1c: Scan Accumulation — batch Solver 3 across scan cycle ───
    const [, setAnimPlaying] = useAtom(animationPlayingAtom);

    useEffect(() => {
        if (scanAccumConfig.trigger === 0) return; // Skip initial mount
        if (!components) return;
        if (solver3Rendering) return; // Guard against concurrent triggers

        const camera = components.find(c => c instanceof Camera) as Camera | undefined;
        if (!camera) return;
        if (animator.channels.length === 0) return;

        // Gather all animation channels and their targets
        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);

        const activeChannels = animator.channels.filter(ch => {
            return byId.has(ch.targetId);
        });
        if (activeChannels.length === 0) return;

        const steps = scanAccumConfig.steps;
        const pixelCount = camera.sensorResX * camera.sensorResY;

        // Save the original property values for all animated channels
        const savedValues = captureAnimatedValues(activeChannels, byId);

        console.log(`[ScanAccum] Starting ${steps}-step sweep (${activeChannels.length} channels, from→to linear)`);

        const job = createScheduledRenderJob({
            animator,
            savedValues,
            scanAccumActiveRef,
            animStateRef,
            setAnimPlaying,
            setSolver3Rendering,
            setProgress: setScanAccumProgress,
        });

        // Clear previous scan frames and prepare fresh storage
        camera.clearScanFrames();
        const frameEmissions: Float32Array[] = [];
        const frameExcitations: Float32Array[] = [];
        const accumulatedEmission = new Float32Array(pixelCount);
        const accumulatedExcitation = new Float32Array(pixelCount);
        let lastPaths: Ray[][] = [];

        const runStep = (step: number) => {
            if (job.isCancelled()) return;

            if (step >= steps) {
                // All steps done — normalize the accumulated average
                const N = steps;
                for (let i = 0; i < pixelCount; i++) {
                    accumulatedEmission[i] /= N;
                    accumulatedExcitation[i] /= N;
                }

                let totalEmission = 0, totalExcitation = 0;
                for (let i = 0; i < pixelCount; i++) totalEmission += accumulatedEmission[i];
                for (let i = 0; i < pixelCount; i++) totalExcitation += accumulatedExcitation[i];
                console.log(`[ScanAccum] Done. ${steps} frames stored. Total emission: ${totalEmission.toFixed(6)}, excitation: ${totalExcitation.toFixed(6)}`);

                // Store per-frame images for scrubbing
                camera.scanFrames = frameEmissions;
                camera.scanExFrames = frameExcitations;
                camera.scanFrameCount = steps;

                // Store averaged image as the default display
                camera.solver3Image = accumulatedEmission;
                camera.forwardImage = accumulatedExcitation;
                camera.solver3Paths = lastPaths;
                camera.solver3Stale = false;

                // Snapshot component versions for smart invalidation
                camera.scanVersionSnapshot = new Map(components.map(c => [c.id, c.version]));

                // Restore properties to original state (so rays stay put)
                setSolver3Paths(lastPaths);
                solver3PathsRef.current = lastPaths;
                job.finish(1);
                return;
            }

            // Evaluation: jump to discrete time points within the animation range.
            // This ensures we capture a single sweep from Point A to Point B.
            const fraction = steps > 1 ? step / (steps - 1) : 0.5;
            animator.evaluateLinearRange(fraction, components);

            try {
                // ── Solver 1: Forward trace ──
                const beamSegs = traceCenterBeamSegments();

                // ── Solver 3: Backward render ──
                const solver3 = new Solver3(components, beamSegs);
                const result = solver3.render(camera, 8);

                if (step === 0 || step === steps - 1) {
                    let stepEmission = 0;
                    for (let i = 0; i < result.emissionImage.length; i++) stepEmission += result.emissionImage[i];
                    console.log(`[ScanAccum] Step ${step}/${steps}: frac=${fraction.toFixed(3)}, beamSegs=${beamSegs.length}, paths=${result.paths.length}, emission=${stepEmission.toFixed(6)}`);
                }

                // Store this frame's individual images
                const frameEm = new Float32Array(pixelCount);
                const frameEx = new Float32Array(pixelCount);
                frameEm.set(result.emissionImage.subarray(0, pixelCount));
                if (result.excitationImage.length >= pixelCount) {
                    frameEx.set(result.excitationImage.subarray(0, pixelCount));
                }
                frameEmissions.push(frameEm);
                frameExcitations.push(frameEx);

                // Accumulate for the averaged display
                for (let i = 0; i < pixelCount; i++) {
                    accumulatedEmission[i] += result.emissionImage[i];
                }
                for (let i = 0; i < result.excitationImage.length && i < pixelCount; i++) {
                    accumulatedExcitation[i] += result.excitationImage[i];
                }
                lastPaths = result.paths;
            } catch (e) {
                console.warn(`Scan accum step ${step} error:`, e);
                frameEmissions.push(new Float32Array(pixelCount));
                frameExcitations.push(new Float32Array(pixelCount));
            }

            // Restore properties before yielding — keeps rays stable on the optical table
            job.restoreProperties();

            setScanAccumProgress((step + 1) / steps);

            // Schedule next step (yield to UI for progress update)
            job.schedule(() => runStep(step + 1), 0);
        };

        // Start step 0 after a brief delay (let UI update)
        job.schedule(() => runStep(0), 50);

        return () => { job.cancel(0); };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanAccumConfig.trigger]);

    const pmtRasterRequestKey = useMemo(() => {
        if (!components) return '';
        const plans = resolvePMTRasterPlans(components, animator.channels);
        if (plans.length === 0) return '';
        return plans.map(({ pmt, xCh, yCh }) => [
            pmt.id,
            pmt.xAxisComponentId,
            pmt.xAxisProperty,
            pmt.yAxisComponentId,
            pmt.yAxisProperty,
            pmt.scanResX,
            pmt.scanResY,
            pmt.samplesPerPixel,
            pmt.sensorNA,
            xCh.targetId,
            xCh.property,
            xCh.from,
            xCh.to,
            yCh.targetId,
            yCh.property,
            yCh.from,
            yCh.to,
            clampedForwardRayCount,
            clampedReversePathCount,
            opticsFingerprint,
        ].join('|')).join('||');
    }, [components, animator.channels, clampedForwardRayCount, clampedReversePathCount, opticsFingerprint]);

    // ─── Effect 1d: PMT Raster Scan ───────────────────────────────────────
    useEffect(() => {
        if (!pmtRasterRequestKey) return;
        if (!components) return;

        const plans = resolvePMTRasterPlans(components, animator.channels);
        if (plans.length === 0) return;

        let cancelled = false;
        const timeoutIds: number[] = [];
        const ownsRenderingState = !components.some(c => c instanceof Camera);
        const workerCount = SOLVER3_WORKER_COUNT;
        const rasterWorkers: Worker[] = [];
        const serializableComponents = components.filter(c =>
            !c.isSubComponent || (c instanceof TrappedBead && Boolean(c.parentSampleId))
        );
        const sceneText = serializeScene(serializableComponents);
        const jobId = Math.floor(performance.now() * 1000);
        const totalFirstFramePixels = plans.reduce((sum, { pmt }) => sum + pmt.scanResX * pmt.scanResY, 0);
        let firstFramePixelsDone = 0;
        let firstFrameDone = false;
        let completionHapticSent = false;
        let passIndex = 0;
        let passMessagesDone = 0;
        let passPaths: Ray[][] = [];

        type RasterState = {
            pmt: PMT;
            resX: number;
            resY: number;
            accumulatedEmission: Float64Array;
            accumulatedExcitation: Float64Array;
            sampleCounts: Uint32Array;
            displayEmission: Float32Array;
            displayExcitation: Float32Array;
        };
        const rasterStates = new Map<string, RasterState>();

        const schedule = (callback: () => void, delay: number) => {
            const id = window.setTimeout(() => {
                const idx = timeoutIds.indexOf(id);
                if (idx >= 0) timeoutIds.splice(idx, 1);
                callback();
            }, delay);
            timeoutIds.push(id);
        };

        if (ownsRenderingState) {
            setSolver3Rendering(true);
            setScanAccumProgress(0);
        }

        for (const plan of plans) {
            const { pmt } = plan;
            const resX = pmt.scanResX;
            const resY = pmt.scanResY;
            const totalPixels = resX * resY;
            console.log(`[PMT Raster] Starting worker-striped continuous ${resX}×${resY} raster accumulation for ${pmt.name} (${totalPixels} pixels/frame, ${workerCount} workers)`);

            pmt.clearScan();
            rasterStates.set(pmt.id, {
                pmt,
                resX,
                resY,
                accumulatedEmission: new Float64Array(totalPixels),
                accumulatedExcitation: new Float64Array(totalPixels),
                sampleCounts: new Uint32Array(totalPixels),
                displayEmission: new Float32Array(totalPixels),
                displayExcitation: new Float32Array(totalPixels),
            });
        }

        const publishImages = () => {
            for (const state of rasterStates.values()) {
                state.pmt.scanImage = state.displayEmission;
                state.pmt.scanExcitationImage = state.displayExcitation;
                state.pmt.scanStale = false;
                state.pmt.scanVersionSnapshot = new Map(components.map(c => [c.id, c.version]));
            }
            setCameraImageTick(t => t + 1);
        };

        const finishFirstFrame = () => {
            if (firstFrameDone) return;
            firstFrameDone = true;
            console.log('[PMT Raster] First worker-striped frame complete. Continuing accumulation.');
            if (ownsRenderingState) {
                setSolver3Rendering(false);
                setScanAccumProgress(1);
            }
            if (!completionHapticSent) {
                completionHapticSent = true;
                haptic.done();
            }
        };

        const startPass = () => {
            if (cancelled) return;
            passMessagesDone = 0;
            passPaths = [];
            const samplesPerPixel = passIndex === 0
                ? 1
                : Math.max(1, Math.min(clampedReversePathCount, 4));
            const requestPlans = plans.map(({ pmt, xCh, yCh }) => ({
                pmtId: pmt.id,
                xTargetId: xCh.targetId,
                xProperty: xCh.property,
                xFrom: xCh.from,
                xTo: xCh.to,
                yTargetId: yCh.targetId,
                yProperty: yCh.property,
                yFrom: yCh.from,
                yTo: yCh.to,
                resX: pmt.scanResX,
                resY: pmt.scanResY,
                samplesPerPixel,
            }));

            for (let w = 0; w < workerCount; w++) {
                rasterWorkers[w].postMessage({
                    type: 'pmt-raster',
                    jobId,
                    sceneText,
                    plans: requestPlans,
                    forwardRayCount: clampedForwardRayCount,
                    reversePathCount: clampedReversePathCount,
                    workerId: w,
                    workerCount,
                    passIndex,
                } satisfies MainToWorker);
            }
        };

        for (let w = 0; w < workerCount; w++) {
            const worker = new Worker(new URL('../physics/solver3Worker.ts', import.meta.url), { type: 'module' });
            rasterWorkers.push(worker);
            worker.addEventListener('message', (e: MessageEvent<WorkerToMain>) => {
                const msg = e.data;
                if (cancelled || msg.jobId !== jobId) return;
                if (msg.type === 'error') {
                    console.warn(`[PMT raster worker ${w}]`, msg.message);
                    cancelled = true;
                    for (const id of timeoutIds.splice(0)) window.clearTimeout(id);
                    for (const rasterWorker of rasterWorkers) {
                        rasterWorker.postMessage({ type: 'cancel', jobId } satisfies MainToWorker);
                        rasterWorker.terminate();
                    }
                    if (ownsRenderingState) {
                        setSolver3Rendering(false);
                        setScanAccumProgress(firstFrameDone ? 1 : 0);
                    }
                    haptic.error();
                    return;
                }
                if (msg.type !== 'pmt-raster-done') return;

                const state = rasterStates.get(msg.pmtId);
                if (!state) return;
                const pixels = state.resX * state.resY;
                for (let i = 0; i < pixels; i++) {
                    const c = msg.sampleCountsImage[i];
                    if (c === 0) continue;
                    state.accumulatedEmission[i] += msg.emissionImage[i];
                    state.accumulatedExcitation[i] += msg.excitationImage[i];
                    state.sampleCounts[i] += c;
                    state.displayEmission[i] = state.accumulatedEmission[i] / state.sampleCounts[i];
                    state.displayExcitation[i] = state.accumulatedExcitation[i] / state.sampleCounts[i];
                }

                if (!firstFrameDone && ownsRenderingState) {
                    firstFramePixelsDone += msg.pixelsTraced;
                    setScanAccumProgress(Math.max(0, Math.min(1, firstFramePixelsDone / Math.max(1, totalFirstFramePixels))));
                }

                for (const serializedPath of msg.paths) {
                    if (passPaths.length >= clampedReversePathCount) break;
                    passPaths.push(rehydratePath(serializedPath));
                }

                passMessagesDone++;
                if (passMessagesDone >= workerCount * plans.length) {
                    publishImages();
                    if (passPaths.length > 0) {
                        const nextPaths = [...passPaths];
                        if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                        setSolver3Paths(nextPaths);
                        solver3PathsRef.current = nextPaths;
                    }
                    if (passIndex === 0) finishFirstFrame();
                    passIndex++;
                    schedule(startPass, 0);
                }
            });
        }

        schedule(startPass, 50);

        return () => {
            cancelled = true;
            for (const id of timeoutIds) window.clearTimeout(id);
            for (const worker of rasterWorkers) {
                worker.postMessage({ type: 'cancel', jobId } satisfies MainToWorker);
                worker.terminate();
            }
            if (ownsRenderingState) {
                setSolver3Rendering(false);
                setScanAccumProgress(firstFrameDone ? 1 : 0);
            }
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pmtRasterRequestKey, scanAccumConfig.trigger]);

    // ─── Effect 2: Cheap card beam profile sampling ───
    // Runs whenever ANY component changes (including card drags).
    // Uses cached solver results — no physics re-computation.
    useEffect(() => {
        if (!components) return;

        const beamSegs = beamSegsRef.current;
        const solverPaths = solverPathsRef.current;
        const s3Paths = solver3PathsRef.current;

        // Combine forward and reverse ray paths for card intersection
        const allPaths = s3Paths.length > 0 ? [...solverPaths, ...s3Paths] : solverPaths;

        const cardComps = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardComps) {
            card.beamProfiles = [];

            const invQ = card.rotation.clone().conjugate();

            const hitRays: { ray: Ray; hitLocalPoint: Vector3; t: number }[] = [];

            for (const path of allPaths) {
                for (const ray of path) {
                    if (!ray.isMainRay && !ray.sourceId?.startsWith('solver3_')) continue;


                    const localOrigin = ray.origin.clone().sub(card.position).applyQuaternion(invQ);
                    const localDir = ray.direction.clone().applyQuaternion(invQ);


                    if (Math.abs(localDir.z) < 1e-6) continue;
                    const t = -localOrigin.z / localDir.z;
                    if (t < 0.001) continue;


                    if (ray.interactionDistance !== undefined && t > ray.interactionDistance + 0.1) continue;

                    const hitPt = localOrigin.clone().add(localDir.clone().multiplyScalar(t));


                    if (Math.abs(hitPt.x) <= card.width / 2 && Math.abs(hitPt.y) <= card.height / 2) {
                        hitRays.push({ ray, hitLocalPoint: hitPt, t });
                    }
                }
            }

            if (hitRays.length === 0) continue;

            const fallbackHits: { ray: Ray; hitLocalPoint: Vector3 }[] = [];

            for (const { ray: mainHitRay, hitLocalPoint } of hitRays) {
                // Skip beam-envelope matching if no beam segments available
                if (beamSegs.length === 0) {
                    fallbackHits.push({ ray: mainHitRay, hitLocalPoint });
                    continue;
                }
                let bestSeg: GaussianBeamSegment | null = null;
                let bestDist = Infinity;
                let bestZ = 0;

                const worldHitPt = hitLocalPoint.clone().applyQuaternion(card.rotation).add(card.position);


                for (const branch of beamSegs) {
                    for (const seg of branch) {
                        const toHit = worldHitPt.clone().sub(seg.start);
                        const segLen = seg.start.distanceTo(seg.end);
                        const proj = toHit.dot(seg.direction);

                        if (proj >= -1 && proj <= segLen + 1) {
                            const along = seg.direction.clone().multiplyScalar(proj);
                            const perpDist = toHit.clone().sub(along).length();


                            const dirDot = Math.abs(seg.direction.dot(mainHitRay.direction.clone().normalize()));
                            if (dirDot < 0.5) continue; // Wrong beam branch

                            if (perpDist < bestDist) {
                                bestDist = perpDist;
                                bestSeg = seg;
                                bestZ = Math.max(0, Math.min(proj, segLen));
                            }
                        }
                    }
                }

                if (!bestSeg || bestDist >= 50) {
                    // Collect for merging below (common for Solver 3 backward-traced rays)
                    fallbackHits.push({ ray: mainHitRay, hitLocalPoint });
                    continue;
                }

                const { wx: beamWx, wy: beamWy } = segmentBeamRadii(bestSeg, bestZ);


                const beamDir = bestSeg.direction.clone().normalize();
                const worldZ = new Vector3(0, 0, 1);
                let beamU = new Vector3().crossVectors(beamDir, worldZ);
                if (beamU.length() < 0.01) {
                    beamU = new Vector3().crossVectors(beamDir, new Vector3(1, 0, 0));
                }
                beamU.normalize();
                const beamV = new Vector3().crossVectors(beamU, beamDir).normalize();

                const cardLocalX = new Vector3(1, 0, 0).applyQuaternion(card.rotation);
                const cardLocalY = new Vector3(0, 1, 0).applyQuaternion(card.rotation);

                const ux = beamU.dot(cardLocalX);
                const vx = beamV.dot(cardLocalX);
                const uy = beamU.dot(cardLocalY);
                const vy = beamV.dot(cardLocalY);

                const wx = Math.sqrt(ux * ux * beamWx * beamWx + vx * vx * beamWy * beamWy);
                const wy = Math.sqrt(uy * uy * beamWx * beamWx + vy * vy * beamWy * beamWy);

                const pol = mainHitRay.polarization;
                const phase = mainHitRay.opticalPathLength ?? 0;

                // Compute beam tilt in card's local frame
                // localDir.u / localDir.w and localDir.v / localDir.w give the tangent of the
                // incidence angle in each transverse direction  (≈ sin θ for small angles)
                const localDir2 = mainHitRay.direction.clone().applyQuaternion(invQ);
                const tiltU = Math.abs(localDir2.z) > 1e-6 ? localDir2.x / Math.abs(localDir2.z) : 0;
                const tiltV = Math.abs(localDir2.z) > 1e-6 ? localDir2.y / Math.abs(localDir2.z) : 0;

                card.beamProfiles.push({
                    wx, wy,
                    wavelength: bestSeg.wavelength,
                    power: bestSeg.power,
                    polarization: pol,
                    phase,
                    centerU: hitLocalPoint.x,
                    centerV: hitLocalPoint.y,
                    tiltU,
                    tiltV
                });
            }

            // Compute fluorescence emission power reference:
            // total excitation power at the sample × fluorescence efficiency
            const sample = components.find(c => c instanceof Sample) as Sample | undefined;
            let emissionPower = 0;
            if (sample && beamSegs.length > 0) {
                let totalLaserPower = 0;
                for (const branch of beamSegs) {
                    if (branch.length > 0) totalLaserPower += branch[0].power;
                }
                emissionPower = totalLaserPower * sample.fluorescenceEfficiency;
            }
            card.emissionPowerRef = emissionPower;

            // Merge fallback hits (Solver 3 backward rays) into ONE averaged profile
            if (fallbackHits.length > 0) {
                const n = fallbackHits.length;
                let meanU = 0, meanV = 0, meanPhase = 0;
                let polXre = 0, polXim = 0, polYre = 0, polYim = 0;
                const wavelength = fallbackHits[0].ray.wavelength;

                for (const { ray, hitLocalPoint: hp } of fallbackHits) {
                    meanU += hp.x;
                    meanV += hp.y;
                    meanPhase += ray.opticalPathLength ?? 0;
                    polXre += ray.polarization.x.re;
                    polXim += ray.polarization.x.im;
                    polYre += ray.polarization.y.re;
                    polYim += ray.polarization.y.im;
                }
                meanU /= n;
                meanV /= n;
                meanPhase /= n;

                // RMS spread of hit positions → beam width
                let varU = 0, varV = 0;
                for (const { hitLocalPoint: hp } of fallbackHits) {
                    varU += (hp.x - meanU) ** 2;
                    varV += (hp.y - meanV) ** 2;
                }
                const rmsU = Math.sqrt(varU / n);
                const rmsV = Math.sqrt(varV / n);
                // Use RMS spread, with a minimum of 0.5mm so single rays still render
                const wx = Math.max(rmsU, 0.5);
                const wy = Math.max(rmsV, 0.5);

                // Average direction for tilt
                const avgDir = fallbackHits[0].ray.direction.clone();
                for (let i = 1; i < n; i++) avgDir.add(fallbackHits[i].ray.direction);
                avgDir.normalize();
                const localDir2 = avgDir.applyQuaternion(invQ);
                const tiltU = Math.abs(localDir2.z) > 1e-6 ? localDir2.x / Math.abs(localDir2.z) : 0;
                const tiltV = Math.abs(localDir2.z) > 1e-6 ? localDir2.y / Math.abs(localDir2.z) : 0;

                // Normalize polarization vector
                const polMag = Math.sqrt(polXre**2 + polXim**2 + polYre**2 + polYim**2) || 1;

                // Average throughput of backward rays × fluorescence emission power
                let avgThroughput = 0;
                for (const { ray } of fallbackHits) avgThroughput += (ray.intensity ?? 0);
                avgThroughput /= n;
                const power = emissionPower > 0 ? emissionPower * avgThroughput : 0.001;

                card.beamProfiles.push({
                    wx, wy,
                    wavelength,
                    power,
                    polarization: {
                        x: { re: polXre / polMag, im: polXim / polMag },
                        y: { re: polYre / polMag, im: polYim / polMag }
                    },
                    phase: meanPhase,
                    centerU: meanU,
                    centerV: meanV,
                    tiltU,
                    tiltV
                });
            }
        }

    }, [components, rayConfig, solver3Paths]);

    return (
        <group>
            {/* Beams render at z=0 (default), components at z=2.
                In the top-down view the Z offset is invisible, but the depth buffer
                ensures components appear in front of beam lines. */}
            <RayVisualizer
                paths={rays}
                glowEnabled={rayConfig.solver2Enabled}
                hideAll={rayConfig.solver2Enabled && rayConfig.viewerMode === 'wave'}
                minOpacity={rayConfig.minRayOpacity}
                maxOpacity={rayConfig.maxRayOpacity}
            />
            {solver3Paths.length > 0 && (
                <RayVisualizer
                    paths={solver3Paths}
                    glowEnabled={false}
                    noBloom={true}
                    hideAll={rayConfig.solver2Enabled && rayConfig.viewerMode === 'wave'}
                    minOpacity={rayConfig.minRayOpacity}
                    maxOpacity={rayConfig.maxRayOpacity}
                />
            )}
            {rayConfig.solver2Enabled && rayConfig.viewerMode === 'wave' && (
                <BundleWaveVisualizer beamSegments={beamSegments} reversePaths={solver3Paths} />
            )}

            <TutorialOverlay />

            <group>
                {components.map(c => {
                    const visual = getComponentVisualizer(c);

                    if (visual) {
                        // Outline color: black for components on the active Z level,
                        // grey for components on other levels.
                        const cz = Math.round(c.position.z * 10) / 10;
                        const onActiveLevel = (c instanceof DualGalvoScanHead)
                            ? (cz === activeZ || Math.round((c.position.z + c.mirrorSpacing) * 10) / 10 === activeZ)
                            : cz === activeZ;
                        const outlineColor = onActiveLevel ? '#000000' : '#888888';

                        return (
                            <group key={c.id}>
                                <OutlineColorContext.Provider value={outlineColor}>
                                    <Draggable component={c}>
                                        {visual}
                                    </Draggable>
                                </OutlineColorContext.Provider>
                            </group>
                        );
                    }
                    return null;
                })}
            </group>
        </group>
    );
};
