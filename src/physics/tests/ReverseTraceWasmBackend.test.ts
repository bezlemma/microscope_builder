import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Camera } from '../components/Camera';
import { Aperture } from '../components/Aperture';
import { Mirror } from '../components/Mirror';
import { Sample } from '../components/Sample';
import { ReverseTracer } from '../ReverseTracer';
import { GaussianBeamSegment } from '../BeamField';
import { Coherence, type HitRecord, type Ray } from '../types';
import { createDefaultReverseTracerBackend } from '../reverseTraceHost';
import { createWasmPackedInteractionBackend } from '../reverseTracePackedInteraction';
import {
    readRegisteredReverseTracerWasmModule,
    validateReverseTracerWasmModule,
    WasmReverseTracerBackend,
    type ReverseTracerWasmModule,
} from '../reverseTraceWasmBackend';
import {
    DETECTOR_KIND_CAMERA,
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
    PACKED_COMPONENT_BOUNDS_STRIDE,
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_DETECTOR_BASIS_STRIDE,
    PACKED_INTERACTION_APERTURE,
    PACKED_INTERACTION_INPUT_STRIDE,
    PACKED_INTERACTION_MIRROR,
    PACKED_INTERACTION_OUTPUT_STRIDE,
    PACKED_INTERACTION_UNSUPPORTED,
    REVERSE_TRACE_KERNEL_ABI_VERSION,
    REVERSE_TRACE_KERNEL_STATUS_OK,
    createPackedTraceScene,
    createReverseTracerPacketHeader,
} from '../kernelPackets';
import { createPackedFirstHitHintsFromWasm } from '../reverseTraceFirstHitHints';
import { createJsPackedCameraSamples, createPackedCameraSamplesFromWasm, PACKED_CAMERA_SAMPLE_STRIDE } from '../reverseTraceSampling';

function makeSeg(start: Vector3, end: Vector3, direction: Vector3): GaussianBeamSegment {
    return {
        start: start.clone(),
        end: end.clone(),
        direction: direction.clone().normalize(),
        wavelength: 488e-9,
        power: 1.0,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        refractiveIndex: 1.0,
        coherenceMode: Coherence.Coherent,
        footprintStart: 0.5,
        footprintEnd: 0.5,
    };
}

function makeValidModule(): ReverseTracerWasmModule {
    const memory = new WebAssembly.Memory({ initial: 1 });
    return {
        memory,
        exports: {
            reverse_trace_kernel_abi_version: () => REVERSE_TRACE_KERNEL_ABI_VERSION,
            reverse_trace_trace_component_matrix_stride: () => PACKED_COMPONENT_MATRIX_STRIDE,
            reverse_trace_trace_component_bounds_stride: () => PACKED_COMPONENT_BOUNDS_STRIDE,
            reverse_trace_detector_basis_stride: () => PACKED_DETECTOR_BASIS_STRIDE,
            reverse_trace_beam_segment_scalar_stride: () => PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
            reverse_trace_camera_sample_stride: () => PACKED_CAMERA_SAMPLE_STRIDE,
            reverse_trace_interaction_input_stride: () => PACKED_INTERACTION_INPUT_STRIDE,
            reverse_trace_interaction_output_stride: () => PACKED_INTERACTION_OUTPUT_STRIDE,
            reverse_trace_validate_packet_header: () => REVERSE_TRACE_KERNEL_STATUS_OK,
            reverse_trace_generate_camera_samples: (_headerPtr, _basisPtr, _scalarsPtr, intsPtr, rowOffsetsPtr, outputPtr, sampleCount) => {
                const ints = new Uint32Array(memory.buffer, intsPtr, 3);
                const rowOffsets = new Uint32Array(memory.buffer, rowOffsetsPtr, ints[1] + 1);
                const out = new Float64Array(memory.buffer, outputPtr, sampleCount * PACKED_CAMERA_SAMPLE_STRIDE);
                let index = 0;
                for (let py = 0; py < ints[1]; py++) {
                    rowOffsets[py] = index;
                    for (let px = 0; px < ints[0]; px++) {
                        for (let s = 0; s < ints[2]; s++) {
                            const base = index * PACKED_CAMERA_SAMPLE_STRIDE;
                            out.set([px, py, px, py, 0, 0, -1, 0, 1, 0], base);
                            index += 1;
                        }
                    }
                }
                rowOffsets[ints[1]] = index;
                return index;
            },
            reverse_trace_apply_packed_interaction: (_headerPtr, _localToWorldPtr, interactionKindsPtr, surfaceParamsPtr, _componentCount, inputPtr, outputPtr) => {
                const input = new Float64Array(memory.buffer, inputPtr, PACKED_INTERACTION_INPUT_STRIDE);
                const output = new Float64Array(memory.buffer, outputPtr, PACKED_INTERACTION_OUTPUT_STRIDE);
                output.fill(0);
                const componentIndex = input[0] | 0;
                const interactionKind = new Uint8Array(memory.buffer, interactionKindsPtr + componentIndex, 1)[0];
                if (interactionKind === PACKED_INTERACTION_UNSUPPORTED) return 0;

                if (interactionKind === PACKED_INTERACTION_APERTURE) {
                    const params = new Float64Array(
                        memory.buffer,
                        surfaceParamsPtr + componentIndex * 8 * Float64Array.BYTES_PER_ELEMENT,
                        8,
                    );
                    const rSq = input[2] * input[2] + input[3] * input[3];
                    if (rSq >= params[0] * params[0]) {
                        output[0] = 2;
                        return 1;
                    }
                    output[0] = 1;
                    output[1] = 1;
                    output[2] = input[2];
                    output[3] = input[3];
                    output[4] = input[4];
                    output[5] = input[11];
                    output[6] = input[12];
                    output[7] = input[13];
                    output[8] = input[14];
                    output[9] = input[15] + input[1];
                    output[10] = 1;
                    return 1;
                }

                if (interactionKind === PACKED_INTERACTION_MIRROR) {
                    const dot = input[11] * input[5] + input[12] * input[6] + input[13] * input[7];
                    if (dot >= 0) {
                        output[0] = 2;
                        return 1;
                    }
                    output[0] = 1;
                    output[2] = input[2];
                    output[3] = input[3];
                    output[4] = input[4];
                    output[5] = input[11] - 2 * dot * input[5];
                    output[6] = input[12] - 2 * dot * input[6];
                    output[7] = input[13] - 2 * dot * input[7];
                    output[8] = input[14];
                    output[9] = input[15] + input[1];
                    output[10] = -1;
                    return 1;
                }

                return 0;
            },
            reverse_trace_generate_first_hit_hints: (_headerPtr, _worldToLocalPtr, _localBoundsPtr, componentCount, _sampleScalarsPtr, sampleCount, maxCandidates, countsPtr, indicesPtr, tNearPtr) => {
                const counts = new Uint8Array(memory.buffer, countsPtr, sampleCount);
                const indices = new Int32Array(memory.buffer, indicesPtr, sampleCount * maxCandidates);
                const tNear = new Float64Array(memory.buffer, tNearPtr, sampleCount * maxCandidates);
                for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
                    counts[sampleIndex] = Math.min(componentCount, maxCandidates);
                    for (let candidate = 0; candidate < maxCandidates; candidate++) {
                        const base = sampleIndex * maxCandidates + candidate;
                        indices[base] = candidate < componentCount ? candidate : -1;
                        tNear[base] = sampleIndex + candidate * 0.5;
                    }
                }
                return sampleCount;
            },
        },
    };
}

describe('Reverse tracer wasm backend boundary', () => {
    test('validates registered wasm modules against the packet ABI', () => {
        expect(validateReverseTracerWasmModule(makeValidModule()).ok).toBe(true);
        expect(validateReverseTracerWasmModule({
            exports: {
                ...makeValidModule().exports,
                reverse_trace_kernel_abi_version: () => 999,
            },
        } as ReverseTracerWasmModule).ok).toBe(false);
    });

    test('selects the wasm wrapper when a valid module is registered and still falls back to JS render', () => {
        const camera = new Camera(4, 4, 'Wasm Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 4;
        camera.sensorResY = 4;
        camera.samplesPerPixel = 1;

        const sample = new Sample('Wasm Sample');
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        const reverseTrace = new ReverseTracer([camera, sample], [[makeSeg(
            new Vector3(0, 20, 0),
            new Vector3(0, -10, 0),
            new Vector3(0, -1, 0),
        )]]);
        const context = reverseTrace.getKernelContext();

        const registry = globalThis as typeof globalThis & { __MICROSCOPE_REVERSE_TRACE_WASM__?: ReverseTracerWasmModule };
        const previous = registry.__MICROSCOPE_REVERSE_TRACE_WASM__;
        registry.__MICROSCOPE_REVERSE_TRACE_WASM__ = makeValidModule();

        try {
            expect(readRegisteredReverseTracerWasmModule()).not.toBeNull();
            const backend = createDefaultReverseTracerBackend(context);
            expect(backend instanceof WasmReverseTracerBackend).toBe(true);

            const result = reverseTrace.render(camera, 4);
            expect(result.resX).toBe(4);
            expect(result.resY).toBe(4);
        } finally {
            registry.__MICROSCOPE_REVERSE_TRACE_WASM__ = previous;
        }
    });

    test('reads packed camera samples from a wasm module', () => {
        const camera = new Camera(4, 4, 'Wasm Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 3;
        camera.sensorResY = 2;
        camera.samplesPerPixel = 2;

        const reverseTrace = new ReverseTracer([camera], []);
        const context = reverseTrace.getKernelContext();
        const module = makeValidModule();
        const packet = createPackedCameraSamplesFromWasm(
            module,
            createReverseTracerPacketHeader(context.tracePacket, context.beamPacket, DETECTOR_KIND_CAMERA),
            {
                abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
                id: camera.id,
                name: camera.name,
                basis: new Float64Array([0, 25, 0, 0, -1, 0, -1, 0, 0, 0, 0, -1]),
                scalars: new Float64Array([camera.width, camera.height, camera.sensorNA]),
                ints: new Uint32Array([camera.sensorResX, camera.sensorResY, camera.samplesPerPixel]),
            },
        );

        expect(packet).not.toBeNull();
        expect(packet!.sampleCount).toBe(12);
        expect(Array.from(packet!.rowOffsets)).toEqual([0, 6, 12]);
        expect(packet!.sampleScalars[0]).toBe(0);
        expect(packet!.sampleScalars[1]).toBe(0);
        expect(packet!.sampleScalars[10]).toBe(0);
        expect(packet!.sampleScalars[11]).toBe(0);
    });

    test('JS packed camera sampling can stripe rows across workers', () => {
        const camera = new Camera(4, 4, 'Striped Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 4;
        camera.sensorResY = 4;
        camera.samplesPerPixel = 1;

        const packet = createJsPackedCameraSamples(
            {
                id: camera.id,
                name: camera.name,
                width: camera.width,
                height: camera.height,
                sensorResX: camera.sensorResX,
                sensorResY: camera.sensorResY,
                sensorNA: camera.sensorNA,
                samplesPerPixel: camera.samplesPerPixel,
                position: new Vector3(0, 25, 0),
                forward: new Vector3(0, -1, 0),
                uAxis: new Vector3(-1, 0, 0),
                vAxis: new Vector3(0, 0, -1),
            },
            null,
            16,
            1,
            2,
        );

        expect(packet.sampleCount).toBe(8);
        expect(Array.from(packet.rowOffsets)).toEqual([0, 0, 4, 4, 8]);
        for (let i = 0; i < packet.sampleCount; i++) {
            expect(packet.sampleScalars[i * PACKED_CAMERA_SAMPLE_STRIDE + 1] % 2).toBe(1);
        }
    });

    test('reads first-hit hint packets from a wasm module', () => {
        const camera = new Camera(4, 4, 'Hint Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 2;
        camera.sensorResY = 1;
        camera.samplesPerPixel = 1;

        const sample = new Sample('Hint Sample');
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        const reverseTrace = new ReverseTracer([camera, sample], []);
        const context = reverseTrace.getKernelContext();
        const module = makeValidModule();
        const header = createReverseTracerPacketHeader(context.tracePacket, context.beamPacket, DETECTOR_KIND_CAMERA);
        const cameraSamples = createPackedCameraSamplesFromWasm(module, header, {
            abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
            id: camera.id,
            name: camera.name,
            basis: new Float64Array([0, 25, 0, 0, -1, 0, -1, 0, 0, 0, 0, -1]),
            scalars: new Float64Array([camera.width, camera.height, camera.sensorNA]),
            ints: new Uint32Array([camera.sensorResX, camera.sensorResY, camera.samplesPerPixel]),
        });

        expect(cameraSamples).not.toBeNull();
        const hints = createPackedFirstHitHintsFromWasm(module, header, context.tracePacket, cameraSamples!, 2);

        expect(hints).not.toBeNull();
        expect(Array.from(hints!.candidateCounts)).toEqual([2, 2]);
        expect(Array.from(hints!.candidateIndices)).toEqual([0, 1, 0, 1]);
        expect(Array.from(hints!.candidateTNear)).toEqual([0, 0.5, 1, 1.5]);
    });

    test('wraps wasm packed aperture and mirror interactions as Reverse tracer interaction results', () => {
        const aperture = new Aperture(4, 20, 'Packed Aperture');
        const apertureBackend = createWasmPackedInteractionBackend(makeValidModule(), createPackedTraceScene([aperture]));
        expect(apertureBackend).not.toBeNull();

        const ray: Ray = {
            origin: new Vector3(0, 0, -5),
            direction: new Vector3(0, 0, 1),
            wavelength: 532e-9,
            intensity: 0.5,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
            opticalPathLength: 2,
            footprintRadius: 0.1,
            coherenceMode: Coherence.Incoherent,
        };
        const hit: HitRecord = {
            t: 5,
            point: new Vector3(0, 0, 0),
            normal: new Vector3(0, 0, -1),
            localPoint: new Vector3(0, 0, 0),
            localNormal: new Vector3(0, 0, -1),
        };
        const passed = apertureBackend!.tryInteract(0, ray, hit);
        expect(passed).not.toBeNull();
        expect(passed!.passthrough).toBe(true);
        expect(passed!.rays).toHaveLength(1);
        expect(passed!.rays[0].opticalPathLength).toBe(7);
        expect(passed!.rays[0].intensity).toBe(0.5);

        const blocked = apertureBackend!.tryInteract(0, ray, {
            ...hit,
            localPoint: new Vector3(3, 0, 0),
        });
        expect(blocked).not.toBeNull();
        expect(blocked!.rays).toHaveLength(0);

        const mirror = new Mirror(10, 4, 'Packed Mirror');
        const mirrorBackend = createWasmPackedInteractionBackend(makeValidModule(), createPackedTraceScene([mirror]));
        expect(mirrorBackend).not.toBeNull();
        const mirrored = mirrorBackend!.tryInteract(0, ray, {
            ...hit,
            t: 8,
            localPoint: new Vector3(0, 0, -2),
            localNormal: new Vector3(0, 0, -1),
        });
        expect(mirrored).not.toBeNull();
        expect(mirrored!.passthrough).toBe(false);
        expect(mirrored!.rays[0].direction.z).toBe(-1);
        expect(mirrored!.rays[0].polarization.x.re).toBe(-1);
        expect(mirrored!.rays[0].opticalPathLength).toBe(10);
    });
});
