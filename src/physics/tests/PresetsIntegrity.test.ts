import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { ForwardTracer } from "../ForwardTracer";
import { ReverseTracer } from "../ReverseTracer";
import { OpticalComponent } from "../Component";
import { Laser } from "../components/Laser";
import { Lamp } from "../components/Lamp";
import { Camera } from "../components/Camera";
import { Ray } from "../types";
import { createBrightfieldScene } from "../../presets/brightfield";
import { createOpenSPIMScene } from "../../presets/openSPIM";
import { createEpiFluorescenceScene } from "../../presets/epiFluorescence";
import { createTransFluorescenceScene } from "../../presets/TransmissionFluorescence";
import { createBeamExpanderScene } from "../../presets/beamExpander";
import { createConfocalScene } from "../../presets/confocal";

type SourceComponent = Laser | Lamp;

function sourceWavelength(source: SourceComponent): number {
    return source instanceof Laser ? source.wavelength : 532;
}

function sourceFootprintRadius(source: SourceComponent): number {
    return source instanceof Laser ? source.beamRadius : 2;
}

function centralSourceRay(source: SourceComponent, footprintRadius = 0): Ray {
    const origin = source.position.clone();
    const direction = new Vector3(0, 0, 1).applyQuaternion(source.rotation).normalize();
    origin.addScaledVector(direction, 3);

    return {
        origin,
        direction,
        wavelength: sourceWavelength(source) * 1e-9,
        intensity: 1.0,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius,
        coherenceMode: 0,
        isMainRay: true,
        sourceId: source.id
    };
}

function testPreset(name: string, createSceneFn: () => OpticalComponent[], targetClassNames: string[]) {
    test(`Preset ${name} successfully routes central rays to targets`, () => {
        const components = createSceneFn();
        const solver = new ForwardTracer(components);

        const sources = components.filter((component): component is SourceComponent =>
            component instanceof Laser || component instanceof Lamp,
        );
        expect(sources.length).toBeGreaterThan(0);

        let hitTargets = false;

        for (const source of sources) {
            const paths = solver.trace([centralSourceRay(source)]);

            // Verify the ray paths interact with expected target components
            for (const path of paths) {
                for (const segment of path) {
                    if (segment.interactionComponentId) {
                        const hitComp = components.find(c => c.id === segment.interactionComponentId);
                        if (hitComp) {
                            if (targetClassNames.some(className => hitComp.constructor.name === className)) {
                                hitTargets = true;
                            }
                        }
                    }
                }
            }
        }

        expect(hitTargets).toBe(true);
    });
}

describe("End-to-End Preset Integrity", () => {
    testPreset("Brightfield", createBrightfieldScene, ["Sample", "Camera"]);
    testPreset("Epi-Fluorescence", createEpiFluorescenceScene, ["Sample", "Camera"]);
    testPreset("OpenSPIM", createOpenSPIMScene, ["SampleChamber", "Camera"]);
    testPreset("Transmission Fluorescence", createTransFluorescenceScene, ["Sample", "Camera"]);
    testPreset("Beam Expander", createBeamExpanderScene, ["SphericalLens"]);
    testPreset("Confocal", () => createConfocalScene().scene, ["Sample", "PMT"]);
});

function testReverseTracerPaths(presetName: string, createSceneFn: () => OpticalComponent[]) {
    test(`Reverse tracer: ${presetName} backward rays produce paths`, () => {
        const components = createSceneFn();
        const cameras = components.filter((component): component is Camera => component instanceof Camera);
        if (cameras.length === 0) return; // Skip presets without cameras

        const sources = components.filter((component): component is SourceComponent =>
            component instanceof Laser || component instanceof Lamp,
        );
        expect(sources.length).toBeGreaterThan(0);

        const forwardTracer = new ForwardTracer(components);
        const allRayPaths: Ray[][] = [];

        for (const source of sources) {
            const paths = forwardTracer.trace([centralSourceRay(source, sourceFootprintRadius(source))]);
            allRayPaths.push(...paths);
        }

        const beamSegs = forwardTracer.buildBeamSegments(allRayPaths);

        for (const camera of cameras) {
            camera.sensorResX = 4;
            camera.sensorResY = 4;
            camera.samplesPerPixel = 1;
            // NA=0 → backward rays fire exactly along optical axis (deterministic, no random cone)
            camera.sensorNA = 0;

            const reverseTrace = new ReverseTracer(components, beamSegs);
            const result = reverseTrace.render(camera, 16);

            expect(result.paths.length).toBeGreaterThan(0);
        }
    });
}

describe("Reverse tracer Preset Regression", () => {
    testReverseTracerPaths("Brightfield", createBrightfieldScene);
    testReverseTracerPaths("Epi-Fluorescence", createEpiFluorescenceScene);
    testReverseTracerPaths("OpenSPIM", createOpenSPIMScene);
    testReverseTracerPaths("Transmission Fluorescence", createTransFluorescenceScene);
});

describe("Reverse tracer: OpenSPIM Camera Facing", () => {
    test("OpenSPIM camera backward rays fire toward +X (detection arm)", () => {
        const components = createOpenSPIMScene();
        const camera = components.find((component): component is Camera => component instanceof Camera);
        expect(camera).toBeDefined();
        if (!camera) throw new Error('OpenSPIM preset should include a camera');

        // Camera backward ray direction = local +Z transformed to world
        const camW = new Vector3(0, 0, 1).applyQuaternion(camera.rotation).normalize();

        // For the detection arm going in -X direction, camera must fire backward
        // rays in +X (toward the sample at column N, x ≈ 337.5)
        expect(camW.x).toBeGreaterThan(0.9); // Should be ≈ +1
    });
});
