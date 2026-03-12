import { Vector3 } from 'three';
import type { CameraKernelSnapshot } from './kernelTypes';
import type { PackedCameraKernel, Solver3PacketHeader } from './kernelPackets';
import { SOLVER3_KERNEL_ABI_VERSION } from './kernelPackets';
import type { Solver3WasmModule } from './solver3WasmBackend';

export const PACKED_CAMERA_SAMPLE_STRIDE = 10;

export interface PackedCameraSamples {
    abiVersion: number;
    sampleScalars: Float64Array;
    rowOffsets: Uint32Array;
    sampleCount: number;
}

export interface UnpackedCameraSample {
    px: number;
    py: number;
    origin: Vector3;
    direction: Vector3;
    polarization: { x: number; y: number };
}

function normalizeDirection(x: number, y: number, z: number): [number, number, number] {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
}

function alignOffset(offset: number, alignment: number): number {
    return Math.ceil(offset / alignment) * alignment;
}

export function unpackCameraSample(packet: PackedCameraSamples, sampleIndex: number): UnpackedCameraSample {
    const base = sampleIndex * PACKED_CAMERA_SAMPLE_STRIDE;
    const data = packet.sampleScalars;
    return {
        px: data[base],
        py: data[base + 1],
        origin: new Vector3(data[base + 2], data[base + 3], data[base + 4]),
        direction: new Vector3(data[base + 5], data[base + 6], data[base + 7]),
        polarization: { x: data[base + 8], y: data[base + 9] },
    };
}

export function createJsPackedCameraSamples(camera: CameraKernelSnapshot): PackedCameraSamples {
    const resX = camera.sensorResX;
    const resY = camera.sensorResY;
    const spp = camera.samplesPerPixel;
    const sampleCount = resX * resY * spp;
    const rowOffsets = new Uint32Array(resY + 1);
    const sampleScalars = new Float64Array(sampleCount * PACKED_CAMERA_SAMPLE_STRIDE);
    const sinThetaMax = Math.min(camera.sensorNA, 1.0);

    let sampleIndex = 0;
    for (let py = 0; py < resY; py++) {
        rowOffsets[py] = sampleIndex;
        for (let px = 0; px < resX; px++) {
            const u = ((px + 0.5) / resX - 0.5) * camera.width;
            const v = ((py + 0.5) / resY - 0.5) * camera.height;
            const sensorPoint = camera.position.clone()
                .add(camera.uAxis.clone().multiplyScalar(u))
                .add(camera.vAxis.clone().multiplyScalar(v));

            for (let s = 0; s < spp; s++) {
                const phi = Math.random() * 2 * Math.PI;
                const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
                const [dx, dy, dz] = normalizeDirection(
                    camera.forward.x * cosTheta + camera.uAxis.x * (sinTheta * Math.cos(phi)) + camera.vAxis.x * (sinTheta * Math.sin(phi)),
                    camera.forward.y * cosTheta + camera.uAxis.y * (sinTheta * Math.cos(phi)) + camera.vAxis.y * (sinTheta * Math.sin(phi)),
                    camera.forward.z * cosTheta + camera.uAxis.z * (sinTheta * Math.cos(phi)) + camera.vAxis.z * (sinTheta * Math.sin(phi)),
                );
                const polAngle = Math.random() * Math.PI;

                const base = sampleIndex * PACKED_CAMERA_SAMPLE_STRIDE;
                sampleScalars.set([
                    px,
                    py,
                    sensorPoint.x,
                    sensorPoint.y,
                    sensorPoint.z,
                    dx,
                    dy,
                    dz,
                    Math.cos(polAngle),
                    Math.sin(polAngle),
                ], base);
                sampleIndex += 1;
            }
        }
    }
    rowOffsets[resY] = sampleIndex;

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        sampleScalars,
        rowOffsets,
        sampleCount,
    };
}

export function createPackedCameraSamplesFromWasm(
    module: Solver3WasmModule,
    header: Solver3PacketHeader,
    cameraPacket: PackedCameraKernel,
    seed: bigint = 0x9e3779b97f4a7c15n,
): PackedCameraSamples | null {
    if (!module.memory) return null;
    if (typeof module.exports.solver3_camera_sample_stride !== 'function') return null;
    if (typeof module.exports.solver3_generate_camera_samples !== 'function') return null;
    if (module.exports.solver3_camera_sample_stride() !== PACKED_CAMERA_SAMPLE_STRIDE) return null;

    const resX = cameraPacket.ints[0];
    const resY = cameraPacket.ints[1];
    const spp = cameraPacket.ints[2];
    const sampleCount = resX * resY * spp;
    const headerWords = 5;
    const basisBytes = cameraPacket.basis.length * Float64Array.BYTES_PER_ELEMENT;
    const scalarsBytes = cameraPacket.scalars.length * Float64Array.BYTES_PER_ELEMENT;
    const intsBytes = cameraPacket.ints.length * Uint32Array.BYTES_PER_ELEMENT;
    const rowOffsetsBytes = (resY + 1) * Uint32Array.BYTES_PER_ELEMENT;
    const sampleBytes = sampleCount * PACKED_CAMERA_SAMPLE_STRIDE * Float64Array.BYTES_PER_ELEMENT;
    const alignedBasisPtr = alignOffset(headerWords * Uint32Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
    const alignedScalarsPtr = alignOffset(alignedBasisPtr + basisBytes, Float64Array.BYTES_PER_ELEMENT);
    const alignedIntsPtr = alignOffset(alignedScalarsPtr + scalarsBytes, Uint32Array.BYTES_PER_ELEMENT);
    const alignedRowOffsetsPtr = alignOffset(alignedIntsPtr + intsBytes, Uint32Array.BYTES_PER_ELEMENT);
    const alignedSamplesPtr = alignOffset(alignedRowOffsetsPtr + rowOffsetsBytes, Float64Array.BYTES_PER_ELEMENT);
    const totalAlignedBytes = alignedSamplesPtr + sampleBytes;
    const pagesNeeded = Math.ceil(totalAlignedBytes / 65536);
    const currentPages = module.memory.buffer.byteLength / 65536;
    if (pagesNeeded > currentPages) {
        module.memory.grow(pagesNeeded - currentPages);
    }

    const headerPtr = 0;
    const basisPtr = alignedBasisPtr;
    const scalarsPtr = alignedScalarsPtr;
    const intsPtr = alignedIntsPtr;
    const rowOffsetsPtr = alignedRowOffsetsPtr;
    const samplesPtr = alignedSamplesPtr;

    new Uint32Array(module.memory.buffer, headerPtr, headerWords).set([
        header.abiVersion,
        header.traceComponentCount,
        header.beamBranchCount,
        header.beamSegmentCount,
        header.detectorKind,
    ]);
    new Float64Array(module.memory.buffer, basisPtr, cameraPacket.basis.length).set(cameraPacket.basis);
    new Float64Array(module.memory.buffer, scalarsPtr, cameraPacket.scalars.length).set(cameraPacket.scalars);
    new Uint32Array(module.memory.buffer, intsPtr, cameraPacket.ints.length).set(cameraPacket.ints);

    const generated = module.exports.solver3_generate_camera_samples(
        headerPtr,
        basisPtr,
        scalarsPtr,
        intsPtr,
        rowOffsetsPtr,
        samplesPtr,
        sampleCount,
        seed,
    );
    if (generated !== sampleCount) return null;

    return {
        abiVersion: SOLVER3_KERNEL_ABI_VERSION,
        rowOffsets: new Uint32Array(module.memory.buffer.slice(rowOffsetsPtr, rowOffsetsPtr + rowOffsetsBytes)),
        sampleScalars: new Float64Array(module.memory.buffer.slice(samplesPtr, samplesPtr + sampleBytes)),
        sampleCount,
    };
}
