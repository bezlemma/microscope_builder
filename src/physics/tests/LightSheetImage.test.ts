import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { Ray, Coherence } from "../types";
import { Solver1 } from "../Solver1";
import { Solver2 } from "../Solver2";
import { Solver3 } from "../Solver3";
import { Camera } from "../../parts/Camera";
import { Sample } from "../../parts/Sample";
import { LXSampleHolder } from "../../parts/LXSampleHolder";
import { createOpenSPIMScene } from "../../presets/openSPIM";
import { Laser } from "../../parts/Laser";

describe("Light Sheet Mickey Image", () => {

    test("OpenSPIM: computeChordSegments covers Mickey for detection-arm backward rays", () => {
        const components = createOpenSPIMScene();
        const sample = components.find(c => c instanceof Sample) as LXSampleHolder;
        expect(sample).toBeDefined();

        sample.updateMatrices();

        // Fire a grid of rays from detection direction (+X) through the sample
        const samplePos = sample.position.clone();
        let hitsWithChord = 0;
        let totalRays = 0;
        const gridSize = 21;

        for (let iy = 0; iy < gridSize; iy++) {
            for (let iz = 0; iz < gridSize; iz++) {
                const offsetY = (iy / (gridSize - 1) - 0.5) * 2; // ±1mm
                const offsetZ = (iz / (gridSize - 1) - 0.5) * 2; // ±1mm

                const worldRay: Ray = {
                    origin: samplePos.clone().add(new Vector3(-5, offsetY, offsetZ)),
                    direction: new Vector3(1, 0, 0),
                    wavelength: 520e-9,
                    intensity: 1,
                    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                    opticalPathLength: 0,
                    footprintRadius: 0,
                    coherenceMode: Coherence.Incoherent
                };

                if (sample.computeChordSegments(worldRay).length > 0) hitsWithChord++;
                totalRays++;
            }
        }

        // Mickey spheres (~1mm diameter) scanned over ±1mm: expect significant hits
        expect(hitsWithChord).toBeGreaterThan(50);
    });

    test("OpenSPIM: Solver 3 produces >50% non-zero pixels", () => {
        const components = createOpenSPIMScene();
        const sample = components.find(c => c instanceof Sample) as Sample;
        const camera = components.find(c => c instanceof Camera) as Camera;
        const sources = components.filter(c => c instanceof Laser) as Laser[];

        expect(sample).toBeDefined();
        expect(camera).toBeDefined();
        expect(sources.length).toBeGreaterThan(0);

        // Forward trace excitation beam
        const solver1 = new Solver1(components);
        const sourceRays: Ray[] = sources.map(laser => {
            const origin = laser.position.clone();
            const dir = laser.getForwardDirection();
            origin.add(dir.clone().multiplyScalar(3));
            return {
                origin,
                direction: dir,
                wavelength: (laser.wavelength || 488) * 1e-9,
                intensity: 1,
                polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
                opticalPathLength: 0,
                footprintRadius: 0,
                coherenceMode: Coherence.Incoherent,
                isMainRay: true,
                sourceId: laser.id
            };
        });

        const forwardPaths = solver1.trace(sourceRays);
        const solver2 = new Solver2();
        const beamSegments = solver2.propagate(forwardPaths, components);

        // Use low resolution for speed
        camera.sensorResX = 16;
        camera.sensorResY = 16;
        camera.samplesPerPixel = 4;

        const solver3 = new Solver3(components, beamSegments);
        const result = solver3.render(camera, 0);

        const emissionImage = result.emissionImage;
        let nonZero = 0;
        for (let i = 0; i < emissionImage.length; i++) {
            if (emissionImage[i] > 0) nonZero++;
        }

        const totalPixels = camera.sensorResX * camera.sensorResY;
        const coverage = nonZero / totalPixels;

        // MORE THAN HALF the pixels should have a non-zero value
        expect(coverage).toBeGreaterThan(0.5);
    });
});
