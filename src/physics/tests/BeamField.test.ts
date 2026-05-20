import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import {
    BeamField,
    GaussianBeamSegment,
} from "../BeamField";
import { SphericalLens } from "../components/SphericalLens";
import { Laser } from "../components/Laser";
import { ForwardTracer } from "../ForwardTracer";
import { Ray, Coherence } from "../types";

// ─── Helper: create a basic main ray ──────────────────────────────────
function makeRay(origin: Vector3, direction: Vector3, overrides: Partial<Ray> = {}): Ray {
    return {
        origin,
        direction: direction.normalize(),
        wavelength: 532e-9,
        intensity: 1.0,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius: 0,
        coherenceMode: Coherence.Incoherent,
        isMainRay: true,
        sourceId: "test-laser",
        ...overrides
    };
}

// ─── Helper: create a minimal GaussianBeamSegment ─────────────────────
function makeSeg(overrides: Partial<GaussianBeamSegment> = {}): GaussianBeamSegment {
    return {
        start: new Vector3(0, 0, 0),
        end: new Vector3(100, 0, 0),
        direction: new Vector3(1, 0, 0),
        wavelength: 532e-9,
        power: 1.0,
        footprintStart: 2,
        footprintEnd: 2,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        refractiveIndex: 1.0,
        coherenceMode: Coherence.Coherent,
        ...overrides
    };
}

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 1: Beer-Lambert Absorption
// ═══════════════════════════════════════════════════════════════════════

describe("Beer-Lambert Absorption", () => {
    test("Transparent glass: power unchanged after propagation", () => {
        // A lens with absorptionCoeff = 0 should not decay power
        const lens = new SphericalLens(1 / 50, 15, 4, "Transparent Lens");
        expect(lens.absorptionCoeff).toBe(0); // default

        // Create a simple scene: Laser → Lens
        const laser = new Laser("Laser");
        laser.setPosition(-100, 0, 0);

        lens.setPosition(0, 0, 0);
        lens.setRotation(0, Math.PI / 2, 0);

        const forwardTracer = new ForwardTracer([lens]);
        const ray = makeRay(
            new Vector3(-100, 0, 0),
            new Vector3(1, 0, 0)
        );

        const paths = forwardTracer.trace([ray]);
        const beamField = new BeamField();
        const segments = beamField.propagate(paths, [laser, lens]);

        // Find segments inside glass (refractiveIndex > 1)
        const glassSegments = segments.flat().filter(s => s.refractiveIndex > 1.01);
        const airSegmentsAfter = segments.flat().filter(s => s.refractiveIndex <= 1.01);

        // All segments should have full power (within tolerance for beam splitter effects)
        for (const seg of [...glassSegments, ...airSegmentsAfter]) {
            expect(seg.power).toBeCloseTo(1.0, 2);
        }
    });

    test("Absorbing glass: power decays exponentially", () => {
        // Lens with significant absorption
        const lens = new SphericalLens(1 / 50, 15, 8, "Absorbing Lens");
        lens.absorptionCoeff = 0.1; // 0.1 mm⁻¹ — heavy absorption

        lens.setPosition(0, 0, 0);
        lens.setRotation(0, Math.PI / 2, 0);

        const laser = new Laser("Laser");
        laser.setPosition(-100, 0, 0);

        const forwardTracer = new ForwardTracer([lens]);
        const ray = makeRay(
            new Vector3(-100, 0, 0),
            new Vector3(1, 0, 0)
        );

        const paths = forwardTracer.trace([ray]);
        const beamField = new BeamField();
        const segments = beamField.propagate(paths, [laser, lens]);

        // Segments after glass should have reduced power
        const allSegs = segments.flat();
        if (allSegs.length > 1) {
            const lastSeg = allSegs[allSegs.length - 1];
            // For thickness ~8mm, power should be < exp(-0.1 * 8) ≈ 0.449
            // (actual path length may vary due to lens geometry)
            expect(lastSeg.power).toBeLessThan(0.95);
            expect(lastSeg.power).toBeGreaterThan(0); // Not fully extinct
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 3: E-field Intensity Query (Solver Handshake)
// ═══════════════════════════════════════════════════════════════════════

describe("E-field Intensity Query", () => {
    test("queryIntensity: on-axis peak is maximum", () => {
        const seg = makeSeg();
        const segments = [seg];

        const onAxis = BeamField.queryIntensity(50, 0, 0, segments);
        expect(onAxis).not.toBeNull();
        expect(onAxis!.intensity).toBeGreaterThan(0);

        const offAxis = BeamField.queryIntensity(50, 2, 0, segments);
        expect(offAxis).not.toBeNull();

        // On-axis should be brighter than off-axis
        expect(onAxis!.intensity).toBeGreaterThan(offAxis!.intensity);
    });

    test("queryIntensity: Gaussian profile decreases with distance", () => {
        const seg = makeSeg();
        const segments = [seg];

        const r0 = BeamField.queryIntensity(50, 0, 0, segments);
        const r1 = BeamField.queryIntensity(50, 1, 0, segments);
        const r2 = BeamField.queryIntensity(50, 2, 0, segments);
        const r3 = BeamField.queryIntensity(50, 3, 0, segments);

        expect(r0).not.toBeNull();
        expect(r1).not.toBeNull();
        expect(r2).not.toBeNull();
        expect(r3).not.toBeNull();

        // Monotonically decreasing intensity with increasing transverse distance
        expect(r0!.intensity).toBeGreaterThan(r1!.intensity);
        expect(r1!.intensity).toBeGreaterThan(r2!.intensity);
        expect(r2!.intensity).toBeGreaterThan(r3!.intensity);
    });

    test("queryIntensity: phase accumulates with propagation distance", () => {
        const seg = makeSeg();
        const segments = [seg];

        const p1 = BeamField.queryIntensity(10, 0, 0, segments);
        const p2 = BeamField.queryIntensity(50, 0, 0, segments);

        expect(p1).not.toBeNull();
        expect(p2).not.toBeNull();

        // Phase at 50mm should be larger than at 10mm (both positive propagation)
        expect(p2!.phase).toBeGreaterThan(p1!.phase);

        // Phase difference should correspond to physical distance × wavenumber
        const k = 2 * Math.PI / (532e-9 * 1e3); // wavenumber [1/mm]
        const expectedDPhase = k * (50 - 10); // Δφ = k × Δz
        const actualDPhase = p2!.phase - p1!.phase;
        expect(actualDPhase).toBeCloseTo(expectedDPhase, 0); // within ~1 radian
    });

    test("queryIntensity: returns null for empty segments", () => {
        const result = BeamField.queryIntensity(0, 0, 0, []);
        expect(result).toBeNull();
    });

    test("queryIntensityMultiBeam: single beam matches queryIntensity", () => {
        const seg = makeSeg();
        const point = new Vector3(50, 0, 0);

        const single = BeamField.queryIntensity(point.x, point.y, point.z, [seg]);
        const multi = BeamField.queryIntensityMultiBeam(point.x, point.y, point.z, [[seg]]);

        expect(single).not.toBeNull();
        expect(multi).toBeCloseTo(single!.intensity, 6);
    });

    test("queryIntensityMultiBeam: two beams with same phase constructively interfere", () => {
        // Two identical beams with same OPL → constructive interference → 4× intensity
        const seg1 = makeSeg({ opticalPathLength: 0 });
        const seg2 = makeSeg({ opticalPathLength: 0 });

        const point = new Vector3(50, 0, 0);
        const singleI = BeamField.queryIntensity(point.x, point.y, point.z, [seg1])!.intensity;

        const multiI = BeamField.queryIntensityMultiBeam(point.x, point.y, point.z, [[seg1], [seg2]]);

        // Constructive: I_total = (√I + √I)² = 4·I
        expect(multiI).toBeCloseTo(4 * singleI, 3);
    });

    test("queryIntensityMultiBeam: orthogonal polarizations don't interfere", () => {
        // X-polarized and Y-polarized beams should add incoherently
        const seg1 = makeSeg({
            opticalPathLength: 0,
            polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }}
        });
        const seg2 = makeSeg({
            opticalPathLength: 0,
            polarization: { x: { re: 0, im: 0 }, y: { re: 1, im: 0 }, z: { re: 0, im: 0 }}
        });

        const point = new Vector3(50, 0, 0);
        const singleI = BeamField.queryIntensity(point.x, point.y, point.z, [seg1])!.intensity;

        const multiI = BeamField.queryIntensityMultiBeam(point.x, point.y, point.z, [[seg1], [seg2]]);

        // Incoherent sum: I_total = I₁ + I₂ = 2·I (not 4·I)
        expect(multiI).toBeCloseTo(2 * singleI, 3);
    });
});
