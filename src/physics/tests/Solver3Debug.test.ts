/**
 * Diagnostic test: Runs Solver 3 on the Epi-Fluorescence preset and logs
 * the backward ray trace interaction chain. This tests why Solver 3
 * produces no visible paths on fluorescence presets.
 */
import { describe, test, expect } from "bun:test";
import { Vector3 } from "three";
import { Solver1 } from "../Solver1";
import { Solver2 } from "../Solver2";
import { Solver3 } from "../Solver3";
import { Laser } from "../components/Laser";
import { Lamp } from "../components/Lamp";
import { Camera } from "../components/Camera";
import { Sample } from "../components/Sample";
import { Ray, Coherence } from "../types";
import { createEpiFluorescenceScene } from "../../presets/epiFluorescence";
import { createBrightfieldScene } from "../../presets/brightfield";

function runSolver3Debug(presetName: string, createScene: () => any[]) {
    test(`${presetName}: Solver 3 backward trace diagnostics`, () => {
        const components = createScene();

        // Find cameras, lasers, lamps, samples
        const cameras = components.filter((c: any) => c instanceof Camera) as Camera[];
        const lasers = components.filter((c: any) => c instanceof Laser) as Laser[];
        const lamps = components.filter((c: any) => c instanceof Lamp) as Lamp[];
        const samples = components.filter((c: any) => c instanceof Sample) as Sample[];

        console.log(`\n=== ${presetName} ===`);
        console.log(`  Components: ${components.length}`);
        console.log(`  Cameras: ${cameras.length}, Lasers: ${lasers.length}, Lamps: ${lamps.length}, Samples: ${samples.length}`);

        if (cameras.length === 0) {
            console.log(`  SKIP: No cameras`);
            return;
        }

        // Step 1: Solver 1 — trace forward rays
        const solver1 = new Solver1(components);
        const sourceRays: Ray[] = [];

        for (const laser of lasers) {
            const dir = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
            const origin = laser.position.clone().add(dir.clone().multiplyScalar(3));
            sourceRays.push({
                origin,
                direction: dir,
                wavelength: laser.wavelength * 1e-9,
                intensity: laser.power,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode: Coherence.Coherent,
                isMainRay: true,
                sourceId: laser.id
            });
        }

        for (const lamp of lamps) {
            const dir = new Vector3(0, 0, 1).applyQuaternion(lamp.rotation).normalize();
            const origin = lamp.position.clone().add(dir.clone().multiplyScalar(3));
            for (const wlNm of lamp.spectralWavelengths) {
                sourceRays.push({
                    origin,
                    direction: dir,
                    wavelength: wlNm * 1e-9,
                    intensity: 1,
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: 0,
                    coherenceMode: Coherence.Incoherent,
                    isMainRay: true,
                    sourceId: lamp.id
                });
            }
        }

        console.log(`  Source rays: ${sourceRays.length}`);
        const paths = solver1.trace(sourceRays);
        console.log(`  Solver 1 paths: ${paths.length}`);

        // Step 2: Solver 2 — propagate Gaussian beams
        const solver2 = new Solver2();
        const beamSegs = solver2.propagate(paths, components);
        console.log(`  Solver 2 beamSeg branches: ${beamSegs.length}`);

        // Step 3: Solver 3 — backward trace from camera
        const solver3 = new Solver3(components, beamSegs);
        const camera = cameras[0];
        console.log(`  Camera: "${camera.name}" at (${camera.position.x}, ${camera.position.y}, ${camera.position.z})`);
        console.log(`  Camera sensorNA: ${camera.sensorNA}, resolution: ${camera.sensorResX}x${camera.sensorResY}`);

        // Trace a single backward ray from the camera center pixel
        camera.updateMatrices();
        const camPos = camera.position.clone();
        const camW = new Vector3(0, 0, 1).applyQuaternion(camera.rotation).normalize();
        console.log(`  Camera forward direction (camW): (${camW.x.toFixed(3)}, ${camW.y.toFixed(3)}, ${camW.z.toFixed(3)})`);

        const sample = samples.length > 0 ? samples[0] : undefined;
        if (sample) {
            console.log(`  Sample: "${sample.name}" at (${sample.position.x}, ${sample.position.y}, ${sample.position.z})`);
            console.log(`    excitation: ${sample.getExcitationWavelength()}nm, emission: ${sample.getEmissionWavelength()}nm`);
        }

        // Fire backward ray straight along camera direction
        const backwardRay: Ray = {
            origin: camPos.clone(),
            direction: camW.clone(),
            wavelength: sample ? sample.getEmissionWavelength() * 1e-9 : 532e-9,
            intensity: 1.0,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
            opticalPathLength: 0,
            footprintRadius: 0.1,
            coherenceMode: Coherence.Coherent,
            sourceId: 'debug_center',
        };

        console.log(`  Backward ray: origin=(${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)}), ` +
            `dir=(${camW.x.toFixed(3)}, ${camW.y.toFixed(3)}, ${camW.z.toFixed(3)}), wl=${(backwardRay.wavelength * 1e9).toFixed(0)}nm`);

        const result = solver3.traceBackward(backwardRay, sample);
        console.log(`  Result: radiance=${result.radiance.toFixed(6)}, pathLength=${result.path.length}, absorbed=${result.absorbed}`);

        // Also run the full render with 1 sample per pixel for fast check
        const origSamples = camera.samplesPerPixel;
        camera.samplesPerPixel = 1;
        const renderResult = solver3.render(camera, 1);
        camera.samplesPerPixel = origSamples;

        const maxEmission = Math.max(...renderResult.emissionImage);
        const maxExcitation = Math.max(...renderResult.excitationImage);
        console.log(`  Full render: paths=${renderResult.paths.length}, maxEmission=${maxEmission.toFixed(6)}, maxExcitation=${maxExcitation.toFixed(6)}`);

        // The test: fluorescence presets should produce non-zero emission
        expect(renderResult.paths.length).toBeGreaterThan(0);
    });
}

describe("Solver 3 Backward Trace Diagnostics", () => {
    runSolver3Debug("Brightfield", createBrightfieldScene);
    runSolver3Debug("Epi-Fluorescence", createEpiFluorescenceScene);
});
