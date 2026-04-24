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
import { Camera } from './components/Camera';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { createSourceRays } from './SourceRayFactory';
import { Coherence, type Ray } from './types';
import { ensureSolver3WasmLoaded } from './solver3WasmLoader';

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
}

export interface CancelRequest {
    type: 'cancel';
    jobId: number;
}

export type MainToWorker = RenderRequest | CancelRequest;

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

export type WorkerToMain = ProgressMsg | CameraDoneMsg | PMTDoneMsg | CompleteMsg | ErrorMsg;

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
    intensity: number;
    opticalPathLength: number;
    footprintRadius: number;
    coherenceMode: number;
    sourceId?: string;
    isMainRay?: boolean;
    polarization?: Ray['polarization'];
    // Visualisation metadata that the RayVisualizer needs:
    //   interactionDistance tells how far to draw the last (extension) ray,
    //   terminationPoint marks that a ray ends at an explicit point (and the
    //   extension logic should NOT run for that ray).
    interactionDistance?: number;
    terminationPoint?: { x: number; y: number; z: number };
}
export type SerializedPath = SerializedRay[];

function serializeRay(ray: Ray): SerializedRay {
    return {
        origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
        direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
        wavelength: ray.wavelength,
        intensity: ray.intensity,
        opticalPathLength: ray.opticalPathLength,
        footprintRadius: ray.footprintRadius,
        coherenceMode: ray.coherenceMode,
        sourceId: ray.sourceId,
        isMainRay: ray.isMainRay,
        polarization: ray.polarization,
        interactionDistance: ray.interactionDistance,
        terminationPoint: ray.terminationPoint
            ? { x: ray.terminationPoint.x, y: ray.terminationPoint.y, z: ray.terminationPoint.z }
            : undefined,
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

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
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
                polarization: { x: { re: Math.cos(polAngle), im: 0 }, y: { re: Math.sin(polAngle), im: 0 } },
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

        // Solver-3 needs beam segments (even a coarse estimate) to compute
        // illumination at the sample, so we always run a forward pass here —
        // mirror the "traceFullBeamSegments()" fallback used by the main thread.
        const solver1 = new Solver1(components);
        const sourceRays = createSourceRays(components, req.forwardRayCount, 'full');
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
            cam.samplesPerPixel = Math.max(1, req.reversePathCount);
        }

        // Make sure the Rust kernel is available before instantiating Solver3
        // (its backend snapshot happens in the constructor).  If the kernel
        // fails to load we fall through to the JS backend, which Solver3
        // handles automatically.
        await ensureSolver3WasmLoaded();

        const solver3 = new Solver3(components, beamSegs);
        let raysTraced = 0;

        // ── Progressive accumulation: runs FOREVER (until cancelled).  Each
        // round traces ~8 samples/pixel (the kernel's per-round cap) and the
        // running per-pixel average is posted so quality keeps climbing while
        // the user can still interact.  We emit `complete` once after round 1
        // (and after any PMTs) so the UI loading overlay clears; subsequent
        // camera-done messages silently refine the image.
        const accumulators = cameras.map(cam => ({
            pixels: cam.sensorResX * cam.sensorResY,
            emission: new Float32Array(cam.sensorResX * cam.sensorResY),
            excitation: new Float32Array(cam.sensorResX * cam.sensorResY),
            count: new Uint32Array(cam.sensorResX * cam.sensorResY),
        }));

        let firstRoundDone = false;
        let pmtDone = pmts.length === 0;
        let completePosted = false;

        for (let round = 0; ; round++) {
            if (cancelledJobs.has(req.jobId)) return;

            for (let ci = 0; ci < cameras.length; ci++) {
                if (cancelledJobs.has(req.jobId)) return;
                const cam = cameras[ci];
                const gen = solver3.renderGenerator(cam, 32);
                let genResult = gen.next();
                let lastReport = 0;
                while (!genResult.done) {
                    if (cancelledJobs.has(req.jobId)) return;
                    const frac = genResult.value.progress;
                    // Progress reported to the UI tracks the first-pass render
                    // only — the loading overlay hides the instant the first
                    // preview lands.  Later rounds silently refine.
                    const reported = round === 0 ? frac : 1;
                    if (reported - lastReport > 0.02 || frac >= 0.999) {
                        post({ type: 'progress', jobId: req.jobId, cameraIndex: ci, fraction: reported });
                        lastReport = reported;
                        await yieldToEventLoop();
                    }
                    genResult = gen.next();
                }
                const result = genResult.value;
                const acc = accumulators[ci];
                for (let i = 0; i < acc.emission.length; i++) {
                    acc.emission[i] += result.emissionImage[i];
                    acc.excitation[i] += result.excitationImage[i];
                    acc.count[i] += result.sampleCountsImage[i];
                }
                raysTraced += acc.pixels * 8; // cap from sampling layer

                // Snapshot of the running per-pixel average for the main thread.
                const emAvg = new Float32Array(acc.pixels);
                const exAvg = new Float32Array(acc.pixels);
                const cntSnap = new Uint32Array(acc.count);
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
                        emissionImage: emAvg,
                        excitationImage: exAvg,
                        sampleCountsImage: cntSnap,
                        paths: result.paths.map(serializePath),
                    },
                    [emAvg.buffer, exAvg.buffer, cntSnap.buffer],
                );
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
    } else if (msg.type === 'cancel') {
        cancelledJobs.add(msg.jobId);
    }
});
