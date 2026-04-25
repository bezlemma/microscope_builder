import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { PMT } from './components/PMT';
import {
    createPackedBeamField,
    createPackedCameraKernel,
    createPackedPMTKernel,
    createPackedTraceScene,
    type PackedBeamField,
    type PackedCameraKernel,
    type PackedPMTKernel,
    type PackedTraceScene,
} from './kernelPackets';
import {
    createBeamFieldSnapshot,
    createCameraKernelSnapshot,
    createPMTKernelSnapshot,
    createTraceSceneSnapshot,
} from './sceneSnapshot';
import { GaussianBeamSegment } from './Solver2';
import { createPackedFirstHitHintsJs, type PackedFirstHitHints } from './solver3FirstHitHints';
import { createPackedAnalyticHitsJs, type PackedAnalyticHits } from './solver3AnalyticNarrowPhase';
import { Solver3Kernel, type PMTPixelResult, type Solver3Result } from './solver3Kernel';
import { readRegisteredSolver3WasmModule, WasmSolver3Backend } from './solver3WasmBackend';
import { createWasmPackedInteractionBackend, type PackedInteractionBackend } from './solver3PackedInteraction';
import { createOptionalWebGpuSolver3Backend } from './solver3WebGpuBackend';
import { createJsPackedCameraSamples, type PackedCameraSamples } from './solver3Sampling';
import type { BeamFieldSnapshot, CameraKernelSnapshot, PMTKernelSnapshot, TraceSceneSnapshot } from './kernelTypes';
import { Ray } from './types';

export interface Solver3KernelContext {
    traceScene: TraceSceneSnapshot;
    beamField: BeamFieldSnapshot;
    tracePacket: PackedTraceScene;
    beamPacket: PackedBeamField;
}

export interface CameraKernelRequest {
    snapshot: CameraKernelSnapshot;
    packet: PackedCameraKernel;
    maxVisPaths: number;
    rowWorkerId?: number;
    rowWorkerCount?: number;
    activePixelMask?: Uint8Array;
}

export interface PMTKernelRequest {
    snapshot: PMTKernelSnapshot;
    packet: PackedPMTKernel;
}

export interface Solver3KernelBackend {
    renderCamera(request: CameraKernelRequest): Solver3Result;
    renderCameraGenerator(request: CameraKernelRequest): Generator<{ progress: number }, Solver3Result, void>;
    renderPMTPixel(request: PMTKernelRequest): PMTPixelResult;
    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean };
}

export function createSolver3KernelContext(
    scene: OpticalComponent[],
    beamSegments: GaussianBeamSegment[][],
): Solver3KernelContext {
    for (const component of scene) {
        component.updateMatrices();
    }

    return {
        traceScene: createTraceSceneSnapshot(scene),
        beamField: createBeamFieldSnapshot(beamSegments),
        tracePacket: createPackedTraceScene(scene),
        beamPacket: createPackedBeamField(beamSegments),
    };
}

export function createCameraKernelRequest(
    camera: Camera,
    maxVisPaths: number = 32,
    rowWorkerId?: number,
    rowWorkerCount?: number,
    activePixelMask?: Uint8Array,
): CameraKernelRequest {
    return {
        snapshot: createCameraKernelSnapshot(camera),
        packet: createPackedCameraKernel(camera),
        maxVisPaths,
        rowWorkerId,
        rowWorkerCount,
        activePixelMask,
    };
}

export function createPMTKernelRequest(pmt: PMT): PMTKernelRequest {
    return {
        snapshot: createPMTKernelSnapshot(pmt),
        packet: createPackedPMTKernel(pmt),
    };
}

export class JsSolver3Backend implements Solver3KernelBackend {
    readonly kernel: Solver3Kernel;

    constructor(private readonly context: Solver3KernelContext, packedInteractor?: PackedInteractionBackend) {
        this.kernel = new Solver3Kernel(context.traceScene, context.beamField, packedInteractor);
    }

    renderCamera(request: CameraKernelRequest): Solver3Result {
        void request.packet;
        void this.context.beamPacket;
        const samples = createJsPackedCameraSamples(
            request.snapshot,
            null,
            request.snapshot.sensorResX * request.snapshot.sensorResY * Math.max(1, request.snapshot.samplesPerPixel),
            request.rowWorkerId,
            request.rowWorkerCount,
            request.activePixelMask,
        );
        const hints = createPackedFirstHitHintsJs(this.context.tracePacket, samples);
        const analytic = createPackedAnalyticHitsJs(this.context.tracePacket, samples, hints);
        return this.kernel.renderPackedCameraSamples(request.snapshot, samples, request.maxVisPaths, hints, analytic);
    }

    *renderCameraGenerator(
        request: CameraKernelRequest,
    ): Generator<{ progress: number }, Solver3Result, void> {
        void request.packet;
        void this.context.beamPacket;
        const samples = createJsPackedCameraSamples(
            request.snapshot,
            null,
            request.snapshot.sensorResX * request.snapshot.sensorResY * Math.max(1, request.snapshot.samplesPerPixel),
            request.rowWorkerId,
            request.rowWorkerCount,
            request.activePixelMask,
        );
        const hints = createPackedFirstHitHintsJs(this.context.tracePacket, samples);
        const analytic = createPackedAnalyticHitsJs(this.context.tracePacket, samples, hints);
        return yield* this.kernel.renderPackedCameraSamplesGenerator(request.snapshot, samples, request.maxVisPaths, hints, analytic);
    }

    renderPMTPixel(request: PMTKernelRequest): PMTPixelResult {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.renderPMTPixel(request.snapshot);
    }

    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.traceBackward(startRay, originatorId);
    }

    renderCameraSamples(
        request: CameraKernelRequest,
        samples: PackedCameraSamples,
        firstHitHints?: PackedFirstHitHints,
        analyticHits?: PackedAnalyticHits,
    ): Solver3Result {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.renderPackedCameraSamples(request.snapshot, samples, request.maxVisPaths, firstHitHints, analyticHits);
    }

    *renderCameraSamplesGenerator(
        request: CameraKernelRequest,
        samples: PackedCameraSamples,
        firstHitHints?: PackedFirstHitHints,
        analyticHits?: PackedAnalyticHits,
    ): Generator<{ progress: number }, Solver3Result, void> {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return yield* this.kernel.renderPackedCameraSamplesGenerator(request.snapshot, samples, request.maxVisPaths, firstHitHints, analyticHits);
    }
}

export function createDefaultSolver3Backend(context: Solver3KernelContext): Solver3KernelBackend {
    const wasmModule = readRegisteredSolver3WasmModule();
    const packedInteractor = wasmModule
        ? createWasmPackedInteractionBackend(wasmModule, context.tracePacket) ?? undefined
        : undefined;
    const jsBackend = new JsSolver3Backend(context, packedInteractor);
    const cpuBackend = wasmModule ? new WasmSolver3Backend(context, wasmModule, jsBackend) : jsBackend;
    return createOptionalWebGpuSolver3Backend(context, cpuBackend);
}
