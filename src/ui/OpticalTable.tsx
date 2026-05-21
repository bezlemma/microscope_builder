import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useAtom, useSetAtom } from 'jotai';
import {
    componentsAtom,
    rayConfigAtom,
    reverseTraceRenderTriggerAtom,
    reverseTraceRenderingAtom,
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
    cardImageTickAtom,
    isDraggingAtom,
    publishForwardRaysAtom,
    publishReverseRaysAtom,
    publishTrapBeamSegmentsAtom,
    uiLockedAtom,
    activePresetAtom,
    OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT,
} from '../state/store';
import type { AnimationChannel } from '../physics/PropertyAnimator';
import { useFrame } from '@react-three/fiber';

import { Ray } from '../physics/types';
import { OpticalComponent } from '../physics/Component';
import { ForwardTracer } from '../physics/ForwardTracer';
import { Card } from '../physics/components/Card';
import { Sample, type ColloidTrapZone } from '../physics/components/Sample';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { QPD } from '../physics/components/QPD';
import { TrappedBead } from '../physics/components/TrappedBead';
import { PrismLens } from '../physics/components/PrismLens';
import { estimatePassiveColloidTrapZone } from '../physics/trapDiagnostics';

import { RayVisualizer } from './RayVisualizer';
import { RayOcclusionLayer } from './RayOcclusionLayer';

import { BundleWaveVisualizer } from './BundleWaveVisualizer';
import { OpticalPlaneVisualizer } from './OpticalPlaneVisualizer';
import { GaussianBeamSegment, segmentBeamEnvelopeRadii } from '../physics/BeamField';
import { ReverseTracer } from '../physics/ReverseTracer';
import { createSourceRays, stablePreviewSourceRays } from '../physics/SourceRayFactory';
import { traceStableTableOverlay } from '../physics/tableTrace';
import { deserializeScene, serializeScene } from '../state/ubzSerializer';
import type { MainToWorker, WorkerToMain } from '../physics/reverseTraceWorker';
import type { ForwardTraceWorkerRequest, ForwardTraceWorkerResponse } from '../physics/forwardTraceWorker';
import { deserializeRayPath } from '../physics/raySerialization';
import { deserializeBeamSegments } from '../physics/beamSerialization';

function resampleFloat32Image(
    src: Float32Array,
    srcX: number,
    srcY: number,
    dstX: number,
    dstY: number,
): Float32Array {
    if (srcX === dstX && srcY === dstY && src.length >= dstX * dstY) return src;
    const dst = new Float32Array(dstX * dstY);
    if (srcX <= 0 || srcY <= 0 || src.length < srcX * srcY) return dst;
    for (let y = 0; y < dstY; y++) {
        const sy = Math.min(srcY - 1, Math.floor((y * srcY) / dstY));
        for (let x = 0; x < dstX; x++) {
            const sx = Math.min(srcX - 1, Math.floor((x * srcX) / dstX));
            dst[y * dstX + x] = src[sy * srcX + sx];
        }
    }
    return dst;
}

function resampleUint32Image(
    src: Uint32Array,
    srcX: number,
    srcY: number,
    dstX: number,
    dstY: number,
): Uint32Array {
    if (srcX === dstX && srcY === dstY && src.length >= dstX * dstY) return src;
    const dst = new Uint32Array(dstX * dstY);
    if (srcX <= 0 || srcY <= 0 || src.length < srcX * srcY) return dst;
    for (let y = 0; y < dstY; y++) {
        const sy = Math.min(srcY - 1, Math.floor((y * srcY) / dstY));
        for (let x = 0; x < dstX; x++) {
            const sx = Math.min(srcX - 1, Math.floor((x * srcX) / dstX));
            dst[y * dstX + x] = src[sy * srcX + sx];
        }
    }
    return dst;
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

function hasLiveForwardTraceSideEffects(components: OpticalComponent[]): boolean {
    return components.some(component => component instanceof QPD || component instanceof TrappedBead);
}

function traceLiveForwardSideEffects(
    components: OpticalComponent[],
    makeSourceRays: () => Ray[],
): void {
    if (!hasLiveForwardTraceSideEffects(components)) return;
    new ForwardTracer(components).trace(makeSourceRays());
}

const MAX_TIMELINE_CYCLE_MS = 120_000;

function gcdInteger(a: number, b: number): number {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y > 0) {
        const next = x % y;
        x = y;
        y = next;
    }
    return Math.max(1, x);
}

function resolveAnimationCycleMs(channels: AnimationChannel[]): number {
    const periods = channels
        .map(channel => Math.max(1, Math.round(channel.periodMs)))
        .filter(period => Number.isFinite(period));
    if (periods.length === 0) return 1000;
    if (channels.some(channel => !channel.repeat)) return Math.max(...periods);

    let cycleMs = periods[0];
    for (let i = 1; i < periods.length; i++) {
        const period = periods[i];
        const gcd = gcdInteger(cycleMs, period);
        const nextCycle = (cycleMs / gcd) * period;
        if (!Number.isFinite(nextCycle) || nextCycle > MAX_TIMELINE_CYCLE_MS) {
            return Math.max(...periods);
        }
        cycleMs = nextCycle;
    }
    return Math.max(1, cycleMs);
}

function timelineClockMsForStep(step: number, steps: number, cycleMs: number, channels: AnimationChannel[]): number {
    if (steps <= 1) return 0;
    const allRepeat = channels.every(channel => channel.repeat);
    return allRepeat
        ? cycleMs * (step / steps)
        : cycleMs * (step / (steps - 1));
}

function circularIndexDistance(a: number, b: number, steps: number): number {
    const direct = Math.abs(a - b);
    return Math.min(direct, steps - direct);
}

function addUniqueStep(order: number[], step: number, steps: number): void {
    const clamped = Math.max(0, Math.min(steps - 1, Math.round(step)));
    if (!order.includes(clamped)) order.push(clamped);
}

function scanSolveOrder(steps: number, channels: AnimationChannel[]): number[] {
    if (steps <= 1) return [0];
    const order: number[] = [];
    const allRepeat = channels.every(channel => channel.repeat);
    const usesSinusoidal = channels.some(channel => channel.easing === 'sinusoidal');

    if (usesSinusoidal && allRepeat) {
        addUniqueStep(order, 0, steps);
        addUniqueStep(order, steps / 4, steps);
        addUniqueStep(order, (3 * steps) / 4, steps);
    } else {
        addUniqueStep(order, (steps - 1) / 2, steps);
        addUniqueStep(order, 0, steps);
        addUniqueStep(order, steps - 1, steps);
    }

    while (order.length < steps) {
        let bestStep = 0;
        let bestDistance = -Infinity;
        for (let step = 0; step < steps; step++) {
            if (order.includes(step)) continue;
            const nearest = order.reduce((minDistance, solvedStep) => {
                const distance = allRepeat
                    ? circularIndexDistance(step, solvedStep, steps)
                    : Math.abs(step - solvedStep);
                return Math.min(minDistance, distance);
            }, Infinity);
            if (nearest > bestDistance) {
                bestDistance = nearest;
                bestStep = step;
            }
        }
        order.push(bestStep);
    }

    return order;
}

function animationTimelineSignature(components: OpticalComponent[], channels: AnimationChannel[]): string {
    const animatedTargetIds = new Set(channels.map(channel => channel.targetId));
    const channelKey = channels
        .map(channel => [
            channel.id,
            channel.targetId,
            channel.property,
            channel.from,
            channel.to,
            channel.easing,
            channel.periodMs,
            channel.repeat ? 1 : 0,
            channel.discreteSteps ?? '',
        ].join(':'))
        .join('|');
    const staticKey = components
        .map(component => animatedTargetIds.has(component.id)
            ? `${component.id}:animated`
            : `${component.id}:${component.version}`)
        .join('|');
    return `${channelKey}::${staticKey}`;
}

function pathsReachAnyComponent(paths: Ray[][], componentIds: Set<string>): boolean {
    if (componentIds.size === 0) return false;
    for (const path of paths) {
        for (const ray of path) {
            if (ray.interactionComponentId && componentIds.has(ray.interactionComponentId)) {
                return true;
            }
        }
    }
    return false;
}

function colloidTrapZonesBySample(
    components: OpticalComponent[],
    beamSegments: GaussianBeamSegment[][],
): Map<string, ColloidTrapZone[]> {
    const zones = new Map<string, ColloidTrapZone[]>();
    const samplesById = new Map<string, Sample>();
    for (const component of components) {
        if (component instanceof Sample) samplesById.set(component.id, component);
    }

    for (const component of components) {
        if (!(component instanceof TrappedBead) || !component.parentSampleId) continue;
        const parentSample = samplesById.get(component.parentSampleId);
        if (!parentSample) continue;
        const zone = estimatePassiveColloidTrapZone(component, parentSample, beamSegments);
        if (!zone) continue;

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
type PendingForwardTrace = {
    sceneText: string;
    forwardRayCount: number;
    sourceRayLimit: number;
    applyPaths: boolean;
    applyBeamSegments: boolean;
    includeBeamSegments?: boolean;
    returnPaths?: boolean;
};

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
    // High-churn trace payloads are kept out of React state. During animation
    // these arrays can be reassigned dozens of times per second; putting the
    // full Ray[][] in a Canvas fiber state update lets interrupted render
    // queues retain old traces. Store only the latest payload in refs and
    // queue tiny revision counters to ask React for a redraw.
    const solverPathsRef = useRef<Ray[][]>([]);
    const beamSegsRef = useRef<GaussianBeamSegment[][]>([]);
    const reverseTracePathsRef = useRef<Ray[][]>([]);
    const trapBeamSegsRef = useRef<GaussianBeamSegment[][]>([]);
    const [, setRayRenderRevision] = useState(0);
    const [, setBeamRenderRevision] = useState(0);
    const [, setReverseTracerRenderRevision] = useState(0);
    // Write-only handles: useSetAtom, NOT useAtom. `const [, setX] = useAtom(a)`
    // still SUBSCRIBES this fiber to `a`. forwardRays / reverseRays /
    // trapBeamSegments / the image-tick atoms are all reassigned on every
    // animation frame, so subscribing here means every trace schedules an
    // update on this (large, frequently render-interrupted) fiber. Under R3F's
    // reconciler those updates land in the hook's baseQueue faster than a
    // committed render drains them — each one retaining a full Ray[][] — which
    // is the unbounded heap growth that OOM-crashes heavy animated presets.
    const setForwardRays = useSetAtom(publishForwardRaysAtom);
    const setReverseRays = useSetAtom(publishReverseRaysAtom);
    const setTrapBeamSegments = useSetAtom(publishTrapBeamSegmentsAtom);
    const setCardImageTick = useSetAtom(cardImageTickAtom);
    const setReverseTracerRendering = useSetAtom(reverseTraceRenderingAtom);
    const rays = solverPathsRef.current;
    const beamSegments = beamSegsRef.current;
    const reverseTracePaths = reverseTracePathsRef.current;
    const setRays = useCallback((next: Ray[][]) => {
        solverPathsRef.current = next;
        setRayRenderRevision(revision => revision + 1);
    }, []);
    const setBeamSegments = useCallback((next: GaussianBeamSegment[][]) => {
        beamSegsRef.current = next;
        setBeamRenderRevision(revision => revision + 1);
    }, []);
    const setReverseTracerPaths = useCallback((next: Ray[][]) => {
        reverseTracePathsRef.current = next;
        setReverseRays(next);
        setReverseTracerRenderRevision(revision => revision + 1);
    }, [setReverseRays]);
    const [reverseTraceTrigger, setReverseTracerTrigger] = useAtom(reverseTraceRenderTriggerAtom);
    const [isDragging] = useAtom(isDraggingAtom);
    const [uiLocked] = useAtom(uiLockedAtom);
    // The solver-3 guard genuinely needs the live value, so this one subscribes.
    const [reverseTraceRendering] = useAtom(reverseTraceRenderingAtom);
    const reverseTraceRenderingRef = useRef(reverseTraceRendering);
    reverseTraceRenderingRef.current = reverseTraceRendering;
    const reverseTraceDragPendingRef = useRef(false);
    const [scanAccumConfig, setScanAccumConfig] = useAtom(scanAccumTriggerAtom);
    const scanAccumConfigRef = useRef(scanAccumConfig);
    scanAccumConfigRef.current = scanAccumConfig;
    const setScanAccumProgress = useSetAtom(scanAccumProgressAtom);
    const setDrawnRayCounts = useSetAtom(drawnRayCountsAtom);
    const setCameraImageTick = useSetAtom(cameraImageTickAtom);
    const haptic = useHaptic();
    const hapticRef = useRef(haptic);
    hapticRef.current = haptic;

    // Keep the UI counter of drawn rays in sync with what the RayVisualizer sees.
    // Each path corresponds to one source-emitted ray (it may bounce through
    // several components, producing multiple segments — those are not counted
    // separately here).
    useEffect(() => {
        setDrawnRayCounts({ forward: rays.length, reverse: reverseTracePaths.length });
    }, [rays.length, reverseTracePaths.length, setDrawnRayCounts]);

    // Preset-switch ghost-ray cleanup: the worker-traced paths live in local
    // refs (`rays`, `beamSegments`, `reverseTracePaths`), so even though
    // loadPresetAtom clears the global ray atoms, this component still holds
    // the old preset's traces until a new trace completes asynchronously.
    // Wipe them synchronously the moment the active preset changes so the
    // old lamp/laser beams don't linger over the new scene's components.
    const [activePreset] = useAtom(activePresetAtom);
    useEffect(() => {
        setRays([]);
        setBeamSegments([]);
        setReverseTracerPaths([]);
        trapBeamSegsRef.current = [];
    }, [activePreset]);

    // (Sample / SampleChamber zoom-viewer auto-pinning is preset-specific —
    // see loadPresetAtom for the presets where the ray-vs-sample geometry is
    // the primary thing the user wants to watch. Other presets leave the user
    // to pin manually.)

    // ─── Animation System ───
    const [animator] = useAtom(animatorAtom);
    const [animPlaying, setAnimPlaying] = useAtom(animationPlayingAtom);
    const [animSpeed] = useAtom(animationSpeedAtom);
    const animatorRef = useRef(animator);
    animatorRef.current = animator;
    const animStateRef = useRef({ playing: false, speed: 1.0 });
    animStateRef.current.playing = animPlaying;
    animStateRef.current.speed = animSpeed;
    const componentsRef = useRef(components);
    componentsRef.current = components;
    const isDraggingRef = useRef(isDragging);
    isDraggingRef.current = isDragging;
    const beamFieldEnabledRef = useRef(rayConfig.beamFieldEnabled);
    beamFieldEnabledRef.current = rayConfig.beamFieldEnabled;

    // Animation counter — increments force React re-render for fingerprint
    const [animTick, setAnimTick] = useState(0);
    const setAnimTickRef = useRef(setAnimTick);
    setAnimTickRef.current = setAnimTick;

    // Guard ref: when true, scan accumulation is running — skip useFrame and forward tracer
    const scanAccumActiveRef = useRef(false);
    const activeScanJobRef = useRef<ReturnType<typeof createScheduledRenderJob> | null>(null);
    const lastAnimationTimelineSignatureRef = useRef('');
    const timelineBakePendingSignatureRef = useRef('');
    const timelineReadySignatureRef = useRef('');
    const timelineBakeKickoffTimerRef = useRef<number | null>(null);
    const lastTimelineReverseFrameRef = useRef('');
    const lastTrapRedrawMsRef = useRef(0);
    // Re-trace throttle: the animator clock advances every frame, but the
    // expensive cascade it triggers (re-render → full forward trace → rebuild
    // every ray-line) only needs to run at a fraction of the display rate.
    // Firing it 60×/s saturates the main thread so the GC never gets idle
    // time to keep up with the per-frame allocation churn — which is what
    // makes heavy presets (long beam paths, many rays) climb in memory until
    // the tab OOMs. ~33 ms ≈ 30 Hz leaves headroom for GC while keeping the
    // slow scan animations visually smooth.
    const lastAnimRetraceMsRef = useRef(0);
    const ANIM_RETRACE_MIN_INTERVAL_MS = 33;

    const timelineCamerasReady = (currentComponents: OpticalComponent[]): boolean => {
        const cameras = currentComponents.filter(component => component instanceof Camera) as Camera[];
        return cameras.length > 0 && cameras.every(camera =>
            Boolean(camera.scanFrames && camera.scanPaths && camera.scanFrameCount > 0));
    };

    const publishTimelineReversePathsForClock = (clockMs: number, currentComponents: OpticalComponent[]) => {
        const cameras = currentComponents.filter(component =>
            component instanceof Camera &&
            component.scanPaths &&
            component.scanFrameCount > 0 &&
            (component.scanFrameTimesMs?.length ?? 0) >= component.scanFrameCount,
        ) as Camera[];
        if (cameras.length === 0) return;

        const activeChannels = animator.channels.filter(channel =>
            currentComponents.some(component => component.id === channel.targetId),
        );
        const cycleMs = activeChannels.length > 0 ? resolveAnimationCycleMs(activeChannels) : cameras[0].scanCycleMs;
        const timelineMs = ((clockMs % cycleMs) + cycleMs) % cycleMs;
        const pathFrames: Ray[][] = [];
        const signatureParts: string[] = [];

        for (const camera of cameras) {
            const frameTimes = camera.scanFrameTimesMs ?? [];
            let frameIndex = 0;
            for (let i = 0; i < camera.scanFrameCount; i++) {
                if ((frameTimes[i] ?? 0) <= timelineMs) frameIndex = i;
                else break;
            }
            signatureParts.push(`${camera.id}:${frameIndex}:${camera.scanFrameCount}`);
            pathFrames.push(...(camera.scanPaths?.[frameIndex] ?? []));
        }

        const signature = signatureParts.join('|');
        if (lastTimelineReverseFrameRef.current === signature) return;
        lastTimelineReverseFrameRef.current = signature;
        setReverseTracerPaths(pathFrames);
    };
    const publishTimelineReversePathsForClockRef = useRef(publishTimelineReversePathsForClock);
    publishTimelineReversePathsForClockRef.current = publishTimelineReversePathsForClock;

    useFrame((_, delta) => {
        if (scanAccumActiveRef.current) return; // Skip during scan accumulation
        const { playing, speed } = animStateRef.current;
        if (!playing) return;
        animator.playing = true;
        // The animator clock advances every frame (cheap — just mutates
        // component properties), but the re-render/re-trace it drives is
        // throttled: see lastAnimRetraceMsRef above.
        const mutated = animator.tick(delta * 1000 * speed, componentsRef.current);
        if (mutated) {
            const now = performance.now();
            if (now - lastAnimRetraceMsRef.current >= ANIM_RETRACE_MIN_INTERVAL_MS) {
                lastAnimRetraceMsRef.current = now;
                // Force fingerprint recalculation by triggering a React re-render
                setAnimTickRef.current(t => t + 1);
                publishTimelineReversePathsForClock(animator.clockMs, componentsRef.current);
            }
        }
    });

    // ─── TrappedBead integrator ───────────────────────────────────────────
    // Runs every frame regardless of the master animation play state, because
    // the bead always experiences forces from the live beam — turning off the
    // global "play" button shouldn't freeze a trap any more than turning off
    // your monitor freezes one in a real lab.
    //
    // forward tracer is intentionally not re-run for every bead Brownian/force step:
    // doing so continuously remounts thousands of ray line geometries and can
    // grow browser memory until interaction crashes the page. Static optics
    // changes rebuild the beam field; bead motion samples that cached field.
    useFrame(() => {
        if (scanAccumActiveRef.current) return;
        const currentComponents = componentsRef.current;
        const now = performance.now();
        let anyMoved = syncManagedTrapBeads(currentComponents);
        const trapBeamSegs = trapBeamSegsRef.current;

        if (isDraggingRef.current) {
            for (const sample of currentComponents) {
                if (sample instanceof Sample) sample.pauseColloidDiffusion();
            }
            for (const bead of currentComponents) {
                if (bead instanceof TrappedBead) bead.pauseIntegrator();
            }
            if (anyMoved && now - lastTrapRedrawMsRef.current > 33) {
                lastTrapRedrawMsRef.current = now;
                setAnimTickRef.current(t => t + 1);
            }
            return;
        }

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
    // them should NOT trigger the expensive ForwardTracer/BeamField re-computation.
    // Uses component.version which is bumped on every property mutation.
    const opticsFingerprint = useMemo(() => {
        if (!components) return '';
        // Cards only affect optics when flagged opaque — otherwise they're passive.
        return components
            .filter(c => !(c instanceof Card) || (c as Card).opaque)
            .map(c => `${c.id}:${c.position.x},${c.position.y},${c.position.z}:${c.rotation.x},${c.rotation.y},${c.rotation.z},${c.rotation.w}:v${c.version}`)
            .join('|');
    }, [components, animTick]);

    useEffect(() => {
        if (!components) return;
        if (!animPlaying) return;
        if (scanAccumActiveRef.current) return;
        const activeChannels = animator.channels.filter(channel =>
            components.some(component => component.id === channel.targetId),
        );
        if (activeChannels.length === 0) return;
        if (!components.some(component => component instanceof Camera)) return;

        const signature = animationTimelineSignature(components, activeChannels);
        if (timelineBakePendingSignatureRef.current || activeScanJobRef.current || timelineBakeKickoffTimerRef.current !== null) return;
        if (timelineReadySignatureRef.current === signature && timelineCamerasReady(components)) return;
        timelineBakePendingSignatureRef.current = signature;
        const kickoffTimer = window.setTimeout(() => {
            if (timelineBakeKickoffTimerRef.current !== kickoffTimer) return;
            timelineBakeKickoffTimerRef.current = null;
            if (!animStateRef.current.playing) {
                if (timelineBakePendingSignatureRef.current === signature) {
                    timelineBakePendingSignatureRef.current = '';
                }
                return;
            }
            setScanAccumConfig(config => ({ steps: config.steps, trigger: config.trigger + 1 }));
        }, 120);
        timelineBakeKickoffTimerRef.current = kickoffTimer;
        return () => {
            if (timelineBakeKickoffTimerRef.current !== kickoffTimer) return;
            window.clearTimeout(kickoffTimer);
            timelineBakeKickoffTimerRef.current = null;
            if (timelineBakePendingSignatureRef.current === signature) {
                timelineBakePendingSignatureRef.current = '';
            }
        };
    }, [animPlaying, animator, components, setScanAccumConfig]);

    const forwardTraceWorkerRef = useRef<Worker | null>(null);
    const forwardTraceWorkerBusyRef = useRef(false);
    const forwardTraceWorkerPendingRef = useRef<PendingForwardTrace | null>(null);
    const forwardTraceWorkerTimerRef = useRef<number | null>(null);
    const forwardTraceWorkerJobIdRef = useRef(0);
    const forwardTraceWorkerJobsRef = useRef<Map<number, PendingForwardTrace>>(new Map());
    const lastOpticsFingerprintRef = useRef<string>('');

    const minForwardRayCount = rayConfig.viewerMode === 'planes'
        ? OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT
        : MIN_FORWARD_RAY_COUNT;
    const clampedForwardRayCount = Math.max(minForwardRayCount, Math.min(MAX_FORWARD_RAY_COUNT, rayConfig.rayCount));
    const clampedReversePathCount = Math.max(MIN_REVERSE_PATH_COUNT, Math.min(MAX_REVERSE_PATH_COUNT, rayConfig.reversePathCount));
    const traceSettingsRef = useRef({
        clampedForwardRayCount,
        clampedReversePathCount,
        isDragging,
        beamFieldEnabled: rayConfig.beamFieldEnabled,
    });
    traceSettingsRef.current = {
        clampedForwardRayCount,
        clampedReversePathCount,
        isDragging,
        beamFieldEnabled: rayConfig.beamFieldEnabled,
    };

    const pumpForwardTraceWorker = () => {
        if (forwardTraceWorkerBusyRef.current) return;
        const pending = forwardTraceWorkerPendingRef.current;
        if (!pending) return;

        let worker = forwardTraceWorkerRef.current;
        if (!worker) {
            worker = new Worker(new URL('../physics/forwardTraceWorker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (event: MessageEvent<ForwardTraceWorkerResponse>) => {
                const msg = event.data;
                forwardTraceWorkerBusyRef.current = false;
                const job = forwardTraceWorkerJobsRef.current.get(msg.jobId);
                forwardTraceWorkerJobsRef.current.delete(msg.jobId);
                if (msg.jobId !== forwardTraceWorkerJobIdRef.current) {
                    pumpForwardTraceWorker();
                    return;
                }
                if (!job) {
                    pumpForwardTraceWorker();
                    return;
                }
                if ((job.applyPaths || job.applyBeamSegments) && forwardTraceWorkerPendingRef.current) {
                    pumpForwardTraceWorker();
                    return;
                }
                if (job.applyPaths && !isDraggingRef.current) {
                    forwardTraceWorkerPendingRef.current = null;
                    pumpForwardTraceWorker();
                    return;
                }
                if (msg.type === 'forward-done') {
                    if (job.applyPaths && msg.paths) {
                        const calculatedPaths = msg.paths.map(deserializeRayPath);
                        setRays(calculatedPaths);
                        setForwardRays(calculatedPaths);
                        solverPathsRef.current = calculatedPaths;
                    }
                    if (job.applyBeamSegments && msg.beamSegments) {
                        const nextBeamSegs = deserializeBeamSegments(msg.beamSegments);
                        trapBeamSegsRef.current = nextBeamSegs;
                        setTrapBeamSegments(nextBeamSegs);
                        if (beamFieldEnabledRef.current) {
                            setBeamSegments(nextBeamSegs);
                            beamSegsRef.current = nextBeamSegs;
                        } else {
                            setBeamSegments([]);
                            beamSegsRef.current = [];
                        }
                    }
                } else {
                    console.warn('forward tracer worker error:', msg.message);
                }
                pumpForwardTraceWorker();
            };
            forwardTraceWorkerRef.current = worker;
        }

        forwardTraceWorkerPendingRef.current = null;
        forwardTraceWorkerBusyRef.current = true;
        const jobId = forwardTraceWorkerJobIdRef.current + 1;
        forwardTraceWorkerJobIdRef.current = jobId;
        const request: ForwardTraceWorkerRequest = {
            type: 'trace-forward',
            jobId,
            sceneText: pending.sceneText,
            forwardRayCount: pending.forwardRayCount,
            sourceRayLimit: pending.sourceRayLimit,
            includeBeamSegments: pending.includeBeamSegments,
            returnPaths: pending.returnPaths,
        };
        forwardTraceWorkerJobsRef.current.set(jobId, pending);
        worker.postMessage(request);
    };

    const scheduleForwardTraceWorkerTrace = (pending: PendingForwardTrace) => {
        forwardTraceWorkerPendingRef.current = pending;
        if (forwardTraceWorkerTimerRef.current !== null) return;
        forwardTraceWorkerTimerRef.current = window.setTimeout(() => {
            forwardTraceWorkerTimerRef.current = null;
            pumpForwardTraceWorker();
        }, 33);
    };
    const scheduleForwardTraceWorkerTraceRef = useRef(scheduleForwardTraceWorkerTrace);
    scheduleForwardTraceWorkerTraceRef.current = scheduleForwardTraceWorkerTrace;

    useEffect(() => () => {
        if (forwardTraceWorkerTimerRef.current !== null) {
            window.clearTimeout(forwardTraceWorkerTimerRef.current);
            forwardTraceWorkerTimerRef.current = null;
        }
        forwardTraceWorkerRef.current?.terminate();
        forwardTraceWorkerRef.current = null;
        forwardTraceWorkerBusyRef.current = false;
        forwardTraceWorkerPendingRef.current = null;
        forwardTraceWorkerJobsRef.current.clear();
        forwardTraceWorkerJobIdRef.current++;
    }, []);

    useEffect(() => {
        const components = componentsRef.current;
        const settings = traceSettingsRef.current;
        if (!components) return;
        if (scanAccumActiveRef.current) return; // Skip during scan accumulation

        if (!isDragging) {
            forwardTraceWorkerPendingRef.current = null;
            if (forwardTraceWorkerTimerRef.current !== null) {
                window.clearTimeout(forwardTraceWorkerTimerRef.current);
                forwardTraceWorkerTimerRef.current = null;
            }
        }

        const sceneChanged = lastOpticsFingerprintRef.current !== opticsFingerprint;
        lastOpticsFingerprintRef.current = opticsFingerprint;

        if (isDragging) {
            syncManagedTrapBeads(components);
            const makeForwardSourceRays = () => createSourceRays(components, settings.clampedForwardRayCount, 'full');
            // Correctness during drag is more important than a clever partial
            // update. A cached/preview trace can mix sparse bead-scatter rays
            // with stale families and show physically impossible beam paths.
            let dragSolver: ForwardTracer | null = null;
            const calculatedPaths = traceStableTableOverlay(
                components,
                () => {
                    dragSolver = new ForwardTracer(components);
                    return dragSolver.trace(makeForwardSourceRays());
                },
            );
            if (settings.beamFieldEnabled) {
                try {
                    const previewBeamSegs = (dragSolver ?? new ForwardTracer(components)).buildBeamSegments(calculatedPaths);
                    setBeamSegments(previewBeamSegs);
                    beamSegsRef.current = previewBeamSegs;
                } catch (e) {
                    console.warn('Beam field drag preview error:', e);
                    setBeamSegments([]);
                    beamSegsRef.current = [];
                }
            } else {
                setBeamSegments([]);
                beamSegsRef.current = [];
            }
            // Drag traces are visual previews only. Live QPD/bead force
            // side effects are recomputed from the full ray set on release.
            setRays(calculatedPaths);
            setForwardRays(calculatedPaths);
            solverPathsRef.current = calculatedPaths;
            let hasCamera = false;
            for (const comp of components) {
                if (comp instanceof Camera) {
                    comp.reverseTraceStale = true;
                    hasCamera = true;
                }
            }
            if (hasCamera && sceneChanged) {
                reverseTraceDragPendingRef.current = true;
                if (!reverseTraceRenderingRef.current) {
                    reverseTraceDragPendingRef.current = false;
                    setReverseTracerTrigger(t => t + 1);
                }
            }
            return;
        }

        syncManagedTrapBeads(components);

        const cardsToReset = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardsToReset) {
            card.hits = [];
        }

        // Correctness first: full traces avoid stale/new ray-family mixing from
        // the dependency cache, which was especially visible when dragging
        // blockers around optical-trap and tutorial scenes.
        let solver: ForwardTracer | null = null;
        const makeForwardSourceRays = () => {
            return createSourceRays(components, settings.clampedForwardRayCount, 'full');
        };
        const calculatedPaths = traceStableTableOverlay(components, () => {
            solver = new ForwardTracer(components);
            return solver.trace(makeForwardSourceRays());
        }).slice();
        traceLiveForwardSideEffects(components, makeForwardSourceRays);
        const absorberOnlyChange = false;

        // Post-trace: detect beam splits via angle histogram population analysis.
        // Only needed when E&M solver is enabled — the branching path logic
        // relies on marginal rays to detect population splits.
        if (settings.beamFieldEnabled && !isDragging) {
            const syntheticMainOptics = new Set(
                components
                    .filter((component): component is PrismLens => component instanceof PrismLens)
                    .map(component => component.name),
            );
            const pathHasSyntheticMainOpticExit = (path: Ray[]) => path.some(ray => {
                const label = ray.exitSurfaceId;
                if (!label) return false;
                const componentName = label.split(':')[0];
                return syntheticMainOptics.has(componentName);
            });
            const surviving = calculatedPaths.filter(p => {
                if (p.length < 2) return false;
                const last = p[p.length - 1];
                return last.intensity > 0 && !last.terminationPoint;
            });


            type SplitEntry = { path: Ray[]; exitRay: Ray; angle: number; sourceId?: string };
            const allSplitCandidates: SplitEntry[] = [];
            for (const p of surviving) {
                for (let i = p.length - 1; i >= 0; i--) {
                    const label = p[i].exitSurfaceId;
                    const componentName = label?.split(':')[0] ?? '';
                    if (label && syntheticMainOptics.has(componentName)) {
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
                    if (!pathHasSyntheticMainOpticExit(p)) return false;
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
        } // end beamFieldEnabled guard

        setRays(calculatedPaths);
        setForwardRays(calculatedPaths);
        solverPathsRef.current = calculatedPaths;

        if (isDragging) {
            return;
        }

        let beamSegs: GaussianBeamSegment[][] = [];
        const trappedBeads = components.filter(c => c instanceof TrappedBead) as TrappedBead[];
        const trappedBeadIds = new Set(trappedBeads.map(bead => bead.id));
        if (absorberOnlyChange && trappedBeads.length > 0) {
            if (!pathsReachAnyComponent(calculatedPaths, trappedBeadIds)) {
                trapBeamSegsRef.current = [];
                setTrapBeamSegments([]);
                if (settings.beamFieldEnabled) {
                    setBeamSegments([]);
                    beamSegsRef.current = [];
                }
            } else {
                scheduleForwardTraceWorkerTraceRef.current({
                    sceneText: serializeScene(components),
                    forwardRayCount: settings.clampedForwardRayCount,
                    sourceRayLimit: settings.clampedForwardRayCount,
                    applyPaths: false,
                    applyBeamSegments: true,
                    includeBeamSegments: true,
                    returnPaths: false,
                });
            }
        } else if (settings.beamFieldEnabled || trappedBeads.length > 0) {
            try {
                beamSegs = (solver ?? new ForwardTracer(components)).buildBeamSegments(calculatedPaths);
            } catch (e) {
                console.warn('Beam field error:', e);
            }
            trapBeamSegsRef.current = trappedBeads.length > 0 ? beamSegs : [];
            setTrapBeamSegments(trappedBeads.length > 0 ? beamSegs : []);
            const visibleBeamSegs = settings.beamFieldEnabled ? beamSegs : [];
            setBeamSegments(visibleBeamSegs);
            beamSegsRef.current = visibleBeamSegs;
        } else {
            trapBeamSegsRef.current = [];
            setTrapBeamSegments([]);
            setBeamSegments([]);
            beamSegsRef.current = [];
        }

        if (sceneChanged) {
            const animationDrivenChange = animStateRef.current.playing && animatorRef.current.channels.length > 0;
            let hasCamera = false;
            for (const comp of components) {
                if (comp instanceof Camera) {
                    comp.markReverseTracerStale();
                    hasCamera = true;
                }
            }
            // Auto-kick reverse-tracer whenever the scene changes and there is a detector,
            // so camera images refresh without the user pressing "Render".
            // PMTs are handled by the dedicated raster effect below; the worker
            // path only produced preview rays and never published a PMT image.
            if (hasCamera && (!reverseTraceRenderingRef.current || isDragging) && !animationDrivenChange) {
                setReverseTracerTrigger(t => t + 1);
            }
            // Check if scan results should be invalidated:
            // Only clear if a NON-ANIMATED component changed since scan completed
            let shouldClearScan = false;
            const animatedTargetIds = new Set(animatorRef.current.channels.map(channel => channel.targetId));
            for (const comp of components) {
                if (comp instanceof Camera && (comp as Camera).scanFrames) {
                    const cam = comp as Camera;
                    const snapshot = cam.scanVersionSnapshot;
                    if (snapshot) {
                        // Check if any component changed since the timeline bake.
                        for (const c of components) {
                            if (animatedTargetIds.has(c.id)) continue;
                            const savedVersion = snapshot.get(c.id);
                            if (savedVersion === undefined || c.version !== savedVersion) {
                                shouldClearScan = true;
                                break;
                            }
                        }
                        if (shouldClearScan) {
                            cam.clearScanFrames();
                            cam.reverseTraceImage = null;
                            cam.forwardImage = null;
                            cam.reverseTracePaths = null;
                        }
                    }
                }
            }
            if (!animationDrivenChange) {
                setReverseTracerPaths([]);
                reverseTracePathsRef.current = [];
            }
        }

    }, [isDragging, opticsFingerprint, rayConfig]);

    // ─── Effect 1b: Reverse tracer — backward trace from ALL detectors, run in a
    // worker pool.  Each worker runs an independent infinite-progressive
    // accumulator with its own RNG; the main thread merges N parallel
    // snapshots per camera by computing a weighted running average across
    // workers (sum(emAvg_w · count_w) / sum(count_w) per pixel).
    const reverseTraceWorkerCount = useMemo(() => {
        if (typeof navigator === 'undefined') return 1;
        const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 2;
        // Keep CPU headroom for synchronous forward tracing and pointer/UI work.
        // Reverse tracing is progressive, so it can afford to use fewer cores.
        return Math.max(1, Math.min(4, cores - 2));
    }, []);
    const reverseTraceWorkersRef = useRef<Worker[]>([]);
    const reverseTraceJobIdRef = useRef<number>(0);
    const componentsRefForReverseTracer = useRef(components);
    componentsRefForReverseTracer.current = components;

    // Per-(camera,worker) latest accumulator snapshot, for the main-thread
    // weighted-merge. Map<cameraId, snapshots[workerId]>.
    const workerAccumRef = useRef<Map<string, { em: Float32Array; ex: Float32Array; cnt: Uint32Array }[]>>(new Map());
    const workerCompleteRef = useRef<Set<number>>(new Set());
    const workerRayCountsRef = useRef<number[]>([]);
    const workerErrorRef = useRef(false);
    const reverseTraceActiveWorkerCountRef = useRef(0);
    const lastReverseTracerInvalidationFingerprintRef = useRef(opticsFingerprint);

    const cancelActiveReverseTracerJob = useCallback((clearPaths: boolean = false) => {
        const previousId = reverseTraceJobIdRef.current;
        if (previousId <= 0) return;
        for (const worker of reverseTraceWorkersRef.current) {
            worker.postMessage({ type: 'cancel', jobId: previousId } as MainToWorker);
        }
        reverseTraceJobIdRef.current = previousId + 1;
        workerAccumRef.current.clear();
        workerCompleteRef.current.clear();
        workerRayCountsRef.current = new Array(reverseTraceWorkersRef.current.length).fill(0);
        workerErrorRef.current = false;
        reverseTraceActiveWorkerCountRef.current = 0;
        reverseTraceDragPendingRef.current = false;
        setReverseTracerRendering(false);
        reverseTraceRenderingRef.current = false;
        setScanAccumProgress(0);
        if (clearPaths) {
            setReverseTracerPaths([]);
            reverseTracePathsRef.current = [];
        }
    }, [setReverseTracerPaths, setReverseTracerRendering, setScanAccumProgress]);

    useEffect(() => {
        if (lastReverseTracerInvalidationFingerprintRef.current === opticsFingerprint) return;
        lastReverseTracerInvalidationFingerprintRef.current = opticsFingerprint;
        // Timeline scan accumulation owns component mutation while it bakes; do
        // not let those internal evaluate/restore steps cancel the scan job.
        if (scanAccumActiveRef.current) return;
        if (animPlaying && animator.channels.length > 0) return;
        cancelActiveReverseTracerJob(false);
    }, [animPlaying, animator.channels.length, cancelActiveReverseTracerJob, opticsFingerprint]);

    // Lazily spin up a pool of workers and wire the merging message handler.
    useEffect(() => {
        const workers: Worker[] = [];
        for (let w = 0; w < reverseTraceWorkerCount; w++) {
            const worker = new Worker(new URL('../physics/reverseTraceWorker.ts', import.meta.url), {
                type: 'module',
            });
            workers.push(worker);

            const onMessage = (e: MessageEvent<WorkerToMain>) => {
                const msg = e.data;
                if (msg.jobId !== reverseTraceJobIdRef.current) return;
                const currentComponents = componentsRefForReverseTracer.current;
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
                        snapshots = new Array(Math.max(1, reverseTraceActiveWorkerCountRef.current || reverseTraceWorkerCount)).fill(null) as { em: Float32Array; ex: Float32Array; cnt: Uint32Array }[];
                        workerAccumRef.current.set(msg.cameraId, snapshots);
                    }
                    const dstX = camera.sensorResX;
                    const dstY = camera.sensorResY;
                    const srcX = msg.resX || dstX;
                    const srcY = msg.resY || dstY;
                    snapshots[w] = {
                        em: resampleFloat32Image(msg.emissionImage, srcX, srcY, dstX, dstY),
                        ex: resampleFloat32Image(msg.excitationImage, srcX, srcY, dstX, dstY),
                        cnt: resampleUint32Image(msg.sampleCountsImage, srcX, srcY, dstX, dstY),
                    };

                    // Merge across all workers we've heard from.  Each worker
                    // sends per-pixel running averages (em/ex) plus its
                    // accumulated sample counts; the global weighted average
                    // is sum(emAvg_w · count_w) / sum(count_w).
                    const pixels = dstX * dstY;
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

                    // Keep the worker-provided sample-terminated paths. Extra
                    // clipping can collapse folded microscopes into a short
                    // marker near the camera.
                    const clipped = msg.paths
                        .map(deserializeRayPath)
                        .filter(path => path.length > 0);
                    camera.reverseTraceImage = merged;
                    camera.forwardImage = mergedEx;
                    const visiblePaths = clipped.length > 0 ? clipped : (camera.reverseTracePaths ?? []);
                    camera.reverseTracePaths = visiblePaths;
                    camera.reverseTraceStale = false;
                    setCameraImageTick(t => t + 1);

                    if (clipped.length > 0) {
                        const currentPaths = reverseTracePathsRef.current || [];
                        const nextPaths = [...currentPaths, ...clipped];
                        if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                        setReverseTracerPaths(nextPaths);
                        reverseTracePathsRef.current = nextPaths;
                    }
                } else if (msg.type === 'pmt-done') {
                    if (w !== 0) return; // PMTs only need to run once.
                    const hydrated = msg.paths.map(deserializeRayPath);
                    const currentPaths = reverseTracePathsRef.current || [];
                    const nextPaths = [...currentPaths, ...hydrated];
                    if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                    setReverseTracerPaths(nextPaths);
                    reverseTracePathsRef.current = nextPaths;
                } else if (msg.type === 'complete') {
                    workerCompleteRef.current.add(w);
                    workerRayCountsRef.current[w] = msg.raysTraced;
                    if (workerCompleteRef.current.size >= Math.max(1, reverseTraceActiveWorkerCountRef.current || reverseTraceWorkerCount)) {
                        setScanAccumProgress(1);
                        setReverseTracerRendering(false);
                        reverseTraceRenderingRef.current = false;
                        if (!isDraggingRef.current) {
                            if (workerErrorRef.current) hapticRef.current.error();
                            else hapticRef.current.done();
                        }
                        if (isDraggingRef.current && reverseTraceDragPendingRef.current) {
                            reverseTraceDragPendingRef.current = false;
                            window.setTimeout(() => setReverseTracerTrigger(t => t + 1), 0);
                        }
                    }
                } else if (msg.type === 'error') {
                    console.warn(`[ReverseTracer worker ${w}] `, msg.message);
                    workerErrorRef.current = true;
                    workerCompleteRef.current.add(w);
                    workerRayCountsRef.current[w] = 0;
                    if (workerCompleteRef.current.size >= Math.max(1, reverseTraceActiveWorkerCountRef.current || reverseTraceWorkerCount)) {
                        setReverseTracerRendering(false);
                        reverseTraceRenderingRef.current = false;
                        setScanAccumProgress(0);
                        if (!isDraggingRef.current) hapticRef.current.error();
                        if (isDraggingRef.current && reverseTraceDragPendingRef.current) {
                            reverseTraceDragPendingRef.current = false;
                            window.setTimeout(() => setReverseTracerTrigger(t => t + 1), 0);
                        }
                    }
                }
            };
            worker.addEventListener('message', onMessage);
        }
        reverseTraceWorkersRef.current = workers;
        window.setTimeout(() => {
            const currentComponents = componentsRefForReverseTracer.current;
            if (currentComponents.some(component => component instanceof Camera)) {
                setReverseTracerTrigger(trigger => trigger + 1);
            }
        }, 0);
        return () => {
            for (const w of workers) w.terminate();
            reverseTraceWorkersRef.current = [];
        };
    }, [
        reverseTraceWorkerCount,
        setCameraImageTick,
        setReverseTracerPaths,
        setReverseTracerRendering,
        setReverseTracerTrigger,
        setScanAccumProgress,
    ]);

    useEffect(() => {
        if (reverseTraceTrigger === 0) return; // Skip initial mount
        const currentComponents = componentsRefForReverseTracer.current;
        if (!currentComponents) return;
        const workers = reverseTraceWorkersRef.current;
        if (workers.length === 0) return;
        const {
            beamFieldEnabled,
            clampedForwardRayCount,
            clampedReversePathCount,
            isDragging,
        } = traceSettingsRef.current;

        const cameras = currentComponents.filter(c => c instanceof Camera) as Camera[];
        if (cameras.length === 0) return;
        const activeWorkerCount = isDragging ? 1 : workers.length;
        reverseTraceActiveWorkerCountRef.current = activeWorkerCount;

        // Cancel any in-flight job on every worker, then assign a fresh id.
        const previousId = reverseTraceJobIdRef.current;
        if (previousId > 0) {
            for (const w of workers) {
                w.postMessage({ type: 'cancel', jobId: previousId } as MainToWorker);
            }
        }
        const newJobId = previousId + 1;
        reverseTraceJobIdRef.current = newJobId;

        // Reset per-worker accumulator state for the new job.
        workerAccumRef.current.clear();
        workerCompleteRef.current.clear();
        workerRayCountsRef.current = new Array(workers.length).fill(0);
        workerErrorRef.current = false;

        setReverseTracerRendering(true);
        reverseTraceRenderingRef.current = true;
        setScanAccumProgress(0);

        const sceneText = serializeScene(currentComponents);
        for (let w = 0; w < activeWorkerCount; w++) {
            const request: MainToWorker = {
                type: 'render',
                jobId: newJobId,
                sceneText,
                cameraIds: cameras.map(c => c.id),
                pmtIds: [],
                reversePathCount: clampedReversePathCount,
                forwardRayCount: clampedForwardRayCount,
                beamFieldEnabled,
                previewMode: isDragging,
                workerId: w,
                workerCount: activeWorkerCount,
            };
            workers[w].postMessage(request);
        }

        return () => {
            for (const w of workers) {
                w.postMessage({ type: 'cancel', jobId: newJobId } as MainToWorker);
            }
        };
    }, [reverseTraceTrigger, setReverseTracerRendering, setScanAccumProgress]);

    // Dragging owns the CPU budget: during drag reverse-tracer is re-kicked in
    // one-worker preview mode; after release it reruns with the full pool.
    const lastDragRef = useRef(isDragging);
    useEffect(() => {
        if (lastDragRef.current === isDragging) return;
        lastDragRef.current = isDragging;
        if (isDragging) {
            for (const comp of components) {
                if (comp instanceof Camera) comp.markReverseTracerStale();
            }
        } else {
            reverseTraceDragPendingRef.current = false;
        }
        setReverseTracerTrigger(t => t + 1);
    }, [components, isDragging, setReverseTracerTrigger]);

    // Ray-count sliders also kick a fresh reverse trace.
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
            if (comp instanceof Camera) comp.markReverseTracerStale();
        }
        setReverseTracerTrigger(t => t + 1);
    }, [clampedForwardRayCount, clampedReversePathCount, components, setReverseTracerTrigger]);

    // ─── Effect 1b'': re-kick reverse-tracer when the page comes back to the
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
            if (animPlaying && animator.channels.length > 0) return;
            for (const comp of components) {
                if (comp instanceof Camera) comp.markReverseTracerStale();
            }
            setReverseTracerTrigger(t => t + 1);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [animPlaying, animator.channels.length, components, setReverseTracerTrigger]);

    useEffect(() => {
        return () => {
            if (!activeScanJobRef.current) return;
            activeScanJobRef.current.cancel(0);
            activeScanJobRef.current = null;
            timelineBakePendingSignatureRef.current = '';
        };
    }, [components, clampedForwardRayCount, clampedReversePathCount, rayConfig.beamFieldEnabled]);

    // ─── Effect 1c: Scan Accumulation — batch Reverse tracer across scan cycle ───
    useEffect(() => {
        if (scanAccumConfig.trigger === 0) return; // Skip initial mount
        const currentComponents = componentsRef.current;
        const currentAnimator = animatorRef.current;
        if (!currentComponents) return;
        if (scanAccumActiveRef.current || activeScanJobRef.current) return;

        const cameras = currentComponents.filter(c => c instanceof Camera) as Camera[];
        if (cameras.length === 0) return;
        if (currentAnimator.channels.length === 0) return;

        const byId = new Map<string, OpticalComponent>();
        for (const c of currentComponents) byId.set(c.id, c);

        const activeChannels = currentAnimator.channels.filter(ch => {
            return byId.has(ch.targetId);
        });
        if (activeChannels.length === 0) return;
        const timelineSignature = animationTimelineSignature(currentComponents, activeChannels);
        lastAnimationTimelineSignatureRef.current = timelineSignature;
        timelineBakePendingSignatureRef.current = timelineSignature;

        const renderComponents = deserializeScene(serializeScene(currentComponents));
        const renderById = new Map<string, OpticalComponent>();
        for (const component of renderComponents) renderById.set(component.id, component);
        const renderActiveChannels = activeChannels.filter(ch => renderById.has(ch.targetId));
        if (renderActiveChannels.length === 0) {
            timelineBakePendingSignatureRef.current = '';
            return;
        }

        const activeWorkerJobId = reverseTraceJobIdRef.current;
        if (activeWorkerJobId > 0) {
            for (const worker of reverseTraceWorkersRef.current) {
                worker.postMessage({ type: 'cancel', jobId: activeWorkerJobId } as MainToWorker);
            }
            reverseTraceJobIdRef.current = activeWorkerJobId + 1;
            workerAccumRef.current.clear();
            workerCompleteRef.current.clear();
            workerRayCountsRef.current = new Array(reverseTraceWorkersRef.current.length).fill(0);
        }

        const steps = Math.max(1, Math.min(128, Math.floor(scanAccumConfigRef.current.steps)));
        const cycleMs = resolveAnimationCycleMs(activeChannels);
        const frameTimesMs = Array.from({ length: steps }, (_, step) =>
            timelineClockMsForStep(step, steps, cycleMs, activeChannels),
        );
        const scanStepOrder = scanSolveOrder(steps, activeChannels);
        const solvedStepIndices: number[] = [];
        const scanBakeStartDelayMs = 100;
        const scanBakeStepDelayMs = 34;
        const scanBakeTimeoutIds: number[] = [];
        const scanBakeRafIds: number[] = [];
        let job: ReturnType<typeof createScheduledRenderJob>;
        const clearScheduledScanBakeSteps = () => {
            for (const id of scanBakeTimeoutIds) window.clearTimeout(id);
            scanBakeTimeoutIds.length = 0;
            for (const id of scanBakeRafIds) window.cancelAnimationFrame(id);
            scanBakeRafIds.length = 0;
        };
        const scheduleScanBakeStep = (callback: () => void, delayMs: number) => {
            const timeoutId = window.setTimeout(() => {
                const timeoutIndex = scanBakeTimeoutIds.indexOf(timeoutId);
                if (timeoutIndex >= 0) scanBakeTimeoutIds.splice(timeoutIndex, 1);
                if (job.isCancelled()) return;
                const rafId = window.requestAnimationFrame(() => {
                    const rafIndex = scanBakeRafIds.indexOf(rafId);
                    if (rafIndex >= 0) scanBakeRafIds.splice(rafIndex, 1);
                    if (!job.isCancelled()) callback();
                });
                scanBakeRafIds.push(rafId);
            }, delayMs);
            scanBakeTimeoutIds.push(timeoutId);
        };

        // The scan bake runs on a cloned scene, so the visible table can keep
        // animating immediately instead of being stepped through the timeline.
        const savedValues = captureAnimatedValues(renderActiveChannels, renderById);

        job = createScheduledRenderJob({
            animator: currentAnimator,
            savedValues,
            scanAccumActiveRef,
            animStateRef,
            setAnimPlaying,
            setReverseTracerRendering,
            setProgress: setScanAccumProgress,
            totalSteps: steps,
            pauseAnimation: false,
            blockLiveScene: false,
        });
        activeScanJobRef.current = job;

        type CameraTimelineState = {
            camera: Camera;
            renderCamera: Camera;
            pixelCount: number;
            frameEmissions: Array<Float32Array | null>;
            frameExcitations: Array<Float32Array | null>;
            framePaths: Array<Ray[][] | null>;
            accumulatedEmission: Float32Array;
            accumulatedExcitation: Float32Array;
            lastPaths: Ray[][];
        };

        const cameraStates: CameraTimelineState[] = [];
        for (const camera of cameras) {
            const renderCamera = renderById.get(camera.id);
            if (!(renderCamera instanceof Camera)) continue;
            const pixelCount = camera.sensorResX * camera.sensorResY;
            camera.clearScanFrames();
            renderCamera.clearScanFrames();
            cameraStates.push({
                camera,
                renderCamera,
                pixelCount,
                frameEmissions: Array<Float32Array | null>(steps).fill(null),
                frameExcitations: Array<Float32Array | null>(steps).fill(null),
                framePaths: Array<Ray[][] | null>(steps).fill(null),
                accumulatedEmission: new Float32Array(pixelCount),
                accumulatedExcitation: new Float32Array(pixelCount),
                lastPaths: [],
            });
        }
        if (cameraStates.length === 0) {
            timelineBakePendingSignatureRef.current = '';
            clearScheduledScanBakeSteps();
            job.cancel(0);
            activeScanJobRef.current = null;
            return;
        }

        const publishScanPlaybackFrame = (fallbackPaths: Ray[][]) => {
            if (animStateRef.current.playing) {
                lastTimelineReverseFrameRef.current = '';
                publishTimelineReversePathsForClockRef.current(currentAnimator.clockMs, componentsRef.current);
                return;
            }
            setReverseTracerPaths(fallbackPaths);
            reverseTracePathsRef.current = fallbackPaths;
        };

        const publishProgressiveFrames = () => {
            const orderedSolvedSteps = [...solvedStepIndices].sort((a, b) => frameTimesMs[a] - frameTimesMs[b]);
            const completedFrameCount = Math.max(1, orderedSolvedSteps.length);
            const visiblePaths: Ray[][] = [];
            for (const state of cameraStates) {
                const runningEmission = new Float32Array(state.pixelCount);
                const runningExcitation = new Float32Array(state.pixelCount);
                for (let i = 0; i < state.pixelCount; i++) {
                    runningEmission[i] = state.accumulatedEmission[i] / completedFrameCount;
                    runningExcitation[i] = state.accumulatedExcitation[i] / completedFrameCount;
                }

                const frameEmissions = orderedSolvedSteps.map(step =>
                    state.frameEmissions[step] ?? new Float32Array(state.pixelCount));
                const frameExcitations = orderedSolvedSteps.map(step =>
                    state.frameExcitations[step] ?? new Float32Array(state.pixelCount));
                const framePaths = orderedSolvedSteps.map(step => state.framePaths[step] ?? []);
                state.camera.scanFrames = frameEmissions;
                state.camera.scanExFrames = frameExcitations;
                state.camera.scanPaths = framePaths;
                state.camera.scanFrameTimesMs = orderedSolvedSteps.map(step => frameTimesMs[step]);
                state.camera.scanFrameCount = frameEmissions.length;
                state.camera.scanCycleMs = cycleMs;
                state.camera.reverseTraceImage = runningEmission;
                state.camera.forwardImage = runningExcitation;
                state.camera.reverseTracePaths = state.lastPaths;
                state.camera.reverseTraceStale = false;
                visiblePaths.push(...state.lastPaths);
            }
            publishScanPlaybackFrame(visiblePaths);
            setCameraImageTick(t => t + 1);
        };

        const runStep = (orderIndex: number) => {
            if (job.isCancelled()) return;

            if (orderIndex >= scanStepOrder.length) {
                const visiblePaths: Ray[][] = [];
                for (const state of cameraStates) {
                    for (let i = 0; i < state.pixelCount; i++) {
                        state.accumulatedEmission[i] /= steps;
                        state.accumulatedExcitation[i] /= steps;
                    }

                    state.camera.scanFrames = state.frameEmissions.map(frame =>
                        frame ?? new Float32Array(state.pixelCount));
                    state.camera.scanExFrames = state.frameExcitations.map(frame =>
                        frame ?? new Float32Array(state.pixelCount));
                    state.camera.scanPaths = state.framePaths.map(paths => paths ?? []);
                    state.camera.scanFrameTimesMs = frameTimesMs;
                    state.camera.scanFrameCount = steps;
                    state.camera.scanCycleMs = cycleMs;
                    state.camera.reverseTraceImage = state.accumulatedEmission;
                    state.camera.forwardImage = state.accumulatedExcitation;
                    state.camera.reverseTracePaths = state.lastPaths;
                    state.camera.reverseTraceStale = false;
                    visiblePaths.push(...state.lastPaths);
                }

                publishScanPlaybackFrame(visiblePaths);
                setCameraImageTick(t => t + 1);
                timelineBakePendingSignatureRef.current = '';
                job.finish(1);
                if (activeScanJobRef.current === job) {
                    activeScanJobRef.current = null;
                }
                for (const state of cameraStates) {
                    state.camera.scanVersionSnapshot = new Map(currentComponents.map(c => [c.id, c.version]));
                }
                timelineReadySignatureRef.current = animationTimelineSignature(currentComponents, activeChannels);
                return;
            }

            const step = scanStepOrder[orderIndex];
            job.advanceStep(orderIndex);
            const clockMs = frameTimesMs[step] ?? 0;
            currentAnimator.evaluateAt(clockMs, renderComponents);

            try {
                syncManagedTrapBeads(renderComponents);
                const sourceRayLimit = Math.max(8, Math.min(traceSettingsRef.current.clampedForwardRayCount, 16));
                const beamSegs = traceStableTableOverlay(renderComponents, () => {
                    const forwardTracer = new ForwardTracer(renderComponents);
                    const sourceRays = stablePreviewSourceRays(
                        createSourceRays(renderComponents, traceSettingsRef.current.clampedForwardRayCount, 'full'),
                        sourceRayLimit,
                    );
                    return forwardTracer.traceWithBeamSegments(sourceRays).beamSegments;
                });

                const reverseTrace = new ReverseTracer(renderComponents, beamSegs);
                const scanVisualizationPathCount = Math.max(16, Math.min(traceSettingsRef.current.clampedReversePathCount, 64));
                for (const state of cameraStates) {
                    const result = reverseTrace.render(state.renderCamera, scanVisualizationPathCount);
                    const frameEm = new Float32Array(state.pixelCount);
                    const frameEx = new Float32Array(state.pixelCount);
                    frameEm.set(result.emissionImage.subarray(0, state.pixelCount));
                    if (result.excitationImage.length >= state.pixelCount) {
                        frameEx.set(result.excitationImage.subarray(0, state.pixelCount));
                    }
                    state.frameEmissions[step] = frameEm;
                    state.frameExcitations[step] = frameEx;

                    for (let i = 0; i < state.pixelCount; i++) {
                        state.accumulatedEmission[i] += frameEm[i];
                        state.accumulatedExcitation[i] += frameEx[i];
                    }
                    state.lastPaths = result.paths;
                    state.framePaths[step] = result.paths;
                }
            } catch (e) {
                console.warn(`Scan accum step ${step} error:`, e);
                for (const state of cameraStates) {
                    state.frameEmissions[step] = new Float32Array(state.pixelCount);
                    state.frameExcitations[step] = new Float32Array(state.pixelCount);
                    state.framePaths[step] = [];
                }
            }

            solvedStepIndices.push(step);
            publishProgressiveFrames();

            job.reportProgress((orderIndex + 1) / steps);

            // Leave a paint/input turn between off-screen frames so playback
            // starts visibly instead of feeling like one long synchronous bake.
            scheduleScanBakeStep(() => runStep(orderIndex + 1), scanBakeStepDelayMs);
        };

        // Let the play click and live table animation paint before the first
        // off-screen ReverseTracer frame starts.
        scheduleScanBakeStep(() => runStep(0), scanBakeStartDelayMs);

        return () => {
            if (timelineBakePendingSignatureRef.current === timelineSignature) {
                timelineBakePendingSignatureRef.current = '';
            }
            clearScheduledScanBakeSteps();
            job.cancel(0);
            if (activeScanJobRef.current === job) {
                activeScanJobRef.current = null;
            }
        };

    }, [
        scanAccumConfig.trigger,
        setAnimPlaying,
        setCameraImageTick,
        setReverseTracerPaths,
        setReverseTracerRendering,
        setScanAccumProgress,
    ]);

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
        const currentComponents = componentsRef.current;
        const currentAnimator = animatorRef.current;
        if (!currentComponents) return;
        const {
            clampedForwardRayCount,
            clampedReversePathCount,
            isDragging,
        } = traceSettingsRef.current;

        const plans = resolvePMTRasterPlans(currentComponents, currentAnimator.channels);
        if (plans.length === 0) return;

        let cancelled = false;
        const timeoutIds: number[] = [];
        const ownsRenderingState = !currentComponents.some(c => c instanceof Camera);
        const workerCount = isDragging ? 1 : reverseTraceWorkerCount;
        const rasterWorkers: Worker[] = [];
        const serializableComponents = currentComponents.filter(c =>
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
            setReverseTracerRendering(true);
            setScanAccumProgress(0);
        }

        for (const plan of plans) {
            const { pmt } = plan;
            const resX = pmt.scanResX;
            const resY = pmt.scanResY;
            const totalPixels = resX * resY;

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
                state.pmt.scanVersionSnapshot = new Map(currentComponents.map(c => [c.id, c.version]));
            }
            setCameraImageTick(t => t + 1);
        };

        const finishFirstFrame = () => {
            if (firstFrameDone) return;
            firstFrameDone = true;
            if (ownsRenderingState) {
                setReverseTracerRendering(false);
                setScanAccumProgress(1);
            }
            if (!completionHapticSent) {
                completionHapticSent = true;
                hapticRef.current.done();
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
            const worker = new Worker(new URL('../physics/reverseTraceWorker.ts', import.meta.url), { type: 'module' });
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
                        setReverseTracerRendering(false);
                        setScanAccumProgress(firstFrameDone ? 1 : 0);
                    }
                    hapticRef.current.error();
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
                    passPaths.push(deserializeRayPath(serializedPath));
                }

                passMessagesDone++;
                if (passMessagesDone >= workerCount * plans.length) {
                    publishImages();
                    if (passPaths.length > 0) {
                        const nextPaths = [...passPaths];
                        if (nextPaths.length > 500) nextPaths.splice(0, nextPaths.length - 500);
                        setReverseTracerPaths(nextPaths);
                        reverseTracePathsRef.current = nextPaths;
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
                setReverseTracerRendering(false);
                setScanAccumProgress(firstFrameDone ? 1 : 0);
            }
        };

    }, [
        isDragging,
        pmtRasterRequestKey,
        reverseTraceWorkerCount,
        scanAccumConfig.trigger,
        setCameraImageTick,
        setReverseTracerPaths,
        setReverseTracerRendering,
        setScanAccumProgress,
    ]);

    // ─── Effect 2: Cheap card beam profile sampling ───
    // Runs whenever ANY component changes (including card drags).
    // Uses cached solver results — no physics re-computation.
    useEffect(() => {
        if (!components) return;

        const beamSegs = beamSegsRef.current;
        const solverPaths = rays.length > 0 ? rays : solverPathsRef.current;
        const s3Paths = reverseTracePathsRef.current;

        // Combine forward and reverse ray paths for card intersection
        const allPaths = s3Paths.length > 0 ? [...solverPaths, ...s3Paths] : solverPaths;

        const cardComps = components.filter(c => c instanceof Card) as Card[];
        for (const card of cardComps) {
            card.beamProfiles = [];

            const invQ = card.rotation.clone().conjugate();

            const hitRays: { ray: Ray; hitLocalPoint: Vector3; t: number }[] = [];

            for (const path of allPaths) {
                for (const ray of path) {
                    if (!ray.isMainRay && !ray.sourceId?.startsWith('reverse_trace_')) continue;


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

            if (hitRays.length === 0 && card.hits.length > 0) {
                for (const hit of card.hits) {
                    if (hit.ray.isBackward || hit.ray.sourceId?.startsWith('reverse_trace_')) continue;
                    hitRays.push({
                        ray: hit.ray,
                        hitLocalPoint: hit.localPoint.clone(),
                        t: 0,
                    });
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
                            if (dirDot < 0.5) continue;

                            if (perpDist < bestDist) {
                                bestDist = perpDist;
                                bestSeg = seg;
                                bestZ = Math.max(0, Math.min(proj, segLen));
                            }
                        }
                    }
                }

                if (!bestSeg || bestDist >= 50) {
                    // Collect for merging below (common for Reverse tracer backward-traced rays)
                    fallbackHits.push({ ray: mainHitRay, hitLocalPoint });
                    continue;
                }

                const { wx: beamWx, wy: beamWy } = segmentBeamEnvelopeRadii(bestSeg, bestZ);


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

            // Merge fallback hits (Reverse tracer backward rays) into ONE averaged profile
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

                // Average throughput of backward rays × fluorescence emission power,
                // or direct intercepted ray power for ordinary forward detector cards.
                let avgThroughput = 0;
                for (const { ray } of fallbackHits) avgThroughput += (ray.intensity ?? 0);
                avgThroughput /= n;
                const power = emissionPower > 0 ? emissionPower * avgThroughput : Math.max(avgThroughput, 1e-9);

                card.beamProfiles.push({
                    wx, wy,
                    wavelength,
                    power,
                    polarization: {
                        x: { re: polXre / polMag, im: polXim / polMag },
                        y: { re: polYre / polMag, im: polYim / polMag }, z: { re: 0, im: 0 }},
                    phase: meanPhase,
                    centerU: meanU,
                    centerV: meanV,
                    tiltU,
                    tiltV
                });
            }
        }
        setCardImageTick(tick => tick + 1);

    }, [components, rayConfig, reverseTracePaths, rays, setCardImageTick]);

    const opticalPlaneRayPaths = useMemo(() => (
        reverseTracePaths.length > 0 ? [...rays, ...reverseTracePaths] : rays
    ), [rays, reverseTracePaths]);

    return (
        <group>
            {/* Beams render at z=0 (default), components at z=2.
                In the top-down view the Z offset is invisible, but the depth buffer
                ensures components appear in front of beam lines. */}
            <RayVisualizer
                paths={rays}
                hideAll={rayConfig.beamFieldEnabled && rayConfig.viewerMode === 'wave'}
                minOpacity={rayConfig.minRayOpacity}
                maxOpacity={rayConfig.maxRayOpacity}
                colorByPolarization={rayConfig.colorByPolarization}
            />
            {reverseTracePaths.length > 0 && (
                <RayVisualizer
                    paths={reverseTracePaths}
                    noBloom={true}
                    hideAll={rayConfig.beamFieldEnabled && rayConfig.viewerMode === 'wave'}
                    minOpacity={rayConfig.minRayOpacity}
                    maxOpacity={rayConfig.maxRayOpacity}
                    colorByPolarization={rayConfig.colorByPolarization}
                />
            )}
            {rayConfig.beamFieldEnabled && rayConfig.viewerMode === 'wave' && (
                <BundleWaveVisualizer beamSegments={beamSegments} reversePaths={reverseTracePaths} />
            )}
            {rayConfig.viewerMode === 'planes' && (
                <OpticalPlaneVisualizer components={components} rayPaths={opticalPlaneRayPaths} />
            )}

            {!uiLocked && <TutorialOverlay />}

            <RayOcclusionLayer>
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
                            <group key={c.id} userData={{ svgExportGroup: c.id, svgExportName: c.name }}>
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
            </RayOcclusionLayer>
        </group>
    );
};
