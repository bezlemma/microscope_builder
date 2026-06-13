import {
    createReverseTracerPacketHeader,
    DETECTOR_KIND_CAMERA,
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
    PACKED_COMPONENT_BOUNDS_STRIDE,
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_DETECTOR_BASIS_STRIDE,
    PACKED_INTERACTION_INPUT_STRIDE,
    PACKED_INTERACTION_OUTPUT_STRIDE,
    REVERSE_TRACE_KERNEL_ABI_VERSION,
    REVERSE_TRACE_KERNEL_STATUS_OK,
    REVERSE_TRACE_KERNEL_STATUS_UNSUPPORTED_ABI,
} from './kernelPackets';
import { createPackedFirstHitHintsFromWasm } from './reverseTraceFirstHitHints';
import { createPackedAnalyticHitsFromWasm } from './reverseTraceAnalyticNarrowPhase';
import { createJsPackedCameraSamples, createPackedCameraSamplesFromWasm } from './reverseTraceSampling';
import type { PMTPixelResult, ReverseTracerResult } from './reverseTraceKernel';
import type {
    CameraKernelRequest,
    JsReverseTracerBackend,
    PMTKernelRequest,
    ReverseTracerKernelBackend,
    ReverseTracerKernelContext,
} from './reverseTraceHost';
import { Ray } from './types';

export interface ReverseTracerWasmExports {
    reverse_trace_kernel_abi_version(): number;
    reverse_trace_trace_component_matrix_stride(): number;
    reverse_trace_trace_component_bounds_stride(): number;
    reverse_trace_detector_basis_stride(): number;
    reverse_trace_beam_segment_scalar_stride(): number;
    reverse_trace_camera_sample_stride?(): number;
    reverse_trace_validate_packet_header(headerPtr: number): number;
    reverse_trace_generate_camera_samples?(
        headerPtr: number,
        detectorBasisPtr: number,
        detectorScalarsPtr: number,
        detectorIntsPtr: number,
        rowOffsetsPtr: number,
        outputPtr: number,
        sampleCount: number,
        seed: bigint,
    ): number;
    reverse_trace_generate_first_hit_hints?(
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
        excludeComponentIndex: number,
    ): number;
    reverse_trace_surface_param_stride?(): number;
    reverse_trace_interaction_input_stride?(): number;
    reverse_trace_interaction_output_stride?(): number;
    reverse_trace_apply_packed_interaction?(
        headerPtr: number,
        localToWorldPtr: number,
        interactionKindsPtr: number,
        surfaceParamsPtr: number,
        componentCount: number,
        inputPtr: number,
        outputPtr: number,
    ): number;
    reverse_trace_analytic_narrow_phase?(
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
        candidateTNearPtr: number,
        maxCandidates: number,
        outputPtr: number,
    ): number;
}

export interface ReverseTracerWasmModule {
    exports: ReverseTracerWasmExports;
    memory?: WebAssembly.Memory;
}

export interface ReverseTracerWasmValidation {
    ok: boolean;
    reason?: string;
}

function hasRequiredExports(exports: Partial<ReverseTracerWasmExports>): exports is ReverseTracerWasmExports {
    return typeof exports.reverse_trace_kernel_abi_version === 'function'
        && typeof exports.reverse_trace_trace_component_matrix_stride === 'function'
        && typeof exports.reverse_trace_trace_component_bounds_stride === 'function'
        && typeof exports.reverse_trace_detector_basis_stride === 'function'
        && typeof exports.reverse_trace_beam_segment_scalar_stride === 'function'
        && typeof exports.reverse_trace_validate_packet_header === 'function';
}

export function validateReverseTracerWasmModule(module: ReverseTracerWasmModule | null | undefined): ReverseTracerWasmValidation {
    if (!module || !hasRequiredExports(module.exports)) {
        return { ok: false, reason: 'missing exports' };
    }

    if (module.exports.reverse_trace_kernel_abi_version() !== REVERSE_TRACE_KERNEL_ABI_VERSION) {
        return { ok: false, reason: 'abi mismatch' };
    }
    if (module.exports.reverse_trace_trace_component_matrix_stride() !== PACKED_COMPONENT_MATRIX_STRIDE) {
        return { ok: false, reason: 'matrix stride mismatch' };
    }
    if (module.exports.reverse_trace_trace_component_bounds_stride() !== PACKED_COMPONENT_BOUNDS_STRIDE) {
        return { ok: false, reason: 'bounds stride mismatch' };
    }
    if (module.exports.reverse_trace_detector_basis_stride() !== PACKED_DETECTOR_BASIS_STRIDE) {
        return { ok: false, reason: 'detector stride mismatch' };
    }
    if (module.exports.reverse_trace_beam_segment_scalar_stride() !== PACKED_BEAM_SEGMENT_SCALAR_STRIDE) {
        return { ok: false, reason: 'beam stride mismatch' };
    }
    if (typeof module.exports.reverse_trace_interaction_input_stride === 'function'
        && module.exports.reverse_trace_interaction_input_stride() !== PACKED_INTERACTION_INPUT_STRIDE) {
        return { ok: false, reason: 'interaction input stride mismatch' };
    }
    if (typeof module.exports.reverse_trace_interaction_output_stride === 'function'
        && module.exports.reverse_trace_interaction_output_stride() !== PACKED_INTERACTION_OUTPUT_STRIDE) {
        return { ok: false, reason: 'interaction output stride mismatch' };
    }

    return { ok: true };
}

function writeHeaderToMemory(module: ReverseTracerWasmModule, header: ReturnType<typeof createReverseTracerPacketHeader>): number | null {
    if (!module.memory) return null;
    const view = new Uint32Array(module.memory.buffer, 0, 5);
    view[0] = header.abiVersion;
    view[1] = header.traceComponentCount;
    view[2] = header.beamBranchCount;
    view[3] = header.beamSegmentCount;
    view[4] = header.detectorKind;
    return 0;
}

export class WasmReverseTracerBackend implements ReverseTracerKernelBackend {
    constructor(
        private readonly context: ReverseTracerKernelContext,
        private readonly module: ReverseTracerWasmModule,
        private readonly fallback: JsReverseTracerBackend,
    ) {}

    renderCamera(request: CameraKernelRequest): ReverseTracerResult {
        const header = createReverseTracerPacketHeader(this.context.tracePacket, this.context.beamPacket, DETECTOR_KIND_CAMERA);
        const headerPtr = writeHeaderToMemory(this.module, header);
        const valid = headerPtr !== null
            ? this.module.exports.reverse_trace_validate_packet_header(headerPtr)
            : REVERSE_TRACE_KERNEL_STATUS_UNSUPPORTED_ABI;

        const useWasmSampler = !request.activePixelMask && (request.rowWorkerCount === undefined || request.rowWorkerCount <= 1);
        const packet = (useWasmSampler && headerPtr !== null && valid === REVERSE_TRACE_KERNEL_STATUS_OK)
            ? createPackedCameraSamplesFromWasm(this.module, header, request.packet)
            : null;

        if (headerPtr !== null && valid === REVERSE_TRACE_KERNEL_STATUS_OK) {
            const resolvedPacket = packet ?? createJsPackedCameraSamples(
                request.snapshot,
                null,
                request.snapshot.sensorResX * request.snapshot.sensorResY * Math.max(1, request.snapshot.samplesPerPixel),
                request.rowWorkerId,
                request.rowWorkerCount,
                request.activePixelMask,
            );
            const originatorIndex = this.context.tracePacket.componentIds.indexOf(request.snapshot.id);
            const hints = createPackedFirstHitHintsFromWasm(this.module, header, this.context.tracePacket, resolvedPacket, undefined, originatorIndex);
            const analytic = hints ? createPackedAnalyticHitsFromWasm(this.module, header, this.context.tracePacket, resolvedPacket, hints) : null;
            return this.fallback.renderCameraSamples(request, resolvedPacket, hints ?? undefined, analytic ?? undefined);
        }

        const jsPacket = createJsPackedCameraSamples(
            request.snapshot,
            null,
            request.snapshot.sensorResX * request.snapshot.sensorResY * Math.max(1, request.snapshot.samplesPerPixel),
            request.rowWorkerId,
            request.rowWorkerCount,
            request.activePixelMask,
        );
        return this.fallback.renderCameraSamples(request, jsPacket);
    }

    *renderCameraGenerator(
        request: CameraKernelRequest,
    ): Generator<{ progress: number }, ReverseTracerResult, void> {
        const header = createReverseTracerPacketHeader(this.context.tracePacket, this.context.beamPacket, DETECTOR_KIND_CAMERA);
        const headerPtr = writeHeaderToMemory(this.module, header);
        const valid = headerPtr !== null
            ? this.module.exports.reverse_trace_validate_packet_header(headerPtr)
            : REVERSE_TRACE_KERNEL_STATUS_UNSUPPORTED_ABI;
        const useWasmSampler = !request.activePixelMask && (request.rowWorkerCount === undefined || request.rowWorkerCount <= 1);
        const packet = (useWasmSampler && headerPtr !== null && valid === REVERSE_TRACE_KERNEL_STATUS_OK)
            ? createPackedCameraSamplesFromWasm(this.module, header, request.packet)
            : null;
        const resolvedPacket = packet ?? createJsPackedCameraSamples(
            request.snapshot,
            null,
            request.snapshot.sensorResX * request.snapshot.sensorResY * Math.max(1, request.snapshot.samplesPerPixel),
            request.rowWorkerId,
            request.rowWorkerCount,
            request.activePixelMask,
        );
        const hints = (headerPtr !== null && valid === REVERSE_TRACE_KERNEL_STATUS_OK)
            ? createPackedFirstHitHintsFromWasm(
                this.module,
                header,
                this.context.tracePacket,
                resolvedPacket,
                undefined,
                this.context.tracePacket.componentIds.indexOf(request.snapshot.id),
            )
            : null;
        const analytic = hints
            ? createPackedAnalyticHitsFromWasm(this.module, header, this.context.tracePacket, resolvedPacket, hints)
            : null;
        return yield* this.fallback.renderCameraSamplesGenerator(request, resolvedPacket, hints ?? undefined, analytic ?? undefined);
    }

    renderPMTPixel(request: PMTKernelRequest): PMTPixelResult {
        return this.fallback.renderPMTPixel(request);
    }

    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        return this.fallback.traceBackward(startRay, originatorId);
    }
}

export function readRegisteredReverseTracerWasmModule(): ReverseTracerWasmModule | null {
    const candidate = (globalThis as typeof globalThis & { __MICROSCOPE_REVERSE_TRACE_WASM__?: ReverseTracerWasmModule }).__MICROSCOPE_REVERSE_TRACE_WASM__;
    const validation = validateReverseTracerWasmModule(candidate);
    return validation.ok ? candidate! : null;
}
