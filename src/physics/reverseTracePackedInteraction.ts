import { Vector3 } from 'three';
import {
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_INTERACTION_INPUT_STRIDE,
    PACKED_INTERACTION_OUTPUT_STRIDE,
    PACKED_INTERACTION_UNSUPPORTED,
    REVERSE_TRACE_KERNEL_ABI_VERSION,
    type PackedTraceScene,
} from './kernelPackets';
import type { ReverseTracerWasmModule } from './reverseTraceWasmBackend';
import { childRay, type HitRecord, type InteractionResult, type Ray } from './types';

export interface PackedInteractionBackend {
    prepareScene(): void;
    tryInteract(componentIndex: number, ray: Ray, hit: HitRecord): InteractionResult | null;
}

const INTERACTION_STATUS_RAY = 1;
const INTERACTION_STATUS_ABSORBED = 2;

function alignOffset(offset: number, alignment: number): number {
    return Math.ceil(offset / alignment) * alignment;
}

function transformDirection(matrix: Float64Array, offset: number, direction: Vector3): Vector3 {
    const x = matrix[offset] * direction.x + matrix[offset + 4] * direction.y + matrix[offset + 8] * direction.z;
    const y = matrix[offset + 1] * direction.x + matrix[offset + 5] * direction.y + matrix[offset + 9] * direction.z;
    const z = matrix[offset + 2] * direction.x + matrix[offset + 6] * direction.y + matrix[offset + 10] * direction.z;
    return new Vector3(x, y, z).normalize();
}

function scaleComplex(value: { re: number; im: number }, scaleRe: number, scaleIm: number): { re: number; im: number } {
    return {
        re: value.re * scaleRe - value.im * scaleIm,
        im: value.re * scaleIm + value.im * scaleRe,
    };
}

export function createWasmPackedInteractionBackend(
    module: ReverseTracerWasmModule,
    tracePacket: PackedTraceScene,
): PackedInteractionBackend | null {
    if (!module.memory) return null;
    if (typeof module.exports.reverse_trace_apply_packed_interaction !== 'function') return null;
    if (typeof module.exports.reverse_trace_interaction_input_stride !== 'function') return null;
    if (typeof module.exports.reverse_trace_interaction_output_stride !== 'function') return null;
    if (module.exports.reverse_trace_interaction_input_stride() !== PACKED_INTERACTION_INPUT_STRIDE) return null;
    if (module.exports.reverse_trace_interaction_output_stride() !== PACKED_INTERACTION_OUTPUT_STRIDE) return null;

    const headerWords = 5;
    const componentCount = tracePacket.componentKinds.length;
    const localToWorldBytes = tracePacket.localToWorldMatrices.length * Float64Array.BYTES_PER_ELEMENT;
    const interactionKindsBytes = tracePacket.interactionKinds.length * Uint8Array.BYTES_PER_ELEMENT;
    const surfaceParamsBytes = tracePacket.surfaceParams.length * Float64Array.BYTES_PER_ELEMENT;
    const inputBytes = PACKED_INTERACTION_INPUT_STRIDE * Float64Array.BYTES_PER_ELEMENT;
    const outputBytes = PACKED_INTERACTION_OUTPUT_STRIDE * Float64Array.BYTES_PER_ELEMENT;

    const headerPtr = 0;
    const localToWorldPtr = alignOffset(headerWords * Uint32Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
    const interactionKindsPtr = alignOffset(localToWorldPtr + localToWorldBytes, Uint8Array.BYTES_PER_ELEMENT);
    const surfaceParamsPtr = alignOffset(interactionKindsPtr + interactionKindsBytes, Float64Array.BYTES_PER_ELEMENT);
    const inputPtr = alignOffset(surfaceParamsPtr + surfaceParamsBytes, Float64Array.BYTES_PER_ELEMENT);
    const outputPtr = alignOffset(inputPtr + inputBytes, Float64Array.BYTES_PER_ELEMENT);
    const totalBytes = outputPtr + outputBytes;

    let scenePrepared = false;

    function ensureMemory(): void {
        const pagesNeeded = Math.ceil(totalBytes / 65536);
        const currentPages = module.memory!.buffer.byteLength / 65536;
        if (pagesNeeded > currentPages) {
            module.memory!.grow(pagesNeeded - currentPages);
            scenePrepared = false;
        }
    }

    function prepareScene(): void {
        ensureMemory();
        new Uint32Array(module.memory!.buffer, headerPtr, headerWords).set([
            REVERSE_TRACE_KERNEL_ABI_VERSION,
            componentCount,
            0,
            0,
            0,
        ]);
        new Float64Array(module.memory!.buffer, localToWorldPtr, tracePacket.localToWorldMatrices.length)
            .set(tracePacket.localToWorldMatrices);
        new Uint8Array(module.memory!.buffer, interactionKindsPtr, interactionKindsBytes)
            .set(tracePacket.interactionKinds);
        new Float64Array(module.memory!.buffer, surfaceParamsPtr, tracePacket.surfaceParams.length)
            .set(tracePacket.surfaceParams);
        scenePrepared = true;
    }

    function tryInteract(componentIndex: number, ray: Ray, hit: HitRecord): InteractionResult | null {
        if (componentIndex < 0 || componentIndex >= componentCount) return null;
        if (tracePacket.interactionKinds[componentIndex] === PACKED_INTERACTION_UNSUPPORTED) return null;
        if (!scenePrepared) prepareScene();

        const input = new Float64Array(module.memory!.buffer, inputPtr, PACKED_INTERACTION_INPUT_STRIDE);
        const localPoint = hit.localPoint;
        const localNormal = hit.localNormal
            ?? transformDirection(tracePacket.worldToLocalMatrices, componentIndex * PACKED_COMPONENT_MATRIX_STRIDE, hit.normal);
        input[0] = componentIndex;
        input[1] = hit.t;
        input[2] = localPoint.x;
        input[3] = localPoint.y;
        input[4] = localPoint.z;
        input[5] = localNormal.x;
        input[6] = localNormal.y;
        input[7] = localNormal.z;
        input[8] = ray.origin.x;
        input[9] = ray.origin.y;
        input[10] = ray.origin.z;
        input[11] = ray.direction.x;
        input[12] = ray.direction.y;
        input[13] = ray.direction.z;
        input[14] = ray.intensity;
        input[15] = ray.opticalPathLength;

        const output = new Float64Array(module.memory!.buffer, outputPtr, PACKED_INTERACTION_OUTPUT_STRIDE);
        const handled = module.exports.reverse_trace_apply_packed_interaction!(
            headerPtr,
            localToWorldPtr,
            interactionKindsPtr,
            surfaceParamsPtr,
            componentCount,
            inputPtr,
            outputPtr,
        );
        if (handled === 0) return null;
        if (output[0] === INTERACTION_STATUS_ABSORBED) {
            return { rays: [] };
        }
        if (output[0] !== INTERACTION_STATUS_RAY) {
            return null;
        }

        const scaleRe = output[10];
        const scaleIm = output[11];
        return {
            passthrough: output[1] >= 0.5,
            rays: [childRay(ray, {
                origin: new Vector3(output[2], output[3], output[4]),
                direction: new Vector3(output[5], output[6], output[7]).normalize(),
                intensity: output[8],
                opticalPathLength: output[9],
                polarization: {
                    x: scaleComplex(ray.polarization.x, scaleRe, scaleIm),
                    y: scaleComplex(ray.polarization.y, scaleRe, scaleIm),
                    z: scaleComplex(ray.polarization.z, scaleRe, scaleIm),
                },
            })],
        };
    }

    return {
        prepareScene,
        tryInteract,
    };
}
