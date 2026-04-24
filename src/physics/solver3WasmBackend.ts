import {
    createSolver3PacketHeader,
    DETECTOR_KIND_CAMERA,
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
    PACKED_COMPONENT_BOUNDS_STRIDE,
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_DETECTOR_BASIS_STRIDE,
    SOLVER3_KERNEL_ABI_VERSION,
    SOLVER3_KERNEL_STATUS_OK,
    SOLVER3_KERNEL_STATUS_UNIMPLEMENTED,
} from './kernelPackets';
import { createPackedFirstHitHintsFromWasm } from './solver3FirstHitHints';
import { createPackedAnalyticHitsFromWasm } from './solver3AnalyticNarrowPhase';
import { createJsPackedCameraSamples, createPackedCameraSamplesFromWasm } from './solver3Sampling';
import type { Solver3Result } from './solver3Kernel';
import type {
    CameraKernelRequest,
    JsSolver3Backend,
    PMTKernelRequest,
    Solver3KernelBackend,
    Solver3KernelContext,
} from './solver3Host';
import { Ray } from './types';

export interface Solver3WasmExports {
    solver3_kernel_abi_version(): number;
    solver3_trace_component_matrix_stride(): number;
    solver3_trace_component_bounds_stride(): number;
    solver3_detector_basis_stride(): number;
    solver3_beam_segment_scalar_stride(): number;
    solver3_camera_sample_stride?(): number;
    solver3_validate_packet_header(headerPtr: number): number;
    solver3_render_camera_stub?(headerPtr: number): number;
    solver3_generate_camera_samples?(
        headerPtr: number,
        detectorBasisPtr: number,
        detectorScalarsPtr: number,
        detectorIntsPtr: number,
        rowOffsetsPtr: number,
        outputPtr: number,
        sampleCount: number,
        seed: bigint,
    ): number;
    solver3_generate_first_hit_hints?(
        headerPtr: number,
        worldToLocalPtr: number,
        localBoundsPtr: number,
        componentCount: number,
        sampleScalarsPtr: number,
        sampleCount: number,
        maxCandidates: number,
        candidateCountsPtr: number,
        candidateIndicesPtr: number,
        candidateTNearPtr: number,
    ): number;
    solver3_surface_param_stride?(): number;
    solver3_analytic_narrow_phase?(
        headerPtr: number,
        worldToLocalPtr: number,
        localToWorldPtr: number,
        surfaceKindsPtr: number,
        surfaceParamsPtr: number,
        componentCount: number,
        sampleScalarsPtr: number,
        sampleCount: number,
        candidateCountsPtr: number,
        candidateIndicesPtr: number,
        maxCandidates: number,
        outputPtr: number,
    ): number;
}

export interface Solver3WasmModule {
    exports: Solver3WasmExports;
    memory?: WebAssembly.Memory;
}

export interface Solver3WasmValidation {
    ok: boolean;
    reason?: string;
}

function hasRequiredExports(exports: Partial<Solver3WasmExports>): exports is Solver3WasmExports {
    return typeof exports.solver3_kernel_abi_version === 'function'
        && typeof exports.solver3_trace_component_matrix_stride === 'function'
        && typeof exports.solver3_trace_component_bounds_stride === 'function'
        && typeof exports.solver3_detector_basis_stride === 'function'
        && typeof exports.solver3_beam_segment_scalar_stride === 'function'
        && typeof exports.solver3_validate_packet_header === 'function';
}

export function validateSolver3WasmModule(module: Solver3WasmModule | null | undefined): Solver3WasmValidation {
    if (!module || !hasRequiredExports(module.exports)) {
        return { ok: false, reason: 'missing exports' };
    }

    if (module.exports.solver3_kernel_abi_version() !== SOLVER3_KERNEL_ABI_VERSION) {
        return { ok: false, reason: 'abi mismatch' };
    }
    if (module.exports.solver3_trace_component_matrix_stride() !== PACKED_COMPONENT_MATRIX_STRIDE) {
        return { ok: false, reason: 'matrix stride mismatch' };
    }
    if (module.exports.solver3_trace_component_bounds_stride() !== PACKED_COMPONENT_BOUNDS_STRIDE) {
        return { ok: false, reason: 'bounds stride mismatch' };
    }
    if (module.exports.solver3_detector_basis_stride() !== PACKED_DETECTOR_BASIS_STRIDE) {
        return { ok: false, reason: 'detector stride mismatch' };
    }
    if (module.exports.solver3_beam_segment_scalar_stride() !== PACKED_BEAM_SEGMENT_SCALAR_STRIDE) {
        return { ok: false, reason: 'beam stride mismatch' };
    }

    return { ok: true };
}

function writeHeaderToMemory(module: Solver3WasmModule, header: ReturnType<typeof createSolver3PacketHeader>): number | null {
    if (!module.memory) return null;
    const view = new Uint32Array(module.memory.buffer, 0, 5);
    view[0] = header.abiVersion;
    view[1] = header.traceComponentCount;
    view[2] = header.beamBranchCount;
    view[3] = header.beamSegmentCount;
    view[4] = header.detectorKind;
    return 0;
}

export class WasmSolver3Backend implements Solver3KernelBackend {
    constructor(
        private readonly context: Solver3KernelContext,
        private readonly module: Solver3WasmModule,
        private readonly fallback: JsSolver3Backend,
    ) {}

    renderCamera(request: CameraKernelRequest): Solver3Result {
        const header = createSolver3PacketHeader(this.context.tracePacket, this.context.beamPacket, DETECTOR_KIND_CAMERA);
        const headerPtr = writeHeaderToMemory(this.module, header);
        const valid = headerPtr !== null
            ? this.module.exports.solver3_validate_packet_header(headerPtr)
            : SOLVER3_KERNEL_STATUS_UNIMPLEMENTED;

        const packet = (headerPtr !== null && valid === SOLVER3_KERNEL_STATUS_OK)
            ? createPackedCameraSamplesFromWasm(this.module, header, request.packet)
            : null;

        if (packet) {
            const hints = createPackedFirstHitHintsFromWasm(this.module, header, this.context.tracePacket, packet);
            const analytic = hints ? createPackedAnalyticHitsFromWasm(this.module, header, this.context.tracePacket, packet, hints) : null;
            return this.fallback.renderCameraSamples(request, packet, hints ?? undefined, analytic ?? undefined);
        }

        if (typeof this.module.exports.solver3_render_camera_stub === 'function' && headerPtr !== null) {
            const status = this.module.exports.solver3_render_camera_stub(headerPtr);
            if (status !== SOLVER3_KERNEL_STATUS_UNIMPLEMENTED) {
                return this.fallback.renderCamera(request);
            }
        }

        const jsPacket = createJsPackedCameraSamples(request.snapshot);
        return this.fallback.renderCameraSamples(request, jsPacket);
    }

    *renderCameraGenerator(
        request: CameraKernelRequest,
    ): Generator<{ progress: number }, Solver3Result, void> {
        const header = createSolver3PacketHeader(this.context.tracePacket, this.context.beamPacket, DETECTOR_KIND_CAMERA);
        const headerPtr = writeHeaderToMemory(this.module, header);
        const valid = headerPtr !== null
            ? this.module.exports.solver3_validate_packet_header(headerPtr)
            : SOLVER3_KERNEL_STATUS_UNIMPLEMENTED;
        const packet = (headerPtr !== null && valid === SOLVER3_KERNEL_STATUS_OK)
            ? createPackedCameraSamplesFromWasm(this.module, header, request.packet)
            : null;
        const resolvedPacket = packet ?? createJsPackedCameraSamples(request.snapshot);
        const hints = packet
            ? createPackedFirstHitHintsFromWasm(this.module, header, this.context.tracePacket, resolvedPacket)
            : null;
        const analytic = (packet && hints)
            ? createPackedAnalyticHitsFromWasm(this.module, header, this.context.tracePacket, resolvedPacket, hints)
            : null;
        return yield* this.fallback.renderCameraSamplesGenerator(request, resolvedPacket, hints ?? undefined, analytic ?? undefined);
    }

    renderPMTPixel(request: PMTKernelRequest): { radiance: number; bestPath: Ray[] | null } {
        return this.fallback.renderPMTPixel(request);
    }

    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        return this.fallback.traceBackward(startRay, originatorId);
    }
}

export function readRegisteredSolver3WasmModule(): Solver3WasmModule | null {
    const candidate = (globalThis as typeof globalThis & { __BOMB_SOLVER3_WASM__?: Solver3WasmModule }).__BOMB_SOLVER3_WASM__;
    const validation = validateSolver3WasmModule(candidate);
    return validation.ok ? candidate! : null;
}
