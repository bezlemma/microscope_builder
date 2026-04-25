import type {
    PackedTraceScene,
} from './kernelPackets';
import {
    PACKED_COMPONENT_MATRIX_STRIDE,
    PACKED_INTERACTION_APERTURE,
    PACKED_INTERACTION_MIRROR,
    PACKED_SURFACE_PARAM_STRIDE,
} from './kernelPackets';
import type {
    CameraKernelRequest,
    PMTKernelRequest,
    Solver3KernelBackend,
    Solver3KernelContext,
} from './solver3Host';
import type { PMTPixelResult, Solver3Result } from './solver3Kernel';
import type { Ray } from './types';

type NavigatorGpuLike = Navigator & {
    gpu?: GPU;
};

type WebGpuFlagRegistry = typeof globalThis & {
    __MICROSCOPE_SOLVER3_ENABLE_WEBGPU__?: boolean;
};

export const SOLVER3_WEBGPU_INTERACTION_WGSL = `
struct SceneHeader {
    component_count: u32,
    matrix_stride: u32,
    surface_param_stride: u32,
    reserved: u32,
};

@group(0) @binding(0) var<storage, read> header: SceneHeader;
@group(0) @binding(1) var<storage, read> local_to_world: array<mat4x4<f32>>;
@group(0) @binding(2) var<storage, read> interaction_kinds: array<u32>;
@group(0) @binding(3) var<storage, read> surface_params: array<vec4<f32>>;

fn reflect_dir(direction: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    return normalize(direction - 2.0 * dot(direction, normal) * normal);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= header.component_count) {
        return;
    }
    let kind = interaction_kinds[id.x];
    if (kind == ${PACKED_INTERACTION_APERTURE}u || kind == ${PACKED_INTERACTION_MIRROR}u) {
        let params = surface_params[id.x * 2u];
        if (params.x < 0.0) {
            return;
        }
    }
}
`;

export interface Solver3WebGpuPackedScene {
    readonly device: GPUDevice;
    readonly componentCount: number;
    readonly pipeline: GPUComputePipeline;
    readonly bindGroup: GPUBindGroup;
    dispatchPreflight(): void;
    destroy(): void;
}

function canUseSolver3WebGpu(): boolean {
    return typeof navigator !== 'undefined'
        && typeof (navigator as NavigatorGpuLike).gpu?.requestAdapter === 'function';
}

function webGpuRequested(): boolean {
    return Boolean((globalThis as WebGpuFlagRegistry).__MICROSCOPE_SOLVER3_ENABLE_WEBGPU__);
}

function alignBytes(value: number): number {
    return Math.ceil(value / 4) * 4;
}

function toFloat32(values: Float64Array): Float32Array {
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[i];
    return out;
}

function toUint32(values: Uint8Array): Uint32Array {
    const out = new Uint32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[i];
    return out;
}

function createStorageBuffer(device: GPUDevice, label: string, data: ArrayBufferView): GPUBuffer {
    const buffer = device.createBuffer({
        label,
        size: alignBytes(data.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return buffer;
}

export async function createSolver3WebGpuPackedScene(tracePacket: PackedTraceScene): Promise<Solver3WebGpuPackedScene | null> {
    if (!canUseSolver3WebGpu()) return null;
    const adapter = await (navigator as NavigatorGpuLike).gpu!.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();

    const componentCount = tracePacket.componentKinds.length;
    const header = new Uint32Array([
        componentCount,
        PACKED_COMPONENT_MATRIX_STRIDE,
        PACKED_SURFACE_PARAM_STRIDE,
        0,
    ]);
    const localToWorld = toFloat32(tracePacket.localToWorldMatrices);
    const interactionKinds = toUint32(tracePacket.interactionKinds);
    const surfaceParams = toFloat32(tracePacket.surfaceParams);
    const buffers = [
        createStorageBuffer(device, 'solver3-webgpu-header', header),
        createStorageBuffer(device, 'solver3-webgpu-local-to-world', localToWorld),
        createStorageBuffer(device, 'solver3-webgpu-interaction-kinds', interactionKinds),
        createStorageBuffer(device, 'solver3-webgpu-surface-params', surfaceParams),
    ];
    const shader = device.createShaderModule({
        label: 'solver3-packed-interactions',
        code: SOLVER3_WEBGPU_INTERACTION_WGSL,
    });
    const pipeline = device.createComputePipeline({
        label: 'solver3-packed-interactions',
        layout: 'auto',
        compute: { module: shader, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
        label: 'solver3-packed-interactions',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: buffers[0] } },
            { binding: 1, resource: { buffer: buffers[1] } },
            { binding: 2, resource: { buffer: buffers[2] } },
            { binding: 3, resource: { buffer: buffers[3] } },
        ],
    });

    return {
        device,
        componentCount,
        pipeline,
        bindGroup,
        dispatchPreflight() {
            const encoder = device.createCommandEncoder({ label: 'solver3-packed-interactions-preflight' });
            const pass = encoder.beginComputePass({ label: 'solver3-packed-interactions-preflight' });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.max(1, Math.ceil(componentCount / 64)));
            pass.end();
            device.queue.submit([encoder.finish()]);
        },
        destroy() {
            for (const buffer of buffers) buffer.destroy?.();
        },
    };
}

class OptionalWebGpuSolver3Backend implements Solver3KernelBackend {
    private readonly packedScene: Promise<Solver3WebGpuPackedScene | null>;

    constructor(
        context: Solver3KernelContext,
        private readonly fallback: Solver3KernelBackend,
    ) {
        this.packedScene = createSolver3WebGpuPackedScene(context.tracePacket);
        this.packedScene.then(scene => scene?.dispatchPreflight()).catch(() => null);
    }

    renderCamera(request: CameraKernelRequest): Solver3Result {
        void this.packedScene;
        return this.fallback.renderCamera(request);
    }

    *renderCameraGenerator(request: CameraKernelRequest): Generator<{ progress: number }, Solver3Result, void> {
        void this.packedScene;
        return yield* this.fallback.renderCameraGenerator(request);
    }

    renderPMTPixel(request: PMTKernelRequest): PMTPixelResult {
        void this.packedScene;
        return this.fallback.renderPMTPixel(request);
    }

    traceBackward(startRay: Ray, originatorId?: string): { radiance: number; excitation: number; path: Ray[]; absorbed: boolean } {
        void this.packedScene;
        return this.fallback.traceBackward(startRay, originatorId);
    }
}

export function createOptionalWebGpuSolver3Backend(
    context: Solver3KernelContext,
    fallback: Solver3KernelBackend,
): Solver3KernelBackend {
    if (!webGpuRequested() || !canUseSolver3WebGpu()) return fallback;
    return new OptionalWebGpuSolver3Backend(context, fallback);
}
