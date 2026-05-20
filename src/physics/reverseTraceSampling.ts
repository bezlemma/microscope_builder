import { Vector3 } from 'three';
import type { CameraKernelSnapshot } from './kernelTypes';
import type { PackedCameraKernel, ReverseTracerPacketHeader } from './kernelPackets';
import { REVERSE_TRACE_KERNEL_ABI_VERSION } from './kernelPackets';
import type { ReverseTracerWasmModule } from './reverseTraceWasmBackend';

/**
 * A physical pupil the camera images through. Backward rays from each pixel
 * are aimed at random points on the pupil disc so they actually pass through
 * the imaging aperture — otherwise off-axis pixels miss the pupil entirely
 * with small sensorNA and the final image is blank. If `target` is null, we
 * fall back to uniform-cone sampling around camera.forward.
 */
export interface PupilTarget {
    center: Vector3;
    radius: number;
    axis: Vector3; // outward-facing normal of the pupil disc
}

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

export function createJsPackedCameraSamples(
    camera: CameraKernelSnapshot,
    pupil: PupilTarget | null = null,
    raysPerPass: number = 1024,
    rowWorkerId: number = 0,
    rowWorkerCount: number = 1,
    activePixelMask?: Uint8Array,
): PackedCameraSamples {
    const resX = camera.sensorResX;
    const resY = camera.sensorResY;
    const rowOffsets = new Uint32Array(resY + 1);
    const sinThetaMax = Math.min(camera.sensorNA, 1.0);
    const workerCount = Math.max(1, rowWorkerCount | 0);
    const workerId = Math.max(0, Math.min(workerCount - 1, rowWorkerId | 0));
    const camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z;
    const fX = camera.forward.x, fY = camera.forward.y, fZ = camera.forward.z;
    const uX = camera.uAxis.x, uY = camera.uAxis.y, uZ = camera.uAxis.z;
    const vX = camera.vAxis.x, vY = camera.vAxis.y, vZ = camera.vAxis.z;

    // Build an orthonormal pupil basis if a pupil target is provided.
    let pupilU: Vector3 | null = null;
    let pupilV: Vector3 | null = null;
    if (pupil) {
        const axis = pupil.axis.clone().normalize();
        let hint = camera.uAxis.clone();
        if (Math.abs(hint.dot(axis)) > 0.95) {
            hint = new Vector3(1, 0, 0);
            if (Math.abs(hint.dot(axis)) > 0.95) hint = new Vector3(0, 1, 0);
        }
        pupilU = new Vector3().crossVectors(axis, hint).normalize();
        pupilV = new Vector3().crossVectors(axis, pupilU).normalize();
    }

    // Structured sampling: each pixel gets `raysPerPass / (resX*resY)` samples
    // (rounded up) so the image converges uniformly instead of leaving many
    // pixels with zero samples. Cap at 8/pixel so a full microscope scene
    // finishes in a few seconds on the worker. Users can dial "Reverse/Px"
    // down for instant feedback; turning it up beyond this cap gives no
    // additional samples (we'd need progressive accumulation to benefit).
    const pixelCount = resX * resY;
    const samplesPerPixel = Math.min(8, Math.max(1, Math.ceil(raysPerPass / pixelCount)));
    let assignedPixels = 0;
    for (let py = 0; py < resY; py++) {
        if ((py % workerCount) !== workerId) continue;
        if (!activePixelMask) {
            assignedPixels += resX;
        } else {
            for (let px = 0; px < resX; px++) {
                if (activePixelMask[py * resX + px] !== 0) assignedPixels++;
            }
        }
    }
    const sampleCount = samplesPerPixel * assignedPixels;
    const sampleScalars = new Float64Array(sampleCount * PACKED_CAMERA_SAMPLE_STRIDE);

    let sampleIndex = 0;
    for (let py = 0; py < resY; py++) {
        rowOffsets[py] = sampleIndex;
        if ((py % workerCount) !== workerId) continue;
        for (let px = 0; px < resX; px++) {
            if (activePixelMask && activePixelMask[py * resX + px] === 0) continue;
            for (let s = 0; s < samplesPerPixel; s++) {
                const jitterX = Math.random() - 0.5;
                const jitterY = Math.random() - 0.5;
                const u = ((px + 0.5 + jitterX) / resX - 0.5) * camera.width;
                const v = ((py + 0.5 + jitterY) / resY - 0.5) * camera.height;
                const sensorX = camX + uX * u + vX * v;
                const sensorY = camY + uY * u + vY * v;
                const sensorZ = camZ + uZ * u + vZ * v;

                let dx: number, dy: number, dz: number;

                if (pupil && pupilU && pupilV) {
                    // Sample a uniform point on the pupil disc and aim the
                    // backward ray from the sensor at that point. This guarantees
                    // every ray passes through the imaging pupil, so off-axis
                    // pixels still get coverage (the main fix that restores the
                    // Mickey image in microscope presets).
                    const phiP = Math.random() * 2 * Math.PI;
                    const rP = pupil.radius * Math.sqrt(Math.random());
                    const cosP = Math.cos(phiP);
                    const sinP = Math.sin(phiP);
                    const targetX = pupil.center.x + pupilU.x * (rP * cosP) + pupilV.x * (rP * sinP);
                    const targetY = pupil.center.y + pupilU.y * (rP * cosP) + pupilV.y * (rP * sinP);
                    const targetZ = pupil.center.z + pupilU.z * (rP * cosP) + pupilV.z * (rP * sinP);
                    const dirX = targetX - sensorX;
                    const dirY = targetY - sensorY;
                    const dirZ = targetZ - sensorZ;
                    const len = Math.hypot(dirX, dirY, dirZ) || 1;
                    dx = dirX / len;
                    dy = dirY / len;
                    dz = dirZ / len;
                    // If sensorNA adds extra angular jitter, stir it in around the
                    // pupil-target direction so users can broaden the cone for
                    // quick convergence without breaking pupil coverage.
                    if (sinThetaMax > 1e-6) {
                        const jPhi = Math.random() * 2 * Math.PI;
                        const jSin = sinThetaMax * Math.sqrt(Math.random()) * 0.25;
                        const jCos = Math.sqrt(1 - jSin * jSin);
                        const cosJ = Math.cos(jPhi);
                        const sinJ = Math.sin(jPhi);
                        const nx = dx * jCos + uX * (jSin * cosJ) + vX * (jSin * sinJ);
                        const ny = dy * jCos + uY * (jSin * cosJ) + vY * (jSin * sinJ);
                        const nz = dz * jCos + uZ * (jSin * cosJ) + vZ * (jSin * sinJ);
                        const nLen = Math.hypot(nx, ny, nz) || 1;
                        dx = nx / nLen; dy = ny / nLen; dz = nz / nLen;
                    }
                } else {
                    const phi = Math.random() * 2 * Math.PI;
                    const sinTheta = sinThetaMax * Math.sqrt(Math.random());
                    const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);
                    const cosP = Math.cos(phi);
                    const sinP = Math.sin(phi);
                    const nx = fX * cosTheta + uX * (sinTheta * cosP) + vX * (sinTheta * sinP);
                    const ny = fY * cosTheta + uY * (sinTheta * cosP) + vY * (sinTheta * sinP);
                    const nz = fZ * cosTheta + uZ * (sinTheta * cosP) + vZ * (sinTheta * sinP);
                    const nLen = Math.hypot(nx, ny, nz) || 1;
                    dx = nx / nLen; dy = ny / nLen; dz = nz / nLen;
                }
                const polAngle = Math.random() * Math.PI;

                const base = sampleIndex * PACKED_CAMERA_SAMPLE_STRIDE;
                sampleScalars.set([
                    px,
                    py,
                    sensorX,
                    sensorY,
                    sensorZ,
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
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        sampleScalars,
        rowOffsets,
        sampleCount,
    };
}

export function createPackedCameraSamplesFromWasm(
    module: ReverseTracerWasmModule,
    header: ReverseTracerPacketHeader,
    cameraPacket: PackedCameraKernel,
    seed: bigint = 0x9e3779b97f4a7c15n,
    _passIndex: number = 0,
): PackedCameraSamples | null {
    if (!module.memory) return null;
    if (typeof module.exports.reverse_trace_camera_sample_stride !== 'function') return null;
    if (typeof module.exports.reverse_trace_generate_camera_samples !== 'function') return null;
    if (module.exports.reverse_trace_camera_sample_stride() !== PACKED_CAMERA_SAMPLE_STRIDE) return null;

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

    const generated = module.exports.reverse_trace_generate_camera_samples(
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
        abiVersion: REVERSE_TRACE_KERNEL_ABI_VERSION,
        rowOffsets: new Uint32Array(module.memory.buffer.slice(rowOffsetsPtr, rowOffsetsPtr + rowOffsetsBytes)),
        sampleScalars: new Float64Array(module.memory.buffer.slice(samplesPtr, samplesPtr + sampleBytes)),
        sampleCount,
    };
}
