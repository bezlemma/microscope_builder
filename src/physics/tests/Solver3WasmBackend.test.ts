import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Camera } from '../components/Camera';
import { Sample } from '../components/Sample';
import { Solver3 } from '../Solver3';
import { GaussianBeamSegment, initialQ } from '../Solver2';
import { Coherence } from '../types';
import { createDefaultSolver3Backend } from '../solver3Host';
import {
    readRegisteredSolver3WasmModule,
    validateSolver3WasmModule,
    WasmSolver3Backend,
    type Solver3WasmModule,
} from '../solver3WasmBackend';
import {
    DETECTOR_KIND_CAMERA,
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
    PACKED_COMPONENT_BOUNDS_STRIDE,
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_DETECTOR_BASIS_STRIDE,
    SOLVER3_KERNEL_ABI_VERSION,
    SOLVER3_KERNEL_STATUS_OK,
    SOLVER3_KERNEL_STATUS_UNIMPLEMENTED,
    createSolver3PacketHeader,
} from '../kernelPackets';
import { createPackedFirstHitHintsFromWasm } from '../solver3FirstHitHints';
import { createPackedCameraSamplesFromWasm, PACKED_CAMERA_SAMPLE_STRIDE } from '../solver3Sampling';

function makeSeg(start: Vector3, end: Vector3, direction: Vector3): GaussianBeamSegment {
    const wavelength = 488e-9;
    const wavelengthMm = wavelength * 1e3;
    const waist = 2;
    const q0 = initialQ(waist, wavelengthMm);
    const len = start.distanceTo(end);
    return {
        start: start.clone(),
        end: end.clone(),
        direction: direction.clone().normalize(),
        wavelength,
        power: 1.0,
        qx_start: { ...q0 },
        qx_end: { re: q0.re + len, im: q0.im },
        qy_start: { ...q0 },
        qy_end: { re: q0.re + len, im: q0.im },
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        refractiveIndex: 1.0,
        coherenceMode: Coherence.Coherent,
        footprintStart: 0.5,
        footprintEnd: 0.5,
    };
}

function makeValidModule(): Solver3WasmModule {
    const memory = new WebAssembly.Memory({ initial: 1 });
    return {
        memory,
        exports: {
            solver3_kernel_abi_version: () => SOLVER3_KERNEL_ABI_VERSION,
            solver3_trace_component_matrix_stride: () => PACKED_COMPONENT_MATRIX_STRIDE,
            solver3_trace_component_bounds_stride: () => PACKED_COMPONENT_BOUNDS_STRIDE,
            solver3_detector_basis_stride: () => PACKED_DETECTOR_BASIS_STRIDE,
            solver3_beam_segment_scalar_stride: () => PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
            solver3_camera_sample_stride: () => PACKED_CAMERA_SAMPLE_STRIDE,
            solver3_validate_packet_header: () => SOLVER3_KERNEL_STATUS_OK,
            solver3_render_camera_stub: () => SOLVER3_KERNEL_STATUS_UNIMPLEMENTED,
            solver3_generate_camera_samples: (_headerPtr, _basisPtr, _scalarsPtr, intsPtr, rowOffsetsPtr, outputPtr, sampleCount) => {
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
            solver3_generate_first_hit_hints: (_headerPtr, _worldToLocalPtr, _localBoundsPtr, componentCount, _sampleScalarsPtr, sampleCount, maxCandidates, countsPtr, indicesPtr, tNearPtr) => {
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

describe('Solver 3 wasm backend boundary', () => {
    test('validates registered wasm modules against the packet ABI', () => {
        expect(validateSolver3WasmModule(makeValidModule()).ok).toBe(true);
        expect(validateSolver3WasmModule({
            exports: {
                ...makeValidModule().exports,
                solver3_kernel_abi_version: () => 999,
            },
        } as Solver3WasmModule).ok).toBe(false);
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

        const solver3 = new Solver3([camera, sample], [[makeSeg(
            new Vector3(0, 20, 0),
            new Vector3(0, -10, 0),
            new Vector3(0, -1, 0),
        )]]);
        const context = solver3.getKernelContext();

        const registry = globalThis as typeof globalThis & { __BOMB_SOLVER3_WASM__?: Solver3WasmModule };
        const previous = registry.__BOMB_SOLVER3_WASM__;
        registry.__BOMB_SOLVER3_WASM__ = makeValidModule();

        try {
            expect(readRegisteredSolver3WasmModule()).not.toBeNull();
            const backend = createDefaultSolver3Backend(context);
            expect(backend instanceof WasmSolver3Backend).toBe(true);

            const result = solver3.render(camera, 4);
            expect(result.resX).toBe(4);
            expect(result.resY).toBe(4);
        } finally {
            registry.__BOMB_SOLVER3_WASM__ = previous;
        }
    });

    test('reads packed camera samples from a wasm module', () => {
        const camera = new Camera(4, 4, 'Wasm Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 3;
        camera.sensorResY = 2;
        camera.samplesPerPixel = 2;

        const solver3 = new Solver3([camera], []);
        const context = solver3.getKernelContext();
        const module = makeValidModule();
        const packet = createPackedCameraSamplesFromWasm(
            module,
            createSolver3PacketHeader(context.tracePacket, context.beamPacket, DETECTOR_KIND_CAMERA),
            {
                abiVersion: SOLVER3_KERNEL_ABI_VERSION,
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

        const solver3 = new Solver3([camera, sample], []);
        const context = solver3.getKernelContext();
        const module = makeValidModule();
        const header = createSolver3PacketHeader(context.tracePacket, context.beamPacket, DETECTOR_KIND_CAMERA);
        const cameraSamples = createPackedCameraSamplesFromWasm(module, header, {
            abiVersion: SOLVER3_KERNEL_ABI_VERSION,
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
});
