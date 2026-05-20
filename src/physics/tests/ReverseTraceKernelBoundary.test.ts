import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { ReverseTracer } from '../ReverseTracer';
import { Camera } from '../components/Camera';
import { Sample } from '../components/Sample';
import { GaussianBeamSegment } from '../BeamField';
import {
    PACKED_BEAM_SEGMENT_SCALAR_STRIDE,
    PACKED_COMPONENT_BOUNDS_STRIDE,
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_DETECTOR_BASIS_STRIDE,
    REVERSE_TRACE_KERNEL_ABI_VERSION,
} from '../kernelPackets';
import { Coherence } from '../types';

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

describe('Reverse tracer kernel boundary', () => {
    test('exposes packed trace and beam packets for a future wasm backend', () => {
        const camera = new Camera(4, 4, 'Boundary Camera');
        camera.setPosition(0, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 8;
        camera.sensorResY = 6;
        camera.samplesPerPixel = 3;

        const sample = new Sample('Boundary Sample');
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        const beamSeg = makeSeg(
            new Vector3(0, 20, 0),
            new Vector3(0, -10, 0),
            new Vector3(0, -1, 0),
        );

        const reverseTrace = new ReverseTracer([camera, sample], [[beamSeg]]);
        const context = reverseTrace.getKernelContext();

        expect(context.tracePacket.abiVersion).toBe(REVERSE_TRACE_KERNEL_ABI_VERSION);
        expect(context.tracePacket.componentKinds.length).toBe(2);
        expect(context.tracePacket.sampleComponentIndex).toBe(1);
        expect(context.tracePacket.localToWorldMatrices.length).toBe(2 * PACKED_COMPONENT_MATRIX_STRIDE);
        expect(context.tracePacket.worldToLocalMatrices.length).toBe(2 * PACKED_COMPONENT_MATRIX_STRIDE);
        expect(context.tracePacket.localBounds.length).toBe(2 * PACKED_COMPONENT_BOUNDS_STRIDE);
        expect(context.tracePacket.sampleScalars?.length).toBe(4);

        expect(context.beamPacket.abiVersion).toBe(REVERSE_TRACE_KERNEL_ABI_VERSION);
        expect(Array.from(context.beamPacket.branchOffsets)).toEqual([0, 1]);
        expect(context.beamPacket.segmentScalars.length).toBe(PACKED_BEAM_SEGMENT_SCALAR_STRIDE);
        expect(context.beamPacket.coherenceModes[0]).toBe(1);
    });

    test('keeps detector packets aligned with the live detector basis', () => {
        const camera = new Camera(4, 4, 'Boundary Camera');
        camera.setPosition(10, 25, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 8;
        camera.sensorResY = 6;
        camera.samplesPerPixel = 2;

        const sample = new Sample('Boundary Sample');
        sample.setPosition(10, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        const beamSeg = makeSeg(
            new Vector3(10, 20, 0),
            new Vector3(10, -10, 0),
            new Vector3(0, -1, 0),
        );

        const reverseTrace = new ReverseTracer([camera, sample], [[beamSeg]]);
        const result = reverseTrace.render(camera, 4);
        const context = reverseTrace.getKernelContext();

        expect(result.resX).toBe(8);
        expect(result.resY).toBe(6);
        expect(context.tracePacket.componentIds[0]).toBe(camera.id);
        expect(context.tracePacket.componentIds[1]).toBe(sample.id);
        expect(PACKED_DETECTOR_BASIS_STRIDE).toBe(12);
    });
});
