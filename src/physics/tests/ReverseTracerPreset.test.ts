import { describe, test, expect } from "bun:test";
import { Vector3 } from "three";
import { ForwardTracer } from "../ForwardTracer";
import { ReverseTracer } from "../ReverseTracer";
import { Laser } from "../components/Laser";
import { Lamp } from "../components/Lamp";
import { Camera } from "../components/Camera";
import { OpticalComponent } from "../Component";
import { Ray, Coherence } from "../types";
import { createEpiFluorescenceScene } from "../../presets/epiFluorescence";
import { createBrightfieldScene } from "../../presets/brightfield";

function runReverseTracerPresetCheck(presetName: string, createScene: () => OpticalComponent[]) {
    test(`${presetName}: reverse tracer produces camera signal`, () => {
        const components = createScene();
        const cameras = components.filter((component): component is Camera => component instanceof Camera);
        const lasers = components.filter((component): component is Laser => component instanceof Laser);
        const lamps = components.filter((component): component is Lamp => component instanceof Lamp);
        if (cameras.length === 0) return;

        const forwardTracer = new ForwardTracer(components);
        const sourceRays: Ray[] = [];

        for (const laser of lasers) {
            const dir = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
            const origin = laser.position.clone().add(dir.clone().multiplyScalar(3));
            sourceRays.push({
                origin,
                direction: dir,
                wavelength: laser.wavelength * 1e-9,
                intensity: laser.power,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
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
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
                    opticalPathLength: 0,
                    footprintRadius: 0,
                    coherenceMode: Coherence.Incoherent,
                    isMainRay: true,
                    sourceId: lamp.id
                });
            }
        }

        const { beamSegments: beamSegs } = forwardTracer.traceWithBeamSegments(sourceRays);

        const reverseTrace = new ReverseTracer(components, beamSegs);
        const camera = cameras[0];
        const origSamples = camera.samplesPerPixel;
        const origResX = camera.sensorResX;
        const origResY = camera.sensorResY;
        const origNA = camera.sensorNA;
        camera.samplesPerPixel = 1;
        camera.sensorResX = 8;
        camera.sensorResY = 8;
        camera.sensorNA = 0; // Deterministic (no random cone)
        const renderResult = reverseTrace.render(camera, 1);
        camera.samplesPerPixel = origSamples;
        camera.sensorResX = origResX;
        camera.sensorResY = origResY;
        camera.sensorNA = origNA;

        const maxEmission = Math.max(...renderResult.emissionImage);
        const hasSignal = renderResult.paths.length > 0 || maxEmission > 0;
        expect(hasSignal).toBe(true);
    });
}

describe("Reverse tracer preset regressions", () => {
    runReverseTracerPresetCheck("Brightfield", createBrightfieldScene);
    runReverseTracerPresetCheck("Epi-Fluorescence", createEpiFluorescenceScene);
});
