import { OpticalComponent } from './Component';
import { Camera } from './components/Camera';
import { PMT } from './components/PMT';
import { Sample } from './components/Sample';
import { GaussianBeamSegment } from './Solver2';
import { type Solver3Result } from './solver3Kernel';
import {
    createCameraKernelRequest,
    createDefaultSolver3Backend,
    createPMTKernelRequest,
    createSolver3KernelContext,
    type Solver3KernelBackend,
    type Solver3KernelContext,
} from './solver3Host';
import { Ray } from './types';

export type { Solver3Result } from './solver3Kernel';

/**
 * Compatibility wrapper around the Solver 3 host/kernel boundary.
 *
 * This class preserves the existing object-oriented API used by the UI/tests
 * while routing reverse tracing through a backend interface with explicit
 * scene, detector, and packed-kernel context.
 */
export class Solver3 {
    private readonly scene: OpticalComponent[];
    private readonly beamSegments: GaussianBeamSegment[][];
    private readonly context: Solver3KernelContext;
    private readonly backend: Solver3KernelBackend;

    constructor(scene: OpticalComponent[], beamSegments: GaussianBeamSegment[][]) {
        this.scene = scene;
        this.beamSegments = beamSegments;
        this.context = createSolver3KernelContext(scene, beamSegments);
        this.backend = createDefaultSolver3Backend(this.context);
    }

    render(camera: Camera, maxVisPaths: number = 32): Solver3Result {
        return this.backend.renderCamera(createCameraKernelRequest(camera, maxVisPaths));
    }

    *renderGenerator(
        camera: Camera,
        maxVisPaths: number = 32,
    ): Generator<{ progress: number }, Solver3Result, void> {
        return yield* this.backend.renderCameraGenerator(createCameraKernelRequest(camera, maxVisPaths));
    }

    renderPMTPixel(pmt: PMT): { radiance: number; bestPath: Ray[] | null } {
        return this.backend.renderPMTPixel(createPMTKernelRequest(pmt));
    }

    traceBackward(
        startRay: Ray,
        _sample?: Sample,
        originator?: OpticalComponent,
    ): { radiance: number; path: Ray[]; absorbed: boolean } {
        return this.backend.traceBackward(startRay, originator?.id);
    }

    getScene(): readonly OpticalComponent[] {
        return this.scene;
    }

    getBeamSegments(): readonly GaussianBeamSegment[][] {
        return this.beamSegments;
    }

    getKernelContext(): Readonly<Solver3KernelContext> {
        return this.context;
    }
}
