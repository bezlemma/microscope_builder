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
import { GaussianBeamSegment } from './BeamField';
import { createPackedFirstHitHintsJs, type PackedFirstHitHints } from './reverseTraceFirstHitHints';
import { createPackedAnalyticHitsJs, type PackedAnalyticHits } from './reverseTraceAnalyticNarrowPhase';
import { ReverseTracerKernel, type PMTPixelResult, type ReverseTracerResult } from './reverseTraceKernel';
import { readRegisteredReverseTracerWasmModule, WasmReverseTracerBackend } from './reverseTraceWasmBackend';
import { createWasmPackedInteractionBackend, type PackedInteractionBackend } from './reverseTracePackedInteraction';
import { createOptionalWebGpuReverseTracerBackend } from './reverseTraceWebGpuBackend';
import { createJsPackedCameraSamples, type PackedCameraSamples } from './reverseTraceSampling';
import type { BeamFieldSnapshot, CameraKernelSnapshot, PMTKernelSnapshot, TraceSceneSnapshot } from './kernelTypes';
import { Ray } from './types';

export interface ReverseTracerKernelContext {
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

export interface ReverseTracerKernelBackend {
    renderCamera(request: CameraKernelRequest): ReverseTracerResult;
    renderCameraGenerator(request: CameraKernelRequest): Generator<{ progress: number }, ReverseTracerResult, void>;
    renderPMTPixel(request: PMTKernelRequest): PMTPixelResult;
    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean };
}

export function createReverseTracerKernelContext(
    scene: OpticalComponent[],
    beamSegments: GaussianBeamSegment[][],
): ReverseTracerKernelContext {
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

export class JsReverseTracerBackend implements ReverseTracerKernelBackend {
    readonly kernel: ReverseTracerKernel;

    constructor(private readonly context: ReverseTracerKernelContext, packedInteractor?: PackedInteractionBackend) {
        this.kernel = new ReverseTracerKernel(context.traceScene, context.beamField, packedInteractor);
    }

    renderCamera(request: CameraKernelRequest): ReverseTracerResult {
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
        const originatorIndex = this.context.tracePacket.componentIds.indexOf(request.snapshot.id);
        const hints = createPackedFirstHitHintsJs(this.context.tracePacket, samples, undefined, originatorIndex);
        const analytic = createPackedAnalyticHitsJs(this.context.tracePacket, samples, hints);
        return this.kernel.renderPackedCameraSamples(request.snapshot, samples, request.maxVisPaths, hints, analytic);
    }

    *renderCameraGenerator(
        request: CameraKernelRequest,
    ): Generator<{ progress: number }, ReverseTracerResult, void> {
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
        const originatorIndex = this.context.tracePacket.componentIds.indexOf(request.snapshot.id);
        const hints = createPackedFirstHitHintsJs(this.context.tracePacket, samples, undefined, originatorIndex);
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
    ): ReverseTracerResult {
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
    ): Generator<{ progress: number }, ReverseTracerResult, void> {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return yield* this.kernel.renderPackedCameraSamplesGenerator(request.snapshot, samples, request.maxVisPaths, firstHitHints, analyticHits);
    }
}

export function createDefaultReverseTracerBackend(context: ReverseTracerKernelContext): ReverseTracerKernelBackend {
    const wasmModule = readRegisteredReverseTracerWasmModule();
    const packedInteractor = wasmModule
        ? createWasmPackedInteractionBackend(wasmModule, context.tracePacket) ?? undefined
        : undefined;
    const jsBackend = new JsReverseTracerBackend(context, packedInteractor);
    const cpuBackend = wasmModule ? new WasmReverseTracerBackend(context, wasmModule, jsBackend) : jsBackend;
    return createOptionalWebGpuReverseTracerBackend(context, cpuBackend);
}
