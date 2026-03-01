import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { Solver3 } from "../Solver3";
import { GaussianBeamSegment, initialQ } from "../Solver2";
import { Camera } from "../components/Camera";
import { Sample } from "../components/Sample";
import { Coherence } from "../types";

// ─── Helper: create a GaussianBeamSegment along a direction ────────
function makeSeg(
    start: Vector3, end: Vector3, direction: Vector3,
    overrides: Partial<GaussianBeamSegment> = {}
): GaussianBeamSegment {
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
        ...overrides
    };
}

// ═══════════════════════════════════════════════════════════════════
// SOLVER 3 — Backward Ray Direction
// ═══════════════════════════════════════════════════════════════════

describe("Solver 3: Backward Ray Direction", () => {

    test("backward rays travel from camera TOWARD the sample (not away)", () => {
        // Minimal scene: Camera at (0, 25, 0) facing -Y, Sample at (0, 0, 0)
        const camera = new Camera(1, 1, "Test Camera");
        camera.setPosition(0, 25, 0);
        // Rotation(π/2, 0, 0) maps local +Z → world (0, -1, 0)
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 4;
        camera.sensorResY = 4;
        camera.sensorNA = 0.01;      // Near-zero NA for deterministic test
        camera.samplesPerPixel = 1;  // Single sample for deterministic test

        const sample = new Sample("Test Sample");
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        // Beam segment illuminating the sample region
        const beamSeg = makeSeg(
            new Vector3(0, 20, 0),
            new Vector3(0, -10, 0),
            new Vector3(0, -1, 0)
        );

        const solver3 = new Solver3([camera, sample], [[beamSeg]]);
        const result = solver3.render(camera);

        // With tight geometry, center pixels should hit the sample → paths generated
        expect(result.paths.length).toBeGreaterThan(0);

        // Check that backward rays travel generally toward -Y (from camera toward sample)
        for (const path of result.paths) {
            expect(path.length).toBeGreaterThan(0);
            const firstRay = path[0];
            // The first ray should originate near the camera position (y ≈ 25)
            expect(firstRay.origin.y).toBeCloseTo(25, 0);
            // Direction should have a significant -Y component (toward the sample)
            expect(firstRay.direction.y).toBeLessThan(-0.5);
        }
    });

    test("backward rays hit the sample and produce non-zero radiance", () => {
        // Direct line of sight: Camera → Sample with illumination
        const camera = new Camera(4, 4, "Test Camera");
        camera.setPosition(0, 50, 0);
        camera.setRotation(Math.PI / 2, 0, 0);
        camera.sensorResX = 8;
        camera.sensorResY = 8;
        camera.sensorNA = 0.05;
        camera.samplesPerPixel = 5;

        const sample = new Sample("Test Sample");
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        // Beam segment illuminating the sample centered at origin
        const beamSeg = makeSeg(
            new Vector3(0, 10, 0),
            new Vector3(0, -5, 0),
            new Vector3(0, -1, 0),
            { power: 1.0 }
        );

        const solver3 = new Solver3([camera, sample], [[beamSeg]]);
        const result = solver3.render(camera);

        // At least some pixels should have non-zero radiance (the center pixels
        // should see the sample if geometry and direction are correct)
        let nonZeroCount = 0;
        for (let i = 0; i < result.emissionImage.length; i++) {
            if (result.emissionImage[i] > 0) nonZeroCount++;
        }

        console.log(`Non-zero pixels: ${nonZeroCount}/${result.emissionImage.length}`);
        // With a 4mm sensor at 50mm distance aiming at a 0.5mm-radius sample,
        // some center pixels should hit
        expect(nonZeroCount).toBeGreaterThan(0);
    });

    test("no rays appear when camera faces AWAY from the sample", () => {
        // Camera at (0, 100, 0) facing +Y (AWAY from sample at origin)
        const camera = new Camera(4, 4, "Wrong-Facing Camera");
        camera.setPosition(0, 100, 0);
        // Rotation(-π/2, 0, 0) maps local +Z → world (0, 1, 0) — camera faces +Y
        camera.setRotation(-Math.PI / 2, 0, 0);
        camera.sensorResX = 4;
        camera.sensorResY = 4;
        camera.sensorNA = 0.01;
        camera.samplesPerPixel = 1;

        const sample = new Sample("Test Sample");
        sample.setPosition(0, 0, 0);
        sample.setRotation(Math.PI / 2, 0, 0);

        const beamSeg = makeSeg(
            new Vector3(0, 10, 0),
            new Vector3(0, -5, 0),
            new Vector3(0, -1, 0)
        );

        const solver3 = new Solver3([camera, sample], [[beamSeg]]);
        const result = solver3.render(camera);

        // Should produce no paths (rays go away from sample)
        for (const path of result.paths) {
            // If any path exists, first ray should go +Y (away from sample)
            expect(path[0].direction.y).toBeGreaterThan(0);
        }

        // All pixels should have zero radiance
        let nonZeroCount = 0;
        for (let i = 0; i < result.emissionImage.length; i++) {
            if (result.emissionImage[i] > 0) nonZeroCount++;
        }
        expect(nonZeroCount).toBe(0);
    });
});
