/**
 * Solver-3 Web Worker — runs the reverse (backward) ray trace off the main
 * thread so that dragging components, animating the scene, or editing inputs
 * stays smooth while the reverse image is computing.
 *
 * Protocol:
 *   main → worker { type: 'render', jobId, sceneText, cameraIds, pmtIds,
 *                    reversePathCount, forwardRayCount, solver2Enabled,
 *                    emissionWavelengthM }
 *   main → worker { type: 'cancel', jobId }
 *
 *   worker → main { type: 'progress', jobId, cameraIndex, fraction }
 *   worker → main { type: 'camera-done', jobId, cameraId,
 *                    emissionImage, excitationImage, sampleCountsImage, paths }
 *   worker → main { type: 'pmt-done',    jobId, paths }
 *   worker → main { type: 'complete',    jobId, raysTraced }
 *   worker → main { type: 'error',       jobId, message }
 */

import { Vector3 } from 'three';
import { deserializeScene } from '../state/ubzSerializer';
import { Solver1 } from './Solver1';
import { Solver3 } from './Solver3';
import { Solver3Kernel } from './solver3Kernel';
import { Camera } from './components/Camera';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { createSourceRays } from './SourceRayFactory';
import { setProperty } from './PropertyAnimator';
import { createPMTKernelSnapshot, createTraceSceneSnapshot } from './sceneSnapshot';
import { Coherence, type Ray } from './types';
import { ensureSolver3WasmLoaded } from './solver3WasmLoader';
import {
    createProgressiveSamplingState,
    prepareProgressiveActiveMask,
    updateProgressiveSamplingState,
} from './solver3AdaptiveSampling';

// Kick off WASM kernel load as soon as the worker module is evaluated so the
// first render can pick it up via readRegisteredSolver3WasmModule().
ensureSolver3WasmLoaded();

// ─── Message types ────────────────────────────────────────────────────

export interface RenderRequest {
    type: 'render';
    jobId: number;
    sceneText: string;
    cameraIds: string[];
    pmtIds: string[];
    reversePathCount: number;
    forwardRayCount: number;
    solver2Enabled: boolean;
    /** While true the worker uses a coarse preview pass: 16×16 sensor, 1 sample/pixel.
     *  Lets dragging/rotation feel real-time; full quality returns when the flag flips. */
    previewMode?: boolean;
    /** Row-stripe assignment for a worker pool.  A worker only traces rows where
     *  `py % workerCount === workerId`.  When unset, the worker traces every row
     *  (single-worker fallback). */
    workerId?: number;
    workerCount?: number;
}

export interface PMTRasterPlanRequest {
    pmtId: string;
    xTargetId: string;
    xProperty: string;
    xFrom: number;
    xTo: number;
    yTargetId: string;
    yProperty: string;
    yFrom: number;
    yTo: number;
    resX: number;
    resY: number;
    samplesPerPixel: number;
}

export interface PMTRasterRequest {
    type: 'pmt-raster';
    jobId: number;
    sceneText: string;
    plans: PMTRasterPlanRequest[];
    forwardRayCount: number;
    reversePathCount: number;
    workerId: number;
    workerCount: number;
    passIndex: number;
}

export interface CancelRequest {
    type: 'cancel';
    jobId: number;
}

export type MainToWorker = RenderRequest | PMTRasterRequest | CancelRequest;

export interface ProgressMsg {
    type: 'progress';
    jobId: number;
    cameraIndex: number;
    fraction: number;
}

export interface CameraDoneMsg {
    type: 'camera-done';
    jobId: number;
    cameraId: string;
    resX: number;
    resY: number;
    emissionImage: Float32Array;
    excitationImage: Float32Array;
    sampleCountsImage: Uint32Array;
    paths: SerializedPath[];
}

export interface PMTDoneMsg {
    type: 'pmt-done';
    jobId: number;
    paths: SerializedPath[];
}

export interface PMTRasterDoneMsg {
    type: 'pmt-raster-done';
    jobId: number;
    pmtId: string;
    resX: number;
    resY: number;
    workerId: number;
    emissionImage: Float32Array;
    excitationImage: Float32Array;
    sampleCountsImage: Uint32Array;
    paths: SerializedPath[];
    pixelsTraced: number;
    raysTraced: number;
}

export interface CompleteMsg {
    type: 'complete';
    jobId: number;
    raysTraced: number;
}

export interface ErrorMsg {
    type: 'error';
    jobId: number;
    message: string;
}

export type WorkerToMain = ProgressMsg | CameraDoneMsg | PMTDoneMsg | PMTRasterDoneMsg | CompleteMsg | ErrorMsg;

const MIN_CONVERGENCE_ROUNDS = 8;
const STABLE_CONVERGENCE_ROUNDS = 3;
const CONVERGENCE_RELATIVE_EPSILON = 0.003;
const CONVERGENCE_ABSOLUTE_EPSILON = 1e-10;

/**
 * Rays are structured-cloneable once we strip Three.js Vector3 prototypes.
 * Each serialized ray keeps only the raw numeric fields the UI visualisers
 * need: origin/direction (as {x,y,z} tuples), wavelength, intensity,
 * polarization, source id, and interaction bookkeeping.
 */
export interface SerializedRay {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    wavelength: number;
    bandwidth?: number;
    intensity: number;
    powerWeight?: number;
    currentMediumIndex?: number;
    opticalPathLength: number;
    phase?: number;
    footprintRadius: number;
    coherenceMode: number;
    sourceId?: string;
    sourceKind?: Ray['sourceKind'];
    packetLaunchRigor?: Ray['packetLaunchRigor'];
    sourcePosition?: { x: number; y: number; z: number };
    isMainRay?: boolean;
    isBackward?: boolean;
    polarization?: Ray['polarization'];
    // Visualisation metadata that the RayVisualizer needs:
    //   interactionDistance tells how far to draw the last (extension) ray,
    //   terminationPoint marks that a ray ends at an explicit point (and the
    //   extension logic should NOT run for that ray).
    interactionDistance?: number;
    interactionComponentId?: string;
    entryPoint?: { x: number; y: number; z: number };
    internalPath?: { x: number; y: number; z: number }[];
    terminationPoint?: { x: number; y: number; z: number };
    exitSurfaceId?: string;
    suppressVisualization?: boolean;
    suppressOpenTail?: boolean;
}
export type SerializedPath = SerializedRay[];

function serializeRay(ray: Ray): SerializedRay {
    return {
        origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
        direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
        wavelength: ray.wavelength,
        bandwidth: ray.bandwidth,
        intensity: ray.intensity,
        powerWeight: ray.powerWeight,
        currentMediumIndex: ray.currentMediumIndex,
        opticalPathLength: ray.opticalPathLength,
        phase: ray.phase,
        footprintRadius: ray.footprintRadius,
        coherenceMode: ray.coherenceMode,
        sourceId: ray.sourceId,
        sourceKind: ray.sourceKind,
        packetLaunchRigor: ray.packetLaunchRigor,
        sourcePosition: ray.sourcePosition
            ? { x: ray.sourcePosition.x, y: ray.sourcePosition.y, z: ray.sourcePosition.z }
            : undefined,
        isMainRay: ray.isMainRay,
        isBackward: ray.isBackward,
        polarization: ray.polarization,
        interactionDistance: ray.interactionDistance,
        interactionComponentId: ray.interactionComponentId,
        entryPoint: ray.entryPoint
            ? { x: ray.entryPoint.x, y: ray.entryPoint.y, z: ray.entryPoint.z }
            : undefined,
        internalPath: ray.internalPath?.map(p => ({ x: p.x, y: p.y, z: p.z })),
        terminationPoint: ray.terminationPoint
            ? { x: ray.terminationPoint.x, y: ray.terminationPoint.y, z: ray.terminationPoint.z }
            : undefined,
        exitSurfaceId: ray.exitSurfaceId,
        suppressVisualization: ray.suppressVisualization,
        suppressOpenTail: ray.suppressOpenTail,
    };
}

function serializePath(path: Ray[]): SerializedPath {
    return path.map(serializeRay);
}

// ─── Job state ─────────────────────────────────────────────────────────

let activeJobId: number | null = null;
const cancelledJobs = new Set<number>();

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
    (self as unknown as Worker).postMessage(msg, transfer);
}

function makeFloat32Buffer(length: number): Float32Array {
    return new Float32Array(length);
}

function makeUint32Buffer(length: number): Uint32Array {
    return new Uint32Array(length);
}

function transferIfOwned(...arrays: Array<Float32Array | Uint32Array>): Transferable[] {
    const transfers: Transferable[] = [];
    for (const arr of arrays) {
        if (arr.buffer instanceof ArrayBuffer) transfers.push(arr.buffer);
    }
    return transfers;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function updateAccumulatorConvergence(
    acc: {
        pixels: number;
        emission: Float32Array;
        excitation: Float32Array;
        count: Uint32Array;
        lastMeanEmission: Float32Array;
        lastMeanExcitation: Float32Array;
        stableRounds: number;
    },
    round: number,
): boolean {
    let deltaSum = 0;
    let signalSum = 0;
    for (let i = 0; i < acc.pixels; i++) {
        const count = acc.count[i] > 0 ? acc.count[i] : 1;
        const em = acc.emission[i] / count;
        const ex = acc.excitation[i] / count;
        const prevEm = acc.lastMeanEmission[i];
        const prevEx = acc.lastMeanExcitation[i];
        deltaSum += Math.abs(em - prevEm) + Math.abs(ex - prevEx);
        signalSum += Math.abs(em) + Math.abs(ex) + Math.abs(prevEm) + Math.abs(prevEx);
        acc.lastMeanEmission[i] = em;
        acc.lastMeanExcitation[i] = ex;
    }

    if (round + 1 < MIN_CONVERGENCE_ROUNDS) {
        acc.stableRounds = 0;
        return false;
    }

    const relativeDelta = deltaSum / Math.max(signalSum * 0.5, CONVERGENCE_ABSOLUTE_EPSILON);
    const absoluteDelta = deltaSum / Math.max(1, acc.pixels);
    const stable = relativeDelta < CONVERGENCE_RELATIVE_EPSILON
        || absoluteDelta < CONVERGENCE_ABSOLUTE_EPSILON;
    acc.stableRounds = stable ? acc.stableRounds + 1 : 0;
    return acc.stableRounds >= STABLE_CONVERGENCE_ROUNDS;
}

async function runPMTScan(
    req: RenderRequest,
    pmts: PMT[],
    sample: Sample | undefined,
    solver3: Solver3,
    onRays: (n: number) => void,
): Promise<void> {
    if (pmts.length === 0) return;
    const emissionWavelengthM = sample ? sample.getEmissionWavelength() * 1e-9 : 532e-9;
    const allPaths: SerializedPath[] = [];
    for (const pmt of pmts) {
        if (cancelledJobs.has(req.jobId)) return;
        pmt.updateMatrices();
        const pmtPos = pmt.position.clone();
        const pmtW = new Vector3(0, 0, 1).applyQuaternion(pmt.rotation).normalize();
        const pmtU = new Vector3(1, 0, 0).applyQuaternion(pmt.rotation).normalize();
        const pmtV = new Vector3(0, 1, 0).applyQuaternion(pmt.rotation).normalize();

        const sinThetaMax = pmt.sensorNA;
        for (let i = 0; i < req.reversePathCount; i++) {
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
                wavelength: emissionWavelengthM,
                intensity: 1.0,
                polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 }, z: { re: 0, im: 0 }},
                opticalPathLength: 0,
                footprintRadius: 0.1,
                coherenceMode: Coherence.Incoherent,
                sourceId: `pmt_backward_${pmt.id}_${i}`,
            };
            const r = solver3.traceBackward(backwardRay, sample);
            if (r.path.length > 1) allPaths.push(serializePath(r.path));
        }
        onRays(req.reversePathCount);
    }
    post({ type: 'pmt-done', jobId: req.jobId, paths: allPaths });
}

async function runPMTRasterJob(req: PMTRasterRequest): Promise<void> {
    activeJobId = req.jobId;
    try {
        const components = deserializeScene(req.sceneText);
        if (components.length === 0 || req.plans.length === 0) {
            post({ type: 'complete', jobId: req.jobId, raysTraced: 0 });
            return;
        }

        const byId = new Map<string, typeof components[number]>();
        for (const c of components) byId.set(c.id, c);

        let totalRays = 0;
        const workerCount = Math.max(1, req.workerCount | 0);
        const workerId = Math.max(0, Math.min(workerCount - 1, req.workerId | 0));

        for (const plan of req.plans) {
            if (cancelledJobs.has(req.jobId)) return;

            const pmt = byId.get(plan.pmtId) as PMT | undefined;
            const xTarget = byId.get(plan.xTargetId);
            const yTarget = byId.get(plan.yTargetId);
            if (!pmt || !xTarget || !yTarget) continue;

            const pixels = plan.resX * plan.resY;
            const emissionImage = makeFloat32Buffer(pixels);
            const excitationImage = makeFloat32Buffer(pixels);
            const sampleCountsImage = makeUint32Buffer(pixels);
            const paths: SerializedPath[] = [];
            const maxVisPaths = Math.max(0, req.reversePathCount);
            let pixelsTraced = 0;

            for (let yIdx = 0; yIdx < plan.resY; yIdx++) {
                if ((yIdx % workerCount) !== workerId) continue;
                if (cancelledJobs.has(req.jobId)) return;
                const yFrac = plan.resY > 1 ? yIdx / (plan.resY - 1) : 0.5;
                const yVal = plan.yFrom + (plan.yTo - plan.yFrom) * yFrac;
                setProperty(yTarget, plan.yProperty, yVal);

                for (let xIdx = 0; xIdx < plan.resX; xIdx++) {
                    if (cancelledJobs.has(req.jobId)) return;
                    const xFrac = plan.resX > 1 ? xIdx / (plan.resX - 1) : 0.5;
                    const xVal = plan.xFrom + (plan.xTo - plan.xFrom) * xFrac;
                    setProperty(yTarget, plan.yProperty, yVal);
                    setProperty(xTarget, plan.xProperty, xVal);

                    const idx = yIdx * plan.resX + xIdx;
                    try {
                        const sourceRays = createSourceRays(
                            components,
                            Math.max(8, Math.min(req.forwardRayCount, 16)),
                            'full',
                        ).filter(ray => !ray.sourceId?.startsWith('pmt_preview_'));
                        const beamSegs = new Solver1(components).traceWithBeamSegments(sourceRays).beamSegments;
                        const pmtSnapshot = createPMTKernelSnapshot(pmt);
                        pmtSnapshot.samplesPerPixel = Math.max(1, plan.samplesPerPixel | 0);
                        pmtSnapshot.sampleOffset = req.passIndex * pmtSnapshot.samplesPerPixel;
                        const solver3 = new Solver3Kernel(createTraceSceneSnapshot(components), { branches: beamSegs });
                        const { radiance, excitation, bestPath } = solver3.renderPMTPixel(pmtSnapshot);
                        emissionImage[idx] = radiance * pmtSnapshot.samplesPerPixel;
                        excitationImage[idx] = excitation * pmtSnapshot.samplesPerPixel;
                        sampleCountsImage[idx] = pmtSnapshot.samplesPerPixel;
                        if (bestPath && paths.length < maxVisPaths) {
                            paths.push(serializePath(bestPath));
                        }
                        totalRays += pmtSnapshot.samplesPerPixel;
                    } catch {
                        sampleCountsImage[idx] = 1;
                        totalRays += 1;
                    }
                    pixelsTraced++;
                }
                await yieldToEventLoop();
            }

            post(
                {
                    type: 'pmt-raster-done',
                    jobId: req.jobId,
                    pmtId: plan.pmtId,
                    resX: plan.resX,
                    resY: plan.resY,
                    workerId,
                    emissionImage,
                    excitationImage,
                    sampleCountsImage,
                    paths,
                    pixelsTraced,
                    raysTraced: totalRays,
                },
                transferIfOwned(emissionImage, excitationImage, sampleCountsImage),
            );
        }

        post({ type: 'complete', jobId: req.jobId, raysTraced: totalRays });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        post({ type: 'error', jobId: req.jobId, message });
    } finally {
        if (activeJobId === req.jobId) activeJobId = null;
        cancelledJobs.delete(req.jobId);
    }
}

async function runJob(req: RenderRequest) {
    activeJobId = req.jobId;
    try {
        const components = deserializeScene(req.sceneText);
        if (components.length === 0) {
            post({ type: 'complete', jobId: req.jobId, raysTraced: 0 });
            return;
        }

        const cameras = req.cameraIds
            .map(id => components.find(c => c.id === id))
            .filter((c): c is Camera => c instanceof Camera);
        const pmts = req.pmtIds
            .map(id => components.find(c => c.id === id))
            .filter((c): c is PMT => c instanceof PMT && c.hasValidAxes());

        if (cameras.length === 0 && pmts.length === 0) {
            post({ type: 'complete', jobId: req.jobId, raysTraced: 0 });
            return;
        }

        const sample = components.find((c): c is Sample => c instanceof Sample);

        // Preview mode: collapse every Lamp's discrete wavelength list to a
        // single representative band so the inner trace loop runs once per
        // ray instead of N times.
        if (req.previewMode) {
            for (const c of components) {
                const lamp = c as { spectralWavelengths?: number[] };
                if (Array.isArray(lamp.spectralWavelengths) && lamp.spectralWavelengths.length > 1) {
                    lamp.spectralWavelengths = [lamp.spectralWavelengths[Math.floor(lamp.spectralWavelengths.length / 2)]];
                }
            }
        }

        // Solver-3 needs beam segments (even a coarse estimate) to compute
        // illumination at the sample, so we always run a forward pass here —
        // mirror the "traceFullBeamSegments()" fallback used by the main thread.
        const solver1 = new Solver1(components);
        const forwardRays = req.previewMode
            ? Math.max(8, Math.min(req.forwardRayCount, 16))
            : req.forwardRayCount;
        const sourceRays = createSourceRays(components, forwardRays, 'full');
        let beamSegs: ReturnType<typeof solver1.traceWithBeamSegments>['beamSegments'] = [];
        try {
            beamSegs = solver1.traceWithBeamSegments(sourceRays).beamSegments;
        } catch {
            beamSegs = [];
        }

        // Wire the "Reverse/Px" slider to the camera's samples-per-pixel so that
        // increasing the slider actually cuts noise in the image. (The second
        // argument to renderGenerator is just the visualization-path reservoir
        // size, not the ray count.)
        for (const cam of cameras) {
            if (req.previewMode) {
                // Preview mode: blocky 16×16, 1 sample/pixel.  Topology-only
                // feedback while the user is actively dragging.
                cam.sensorResX = 16;
                cam.sensorResY = 16;
                cam.samplesPerPixel = 1;
            } else {
                cam.samplesPerPixel = Math.max(1, req.reversePathCount);
            }
        }

        // Make sure the Rust kernel is available before instantiating Solver3
        // (its backend snapshot happens in the constructor).  If the kernel
        // fails to load we fall through to the JS backend, which Solver3
        // handles automatically.
        await ensureSolver3WasmLoaded();

        const solver3 = new Solver3(components, beamSegs);
        let raysTraced = 0;

        // ── Progressive accumulation: each pass is immediately published as
        // a new running average.  The worker stops once the average has
        // stabilized; difficult scenes are allowed to keep refining rather
        // than being cut off by a fixed pass count.
        const accumulators = cameras.map(cam => ({
            pixels: cam.sensorResX * cam.sensorResY,
            emission: new Float32Array(cam.sensorResX * cam.sensorResY),
            excitation: new Float32Array(cam.sensorResX * cam.sensorResY),
            count: new Uint32Array(cam.sensorResX * cam.sensorResY),
            sampling: createProgressiveSamplingState(cam.sensorResX * cam.sensorResY),
            lastMeanEmission: new Float32Array(cam.sensorResX * cam.sensorResY),
            lastMeanExcitation: new Float32Array(cam.sensorResX * cam.sensorResY),
            stableRounds: 0,
            converged: false,
        }));

        let firstRoundDone = false;
        let pmtDone = pmts.length === 0;
        let completePosted = false;

        for (let round = 0; ; round++) {
            if (cancelledJobs.has(req.jobId)) return;

            for (let ci = 0; ci < cameras.length; ci++) {
                if (cancelledJobs.has(req.jobId)) return;
                const cam = cameras[ci];
                const acc = accumulators[ci];
                const activeMask = prepareProgressiveActiveMask(acc.sampling, round);
                const gen = solver3.renderGenerator(cam, req.previewMode ? 8 : 32, req.workerId, req.workerCount, activeMask);
                let genResult = gen.next();
                let lastReport = 0;
                while (!genResult.done) {
                    if (cancelledJobs.has(req.jobId)) return;
                    const frac = genResult.value.progress;
                    // Progress reported to the UI tracks the first-pass render
                    // only — the loading overlay hides the instant the first
                    // preview lands.  Later rounds silently refine.
                    if (round === 0 && (frac - lastReport > 0.02 || frac >= 0.999)) {
                        const reported = frac;
                        post({ type: 'progress', jobId: req.jobId, cameraIndex: ci, fraction: reported });
                        lastReport = reported;
                        await yieldToEventLoop();
                    }
                    genResult = gen.next();
                }
                const result = genResult.value;
                for (let i = 0; i < acc.emission.length; i++) {
                    acc.emission[i] += result.emissionImage[i];
                    acc.excitation[i] += result.excitationImage[i];
                    acc.count[i] += result.sampleCountsImage[i];
                }
                let tracedThisRound = 0;
                for (const count of result.sampleCountsImage) tracedThisRound += count;
                raysTraced += tracedThisRound;

                // Adaptive sampling throttles only proven dark/quiet pixels,
                // and only for short sleep windows. Signal pixels continue to
                // accumulate every round so the image keeps improving as long
                // as the tab is open.
                updateProgressiveSamplingState(
                    acc.sampling,
                    round,
                    acc.emission,
                    acc.excitation,
                    acc.count,
                    result.sampleCountsImage,
                );

                // Snapshot of the running per-pixel average for the main thread.
                const emAvg = makeFloat32Buffer(acc.pixels);
                const exAvg = makeFloat32Buffer(acc.pixels);
                const cntSnap = makeUint32Buffer(acc.pixels);
                cntSnap.set(acc.count);
                for (let i = 0; i < acc.pixels; i++) {
                    const c = acc.count[i] > 0 ? acc.count[i] : 1;
                    emAvg[i] = acc.emission[i] / c;
                    exAvg[i] = acc.excitation[i] / c;
                }
                post(
                    {
                        type: 'camera-done',
                        jobId: req.jobId,
                        cameraId: cam.id,
                        resX: result.resX,
                        resY: result.resY,
                        emissionImage: emAvg,
                        excitationImage: exAvg,
                        sampleCountsImage: cntSnap,
                        paths: result.paths.map(serializePath),
                    },
                    transferIfOwned(emAvg, exAvg, cntSnap),
                );

                acc.converged = updateAccumulatorConvergence(acc, round);
            }

            firstRoundDone = true;

            // PMTs run once after the first camera round lands.  Keeps the
            // raster image available without delaying the camera preview.
            if (firstRoundDone && !pmtDone) {
                await runPMTScan(req, pmts, sample, solver3, (r) => { raysTraced += r; });
                pmtDone = true;
            }

            if (firstRoundDone && pmtDone && !completePosted) {
                post({ type: 'complete', jobId: req.jobId, raysTraced });
                completePosted = true;
            }

            const allCamerasConverged = accumulators.every(acc => acc.converged);
            if (allCamerasConverged && pmtDone) {
                return;
            }

            // Yield to event loop between rounds so 'cancel' messages land
            // between bounces and the worker stays responsive.
            await yieldToEventLoop();
        }

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        post({ type: 'error', jobId: req.jobId, message });
    } finally {
        if (activeJobId === req.jobId) activeJobId = null;
        cancelledJobs.delete(req.jobId);
    }
}

self.addEventListener('message', (e: MessageEvent<MainToWorker>) => {
    const msg = e.data;
    if (msg.type === 'render') {
        // Fire-and-forget: the async runJob yields to the event loop periodically
        // so 'cancel' messages can land between generator steps.
        void runJob(msg);
    } else if (msg.type === 'pmt-raster') {
        void runPMTRasterJob(msg);
    } else if (msg.type === 'cancel') {
        cancelledJobs.add(msg.jobId);
    }
});
