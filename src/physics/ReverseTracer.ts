import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { GaussianBeamSegment } from './BeamField';
import { type PMTPixelResult, type ReverseTracerResult } from './reverseTraceKernel';
import {
    createCameraKernelRequest,
    createDefaultReverseTracerBackend,
    createPMTKernelRequest,
    createReverseTracerKernelContext,
    type ReverseTracerKernelBackend,
    type ReverseTracerKernelContext,
} from './reverseTraceHost';
import { Ray } from './types';

export type { ReverseTracerResult } from './reverseTraceKernel';

/**
 * Compatibility wrapper around the Reverse tracer host/kernel boundary.
 *
 * This class preserves the existing object-oriented API used by the UI/tests
 * while routing reverse tracing through a backend interface with explicit
 * scene, detector, and packed-kernel context.
 */
export class ReverseTracer {
    private readonly scene: OpticalComponent[];
    private readonly beamSegments: GaussianBeamSegment[][];
    private readonly context: ReverseTracerKernelContext;
    private readonly backend: ReverseTracerKernelBackend;

    constructor(scene: OpticalComponent[], beamSegments: GaussianBeamSegment[][]) {
        this.scene = scene;
        this.beamSegments = beamSegments;
        this.context = createReverseTracerKernelContext(scene, beamSegments);
        this.backend = createDefaultReverseTracerBackend(this.context);
    }

    render(camera: Camera, maxVisPaths: number = 32, rowWorkerId?: number, rowWorkerCount?: number, activePixelMask?: Uint8Array): ReverseTracerResult {
        return this.backend.renderCamera(createCameraKernelRequest(camera, maxVisPaths, rowWorkerId, rowWorkerCount, activePixelMask));
    }

    *renderGenerator(
        camera: Camera,
        maxVisPaths: number = 32,
        rowWorkerId?: number,
        rowWorkerCount?: number,
        activePixelMask?: Uint8Array,
    ): Generator<{ progress: number }, ReverseTracerResult, void> {
        return yield* this.backend.renderCameraGenerator(createCameraKernelRequest(camera, maxVisPaths, rowWorkerId, rowWorkerCount, activePixelMask));
    }

    renderPMTPixel(pmt: PMT): PMTPixelResult {
        return this.backend.renderPMTPixel(createPMTKernelRequest(pmt));
    }

    traceBackward(
        startRay: Ray,
        _sample?: Sample,
        originator?: OpticalComponent,
    ): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        return this.backend.traceBackward(startRay, originator?.id);
    }

    getScene(): readonly OpticalComponent[] {
        return this.scene;
    }

    getBeamSegments(): readonly GaussianBeamSegment[][] {
        return this.beamSegments;
    }

    getKernelContext(): Readonly<ReverseTracerKernelContext> {
        return this.context;
    }
}
