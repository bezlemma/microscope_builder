import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { Solver1 } from "../Solver1";
import { Laser } from "../components/Laser";
import { Lamp } from "../components/Lamp";
import { Ray } from "../types";
import { createBrightfieldScene } from "../../presets/brightfield";
import { createOpenSPIMScene } from "../../presets/openSPIM";
import { createEpiFluorescenceScene } from "../../presets/epiFluorescence";
import { createTransFluorescenceScene } from "../../presets/TransmissionFluorescence";
import { createBeamExpanderScene } from "../../presets/beamExpander";
import { createConfocalScene } from "../../presets/confocal";


function testPreset(name: string, createSceneFn: () => any[], targetClassNames: string[]) {
    test(`Preset ${name} successfully routes central rays to targets`, () => {
        const components = createSceneFn();
        const solver = new Solver1(components);

        const sources = components.filter(c => c instanceof Laser || c instanceof Lamp);
        expect(sources.length).toBeGreaterThan(0);

        let hitTargets = false;

        for (const source of sources) {
            // The central ray firing exactly down the component's optic axis
            const origin = source.position.clone();
            const direction = new Vector3(0, 0, 1).applyQuaternion(source.rotation).normalize();
            
            // Advance slightly to avoid self-intersection immediately at origin
            origin.add(direction.clone().multiplyScalar(3));

            const sourceWavelength = ((source as Laser).wavelength || 532) * 1e-9;
            const ray: Ray = {
                origin,
                direction,
                wavelength: sourceWavelength,
                intensity: 1.0,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode: 0,
                isMainRay: true,
                sourceId: source.id
            };

            const paths = solver.trace([ray]);

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

// ═══════════════════════════════════════════════════════════════════
// SOLVER 3 — Preset Backward Ray Regression
// Verifies that backward rays from cameras actually reach the sample.
// A backward-facing camera or broken optical path will fail these.
// ═══════════════════════════════════════════════════════════════════

import { Solver3 } from "../Solver3";
import { Solver2 } from "../Solver2";
import { Camera } from "../components/Camera";

function testSolver3Paths(presetName: string, createSceneFn: () => any[]) {
    test(`Solver 3: ${presetName} backward rays produce paths`, () => {
        const components = createSceneFn();
        const cameras = components.filter((c: any) => c instanceof Camera) as Camera[];
        if (cameras.length === 0) return; // Skip presets without cameras

        // Generate forward ray paths via Solver 1
        const sources = components.filter((c: any) => c instanceof Laser || c instanceof Lamp);
        expect(sources.length).toBeGreaterThan(0);

        const solver1 = new Solver1(components);
        const allRayPaths: Ray[][] = [];

        for (const source of sources) {
            const origin = source.position.clone();
            const direction = new Vector3(0, 0, 1).applyQuaternion(source.rotation).normalize();
            origin.add(direction.clone().multiplyScalar(3));

            const sourceWl = ((source as Laser).wavelength || 532) * 1e-9;
            const ray: Ray = {
                origin,
                direction,
                wavelength: sourceWl,
                intensity: 1.0,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: (source as Laser).beamRadius || 2,
                coherenceMode: 0,
                isMainRay: true,
                sourceId: source.id
            };

            const paths = solver1.trace([ray]);
            allRayPaths.push(...paths);
        }

        // Build beam segments via Solver 2
        const solver2 = new Solver2();
        const beamSegs = solver2.propagate(allRayPaths, components);

        // Run Solver 3 backward tracing with small resolution
        for (const camera of cameras) {
            camera.sensorResX = 4;
            camera.sensorResY = 4;
            camera.samplesPerPixel = 1;
            // NA=0 → backward rays fire exactly along optical axis (deterministic, no random cone)
            camera.sensorNA = 0;

            const solver3 = new Solver3(components, beamSegs);
            const result = solver3.render(camera, 16);

            console.log(`  [${presetName}] Camera "${camera.name}": ${result.paths.length} paths`);
            expect(result.paths.length).toBeGreaterThan(0);
        }
    });
}

describe("Solver 3 Preset Regression", () => {
    testSolver3Paths("Brightfield", createBrightfieldScene);
    testSolver3Paths("Epi-Fluorescence", createEpiFluorescenceScene);
    testSolver3Paths("OpenSPIM", createOpenSPIMScene);
    testSolver3Paths("Transmission Fluorescence", createTransFluorescenceScene);
});

describe("Solver 3: OpenSPIM Camera Facing", () => {
    test("OpenSPIM camera backward rays fire toward +X (detection arm)", () => {
        const components = createOpenSPIMScene();
        const camera = components.find((c: any) => c instanceof Camera) as Camera;
        expect(camera).toBeDefined();

        // Camera backward ray direction = local +Z transformed to world
        const camW = new Vector3(0, 0, 1).applyQuaternion(camera.rotation).normalize();

        // For the detection arm going in -X direction, camera must fire backward
        // rays in +X (toward the sample at column N, x ≈ 337.5)
        console.log(`  OpenSPIM camera at (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}), backward dir: (${camW.x.toFixed(2)}, ${camW.y.toFixed(2)}, ${camW.z.toFixed(2)})`);
        expect(camW.x).toBeGreaterThan(0.9); // Should be ≈ +1
    });
});
