import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useAtom } from 'jotai';
import { componentsAtom, rayConfigAtom, solver3RenderTriggerAtom, solver3RenderingAtom, animatorAtom, animationPlayingAtom, animationSpeedAtom, scanAccumTriggerAtom, scanAccumProgressAtom } from '../state/store';
import { setProperty, getProperty } from '../physics/PropertyAnimator';
import { useFrame } from '@react-three/fiber';

import { Ray, Coherence } from '../physics/types';
import { OpticalComponent } from '../physics/Component';
import { Solver1 } from '../physics/Solver1';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Sample } from '../physics/components/Sample';
import { Objective } from '../physics/components/Objective';
import { ObjectiveCasing } from '../physics/components/ObjectiveCasing';
import { IdealLens } from '../physics/components/IdealLens';
import { Camera } from '../physics/components/Camera';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { SampleChamber } from '../physics/components/SampleChamber';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { PMT } from '../physics/components/PMT';

import { RayVisualizer } from './RayVisualizer';

import { EFieldVisualizer } from './EFieldVisualizer';
import { Solver2, GaussianBeamSegment } from '../physics/Solver2';
import { Solver3 } from '../physics/Solver3';
import { createSourceRays } from '../physics/SourceRayFactory';
import { Draggable } from './Draggable';
// ─── Visualizers (extracted) ─────────────────────────────────────────
import {
    CasingVisualizer,
    SampleVisualizer,
    ObjectiveVisualizer,
    CameraVisualizer,
    PMTVisualizer,
    MirrorVisualizer,
    PolygonScannerVisualizer,
    CurvedMirrorVisualizer,
    BeamSplitterVisualizer,
    ApertureVisualizer,
    SlitApertureVisualizer,
    FilterVisualizer,
    DichroicVisualizer,
    BlockerVisualizer,
    SampleChamberVisualizer,
    WaveplateVisualizer,
    CardVisualizer,
    LensVisualizer,
    SourceVisualizer,
    LampVisualizer,
    IdealLensVisualizer,
    CylindricalLensVisualizer,
    PrismVisualizer,
} from './visualizers/ComponentVisualizers';


export const OpticalTable: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [rayConfig] = useAtom(rayConfigAtom);
    const [rays, setRays] = useState<Ray[][]>([]);
    const [beamSegments, setBeamSegments] = useState<GaussianBeamSegment[][]>([]);
    const [solver3Paths, setSolver3Paths] = useState<Ray[][]>([]);
    const [solver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [, setSolver3Rendering] = useAtom(solver3RenderingAtom);

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

    // ─── Optics fingerprint: changes only when non-Card components change ───
    // Cards are passive detectors and don't affect the optical path, so moving
    // them should NOT trigger the expensive Solver1/Solver2 re-computation.
    // Uses component.version which is bumped on every property mutation.
    const opticsFingerprint = useMemo(() => {
        if (!components) return '';
        return components
            .filter(c => !(c instanceof Card))
            .map(c => `${c.id}:${c.position.x},${c.position.y},${c.position.z}:${c.rotation.x},${c.rotation.y},${c.rotation.z},${c.rotation.w}:v${c.version}`)
            .join('|');
    }, [components, animTick]);

    // Refs to hold expensive solver results for card sampling effect
    const solverPathsRef = useRef<Ray[][]>([]);
    const beamSegsRef = useRef<GaussianBeamSegment[][]>([]);
    const solver3PathsRef = useRef<Ray[][]>([]);

    useEffect(() => {
        if (!components) return;
        if (scanAccumActiveRef.current) return; // Skip during scan accumulation


        const cardsToReset = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardsToReset) {
            card.hits = [];
        }

        const solver = new Solver1(components);
        const sourceRays = createSourceRays(components, rayConfig.rayCount, 'full');

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
        solverPathsRef.current = calculatedPaths;

        let beamSegs: GaussianBeamSegment[][] = [];
        if (rayConfig.solver2Enabled) {
            try {
                const solver2 = new Solver2();
                beamSegs = solver2.propagate(calculatedPaths, components);
            } catch (e) {
                console.warn('Solver 2 error:', e);
            }
        }
        setBeamSegments(beamSegs);
        beamSegsRef.current = beamSegs;


        for (const comp of components) {
            if (comp instanceof Camera) {
                comp.markSolver3Stale();
            }
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
        const hasAnyScanResults = components.some(c => c instanceof Camera && (c as Camera).scanFrames)
            || components.some(c => c instanceof PMT && (c as PMT).scanImage);
        if (shouldClearScan || !hasAnyScanResults) {
            setSolver3Paths([]);
            solver3PathsRef.current = [];
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opticsFingerprint, rayConfig]);

    // ─── Effect 1b: Solver 3 — backward trace from ALL detectors (on-demand) ───
    useEffect(() => {
        if (solver3Trigger === 0) return; // Skip initial mount
        if (!components) return;

        const cameras = components.filter(c => c instanceof Camera) as Camera[];
        const pmts = components.filter(c => c instanceof PMT && (c as PMT).hasValidAxes()) as PMT[];
        if (cameras.length === 0 && pmts.length === 0) return;

        const beamSegs = beamSegsRef.current;
        setSolver3Rendering(true);

        // Use requestAnimationFrame-driven generator for non-blocking rendering.
        // Each animation frame processes rows for up to ~16ms, then yields to the browser.
        let cancelled = false;

        const runAsync = () => {
            try {
                const solver3 = new Solver3(components, beamSegs);
                const allPaths: Ray[][] = [];

                // Build a list of camera generators to process sequentially
                const cameraGens = cameras.map(cam => ({
                    camera: cam,
                    gen: solver3.renderGenerator(cam, rayConfig.rayCount),
                }));

                let camIdx = 0;

                const step = () => {
                    if (cancelled) { setSolver3Rendering(false); return; }

                    const frameStart = performance.now();
                    // Process rows for up to 16ms per animation frame
                    while (camIdx < cameraGens.length && performance.now() - frameStart < 16) {
                        const { camera, gen } = cameraGens[camIdx];
                        const { value, done } = gen.next();
                        if (done) {
                            // Generator returned the final Solver3Result
                            const result = value as import('../physics/Solver3').Solver3Result;
                            camera.solver3Image = result.emissionImage;
                            camera.forwardImage = result.excitationImage;
                            camera.solver3Paths = result.paths;
                            camera.solver3Stale = false;
                            allPaths.push(...result.paths);
                            camIdx++;
                        }
                        // If not done, the generator yielded a progress update — continue in this frame
                    }

                    if (camIdx < cameraGens.length) {
                        // More cameras to process — schedule next frame
                        requestAnimationFrame(step);
                        return;
                    }

                    // All cameras done — now handle PMTs (synchronous, they're fast)
                    if (pmts.length > 0) {
                        const sample = components.find(c => c instanceof Sample) as Sample | undefined;
                        const emissionWavelength = sample ? sample.getEmissionWavelength() * 1e-9 : 532e-9;

                        for (const pmt of pmts) {
                            pmt.updateMatrices();
                            const pmtPos = pmt.position.clone();
                            const pmtW = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
                            const pmtU = new Vector3(1, 0, 0).applyQuaternion(pmt.rotation).normalize();
                            const pmtV = new Vector3(0, 1, 0).applyQuaternion(pmt.rotation).normalize();

                            const numRays = Math.min(rayConfig.rayCount, 32);
                            const sinThetaMax = 0.3;

                            for (let i = 0; i < numRays; i++) {
                                const phi = Math.random() * 2 * Math.PI;
                                const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                                const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

                                const dir = pmtW.clone().multiplyScalar(cosTheta)
                                    .add(pmtU.clone().multiplyScalar(sinTheta * Math.cos(phi)))
                                    .add(pmtV.clone().multiplyScalar(sinTheta * Math.sin(phi)))
                                    .normalize();

                                const polAngle = Math.random() * Math.PI;
                                const backwardRay: Ray = {
                                    origin: pmtPos.clone(),
                                    direction: dir,
                                    wavelength: emissionWavelength,
                                    intensity: 1.0,
                                    polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } },
                                    opticalPathLength: 0,
                                    footprintRadius: 0.1,
                                    coherenceMode: Coherence.Incoherent,
                                    sourceId: `pmt_backward_${pmt.id}_${i}`,
                                };

                                const result = solver3.traceBackward(backwardRay, sample);
                                if (result.path.length > 1) {
                                    allPaths.push(result.path);
                                }
                            }
                        }
                    }

                    console.log(`[Solver3] Backward traced ${cameras.length} cameras + ${pmts.length} PMTs → ${allPaths.length} paths`);
                    setSolver3Paths(allPaths);
                    solver3PathsRef.current = allPaths;
                    setSolver3Rendering(false);
                };

                requestAnimationFrame(step);
            } catch (e) {
                console.warn('Solver 3 error:', e);
                setSolver3Rendering(false);
            }
        };

        // Kick off on next frame to let the "rendering" state update paint first
        requestAnimationFrame(runAsync);

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [solver3Trigger]);

    // ─── Effect 1c: Scan Accumulation — batch Solver 3 across scan cycle ───
    const [scanAccumConfig] = useAtom(scanAccumTriggerAtom);
    const [, setScanAccumProgress] = useAtom(scanAccumProgressAtom);
    const [, setAnimPlaying] = useAtom(animationPlayingAtom);

    useEffect(() => {
        if (scanAccumConfig.trigger === 0) return; // Skip initial mount
        if (!components) return;

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
        const savedValues = activeChannels.map(ch => ({
            channel: ch,
            target: byId.get(ch.targetId)!,
            originalValue: getProperty(byId.get(ch.targetId)!, ch.property),
        }));

        console.log(`[ScanAccum] Starting ${steps}-step sweep (${activeChannels.length} channels, from→to linear)`);

        // Lock out the animation loop and Solver 1 re-trace
        scanAccumActiveRef.current = true;
        setAnimPlaying(false);
        animator.playing = false;
        setSolver3Rendering(true);
        setScanAccumProgress(0);

        const savedPlaying = animStateRef.current.playing;

        // Clear previous scan frames and prepare fresh storage
        camera.clearScanFrames();
        const frameEmissions: Float32Array[] = [];
        const frameExcitations: Float32Array[] = [];
        const accumulatedEmission = new Float32Array(pixelCount);
        const accumulatedExcitation = new Float32Array(pixelCount);
        let lastPaths: Ray[][] = [];

        /** Restore all animated properties to their original values. */
        const restoreProperties = () => {
            for (const sv of savedValues) {
                setProperty(sv.target, sv.channel.property, sv.originalValue);
            }
        };

        const runStep = (step: number) => {
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
                restoreProperties();

                setSolver3Paths(lastPaths);
                solver3PathsRef.current = lastPaths;
                setSolver3Rendering(false);
                setScanAccumProgress(1);

                // Unlock animation loop and Solver 1
                scanAccumActiveRef.current = false;
                if (savedPlaying) {
                    setAnimPlaying(true);
                }
                return;
            }

            // Linear sweep: interpolate each channel from→to
            const fraction = steps > 1 ? step / (steps - 1) : 0.5;
            for (const sv of savedValues) {
                const value = sv.channel.from + (sv.channel.to - sv.channel.from) * fraction;
                setProperty(sv.target, sv.channel.property, value);
            }

            try {
                // ── Solver 1: Forward trace ──
                const solver1 = new Solver1(components);
                const sourceRays = createSourceRays(components, 1, 'center');
                const paths = solver1.trace(sourceRays);

                // ── Solver 2: Gaussian beam propagation ──
                let beamSegs: GaussianBeamSegment[][] = [];
                try {
                    const solver2 = new Solver2();
                    beamSegs = solver2.propagate(paths, components);
                } catch (e) {
                    console.warn('Scan accum Solver 2 error:', e);
                }

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
            restoreProperties();

            setScanAccumProgress((step + 1) / steps);

            // Schedule next step (yield to UI for progress update)
            setTimeout(() => runStep(step + 1), 0);
        };

        // Start step 0 after a brief delay (let UI update)
        setTimeout(() => runStep(0), 50);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanAccumConfig.trigger]);

    // ─── Effect 1d: PMT Raster Scan ───────────────────────────────────────
    useEffect(() => {
        if (scanAccumConfig.trigger === 0) return;
        if (!components) return;

        const pmt = components.find(c => c instanceof PMT && (c as PMT).hasValidAxes()) as PMT | undefined;
        if (!pmt) return;

        // Find the X and Y animation channels
        const xCh = animator.channels.find(ch => ch.targetId === pmt.xAxisComponentId && ch.property === pmt.xAxisProperty);
        const yCh = animator.channels.find(ch => ch.targetId === pmt.yAxisComponentId && ch.property === pmt.yAxisProperty);
        if (!xCh || !yCh) {
            console.warn('[PMT Raster] X or Y axis channel not found in animator');
            return;
        }

        const byId = new Map<string, OpticalComponent>();
        for (const c of components) byId.set(c.id, c);

        const xTarget = byId.get(xCh.targetId);
        const yTarget = byId.get(yCh.targetId);
        if (!xTarget || !yTarget) return;

        const resX = pmt.scanResX;
        const resY = pmt.scanResY;
        const totalPixels = resX * resY;

        // Save all animated channel values for restoration
        const allSaved = animator.channels.map(ch => ({
            channel: ch,
            target: byId.get(ch.targetId)!,
            originalValue: getProperty(byId.get(ch.targetId)!, ch.property),
        })).filter(sv => sv.target);

        console.log(`[PMT Raster] Starting ${resX}×${resY} raster scan (${totalPixels} pixels)`);

        // Lock animation loop
        scanAccumActiveRef.current = true;
        setAnimPlaying(false);
        animator.playing = false;
        setSolver3Rendering(true);
        setScanAccumProgress(0);

        const savedPlaying = animStateRef.current.playing;

        // Clear previous scan
        pmt.clearScan();
        const scanImage = new Float32Array(totalPixels);

        const restoreAll = () => {
            for (const sv of allSaved) {
                setProperty(sv.target, sv.channel.property, sv.originalValue);
            }
        };

        // Raster scan: Y slow (outer), X fast (inner)
        // Backward rays accumulate throughout the scan for visualization
        let pixelsDone = 0;
        const accumulatedPaths: Ray[][] = [];
        const maxVisPaths = 128; // Cap total visualization paths


        const runRow = (yIdx: number) => {
            if (yIdx >= resY) {
                // Done — store results
                console.log(`[PMT Raster] Done. ${totalPixels} pixels scanned, ${accumulatedPaths.length} backward paths.`);
                pmt.scanImage = scanImage;
                pmt.scanStale = false;
                pmt.scanVersionSnapshot = new Map(components.map(c => [c.id, c.version]));

                restoreAll();

                // Final update of visualization paths
                setSolver3Paths([...accumulatedPaths]);
                solver3PathsRef.current = accumulatedPaths;

                setSolver3Rendering(false);
                setScanAccumProgress(1);
                scanAccumActiveRef.current = false;
                if (savedPlaying) setAnimPlaying(true);
                return;
            }

            const yFrac = resY > 1 ? yIdx / (resY - 1) : 0.5;
            const yVal = yCh.from + (yCh.to - yCh.from) * yFrac;
            setProperty(yTarget, yCh.property, yVal);

            const runPixel = (xIdx: number) => {
                if (xIdx >= resX) {
                    // Row done, schedule next row
                    setScanAccumProgress(pixelsDone / totalPixels);
                    setTimeout(() => runRow(yIdx + 1), 0);
                    return;
                }

                const xFrac = resX > 1 ? xIdx / (resX - 1) : 0.5;
                const xVal = xCh.from + (xCh.to - xCh.from) * xFrac;
                setProperty(xTarget, xCh.property, xVal);

                try {
                    // Solver 1: Forward trace
                    const solver1 = new Solver1(components);
                    const sourceRays = createSourceRays(components, 1, 'center');
                    const paths = solver1.trace(sourceRays);

                    // Solver 2: Gaussian beam propagation
                    let beamSegs: GaussianBeamSegment[][] = [];
                    try {
                        const solver2 = new Solver2();
                        beamSegs = solver2.propagate(paths, components);
                    } catch (e) {
                        console.warn('[PMT Raster] Solver2 FAILED:', e);
                    }

                    // Debug: log beam focus position at corner/center pixels
                    const isCornerOrCenter = (xIdx === 0 && yIdx === 0) ||
                        (xIdx === resX - 1 && yIdx === 0) ||
                        (xIdx === 0 && yIdx === resY - 1) ||
                        (xIdx === resX - 1 && yIdx === resY - 1) ||
                        (xIdx === Math.floor(resX / 2) && yIdx === Math.floor(resY / 2));
                    if (isCornerOrCenter && beamSegs.length > 0) {
                        const lastBranch = beamSegs[0];
                        const lastSeg = lastBranch[lastBranch.length - 1];
                        console.log(`[PMT Focus] pixel(${xIdx},${yIdx}) beam_end=(${lastSeg.end.x.toFixed(2)},${lastSeg.end.y.toFixed(2)},${lastSeg.end.z.toFixed(2)}) segs=${lastBranch.length}`);
                    }

                    // Solver 3: backward trace — PMT as 1-pixel camera
                    // Uses the beamSegs from Solver 2 (excitation field) to query
                    // fluorescence at the sample via the same traceBackward() as Camera
                    const solver3 = new Solver3(components, beamSegs);
                    const { radiance, bestPath } = solver3.renderPMTPixel(pmt);
                    scanImage[yIdx * resX + xIdx] = radiance;

                    // Accumulate surviving backward paths for visualization
                    if (bestPath && accumulatedPaths.length < maxVisPaths) {
                        accumulatedPaths.push(bestPath);
                    }
                } catch (e) {
                    console.warn(`[PMT Raster] Pixel (${xIdx},${yIdx}) error:`, e);
                    scanImage[yIdx * resX + xIdx] = 0;
                }

                pixelsDone++;

                // Restore properties between pixels to keep rays stable visually
                restoreAll();

                // Schedule next pixel (yield to UI every pixel for responsiveness)
                setTimeout(() => runPixel(xIdx + 1), 0);
            };

            runPixel(0);
        };

        setTimeout(() => runRow(0), 50);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanAccumConfig.trigger]);

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
                // Skip Gaussian beam matching if no beam segments available
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

                const wavelengthMm = bestSeg.wavelength * 1e3;
                const qx = { re: bestSeg.qx_start.re + bestZ, im: bestSeg.qx_start.im };
                const qy = { re: bestSeg.qy_start.re + bestZ, im: bestSeg.qy_start.im };

                const invQx = { re: qx.re / (qx.re * qx.re + qx.im * qx.im), im: -qx.im / (qx.re * qx.re + qx.im * qx.im) };
                const invQy = { re: qy.re / (qy.re * qy.re + qy.im * qy.im), im: -qy.im / (qy.re * qy.re + qy.im * qy.im) };

                const beamWx = invQx.im < 0 ? Math.sqrt(-wavelengthMm / (Math.PI * invQx.im)) : 10;
                const beamWy = invQy.im < 0 ? Math.sqrt(-wavelengthMm / (Math.PI * invQy.im)) : 10;


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
            <RayVisualizer paths={rays} glowEnabled={rayConfig.solver2Enabled} hideAll={rayConfig.emFieldVisible} />
            {solver3Paths.length > 0 && <RayVisualizer paths={solver3Paths} glowEnabled={false} hideAll={false} />}
            {rayConfig.solver2Enabled && rayConfig.emFieldVisible && <EFieldVisualizer beamSegments={beamSegments} />}

            <group>
                {components.map(c => {
                    let visual = null;
                    if (c instanceof Mirror) visual = <MirrorVisualizer component={c} />;
                    else if (c instanceof CurvedMirror) visual = <CurvedMirrorVisualizer component={c} />;
                    else if (c instanceof ObjectiveCasing) visual = <CasingVisualizer component={c} />;
                    else if (c instanceof Objective) visual = <ObjectiveVisualizer component={c} />;
                    else if (c instanceof IdealLens) visual = <IdealLensVisualizer component={c} />;
                    else if (c instanceof SphericalLens) visual = <LensVisualizer component={c} />;
                    else if (c instanceof Laser) visual = <SourceVisualizer component={c} />;
                    else if (c instanceof Lamp) visual = <LampVisualizer component={c} />;
                    else if (c instanceof Blocker) visual = <BlockerVisualizer component={c} />;
                    else if (c instanceof Card) visual = <CardVisualizer component={c} />;
                    else if (c instanceof SampleChamber) visual = <SampleChamberVisualizer component={c} />;
                    else if (c instanceof Sample) visual = <SampleVisualizer component={c} />;
                    else if (c instanceof Camera) visual = <CameraVisualizer component={c} />;
                    else if (c instanceof PMT) visual = <PMTVisualizer component={c} />;
                    else if (c instanceof CylindricalLens) visual = <CylindricalLensVisualizer component={c} />;
                    else if (c instanceof PrismLens) visual = <PrismVisualizer component={c} />;
                    else if (c instanceof Waveplate) visual = <WaveplateVisualizer component={c} />;
                    else if (c instanceof BeamSplitter) visual = <BeamSplitterVisualizer component={c} />;
                    else if (c instanceof SlitAperture) visual = <SlitApertureVisualizer component={c} />;
                    else if (c instanceof Aperture) visual = <ApertureVisualizer component={c} />;
                    else if (c instanceof Filter) visual = <FilterVisualizer component={c} />;
                    else if (c instanceof DichroicMirror) visual = <DichroicVisualizer component={c} />;
                    else if (c instanceof PolygonScanner) visual = <PolygonScannerVisualizer component={c} />;

                    if (visual) {
                        return (
                            <group key={c.id}>
                                <Draggable component={c}>
                                    {visual}
                                </Draggable>
                            </group>
                        );
                    }
                    return null;
                })}
            </group>
        </group>
    );
};
