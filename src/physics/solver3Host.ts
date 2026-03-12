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
import type { PackedFirstHitHints } from './solver3FirstHitHints';
import { Solver3Kernel, type Solver3Result } from './solver3Kernel';
import { readRegisteredSolver3WasmModule, WasmSolver3Backend } from './solver3WasmBackend';
import type { PackedCameraSamples } from './solver3Sampling';
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
}

export interface PMTKernelRequest {
    snapshot: PMTKernelSnapshot;
    packet: PackedPMTKernel;
}

export interface Solver3KernelBackend {
    renderCamera(request: CameraKernelRequest): Solver3Result;
    renderCameraGenerator(request: CameraKernelRequest): Generator<{ progress: number }, Solver3Result, void>;
    renderPMTPixel(request: PMTKernelRequest): { radiance: number; bestPath: Ray[] | null };
    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; path: Ray[]; absorbed: boolean };
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

export function createCameraKernelRequest(camera: Camera, maxVisPaths: number = 32): CameraKernelRequest {
    return {
        snapshot: createCameraKernelSnapshot(camera),
        packet: createPackedCameraKernel(camera),
        maxVisPaths,
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

    constructor(private readonly context: Solver3KernelContext) {
        this.kernel = new Solver3Kernel(context.traceScene, context.beamField);
    }

    renderCamera(request: CameraKernelRequest): Solver3Result {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.render(request.snapshot, request.maxVisPaths);
    }

    *renderCameraGenerator(
        request: CameraKernelRequest,
    ): Generator<{ progress: number }, Solver3Result, void> {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return yield* this.kernel.renderGenerator(request.snapshot, request.maxVisPaths);
    }

    renderPMTPixel(request: PMTKernelRequest): { radiance: number; bestPath: Ray[] | null } {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.renderPMTPixel(request.snapshot);
    }

    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; path: Ray[]; absorbed: boolean } {
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.traceBackward(startRay, originatorId);
    }

    renderCameraSamples(
        request: CameraKernelRequest,
        samples: PackedCameraSamples,
        firstHitHints?: PackedFirstHitHints,
    ): Solver3Result {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return this.kernel.renderPackedCameraSamples(request.snapshot, samples, request.maxVisPaths, firstHitHints);
    }

    *renderCameraSamplesGenerator(
        request: CameraKernelRequest,
        samples: PackedCameraSamples,
        firstHitHints?: PackedFirstHitHints,
    ): Generator<{ progress: number }, Solver3Result, void> {
        void request.packet;
        void this.context.tracePacket;
        void this.context.beamPacket;
        return yield* this.kernel.renderPackedCameraSamplesGenerator(request.snapshot, samples, request.maxVisPaths, firstHitHints);
    }
}

export function createDefaultSolver3Backend(context: Solver3KernelContext): Solver3KernelBackend {
    const jsBackend = new JsSolver3Backend(context);
    const wasmModule = readRegisteredSolver3WasmModule();
    if (!wasmModule) return jsBackend;
    return new WasmSolver3Backend(context, wasmModule, jsBackend);
}
