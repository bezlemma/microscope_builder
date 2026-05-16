import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import {
    AsphericLens,
    asphereSagFromApex,
    asphereSagDerivative,
    asphericPresetSurfaces,
} from "../components/AsphericLens";
import { Ray, Coherence } from "../types";

const ray = (origin: Vector3, direction: Vector3): Ray => ({
    origin,
    direction,
    wavelength: 500e-9,
    intensity: 1,
    polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
    opticalPathLength: 0,
    footprintRadius: 0,
    coherenceMode: Coherence.Incoherent,
});

describe("Aspheric sag math", () => {
    test("k=0 reduces to spherical sag", () => {
        const R = 13;
        const r = 5;
        const sphericalSag = R - Math.sign(R) * Math.sqrt(R * R - r * r);
        const asphereSag = asphereSagFromApex({ R, k: 0, A: [] }, r);
        expect(asphereSag).toBeCloseTo(sphericalSag, 8);
    });

    test("flat surface returns 0 with no aspheric terms", () => {
        expect(asphereSagFromApex({ R: 1e9, k: 0, A: [] }, 5)).toBeCloseTo(0, 6);
    });

    test("flat surface with A4 returns A4·r⁴", () => {
        const A4 = 1e-4;
        const r = 5;
        expect(asphereSagFromApex({ R: 1e9, k: 0, A: [A4] }, r)).toBeCloseTo(A4 * r ** 4, 8);
    });

    test("parabola (k=-1) sag = r²/(2R) exactly", () => {
        const R = 13;
        const r = 5;
        // For k=-1: disc = 1 − 0·c²·r² = 1, so z = c·r²/(1+1) = r²/(2R).
        expect(asphereSagFromApex({ R, k: -1, A: [] }, r)).toBeCloseTo(r * r / (2 * R), 10);
    });

    test("prolate ellipsoid (-1<k<0) has less sag than sphere — flatter rim", () => {
        const R = 13;
        const r = 5;
        const sphereSag = asphereSagFromApex({ R, k: 0, A: [] }, r);
        const prolateSag = asphereSagFromApex({ R, k: -0.5, A: [] }, r);
        expect(prolateSag).toBeLessThan(sphereSag);
    });

    test("oblate ellipsoid (k>0) has more sag than sphere — steeper rim", () => {
        const R = 13;
        const r = 5;
        const sphereSag = asphereSagFromApex({ R, k: 0, A: [] }, r);
        const oblateSag = asphereSagFromApex({ R, k: 0.5, A: [] }, r);
        expect(oblateSag).toBeGreaterThan(sphereSag);
    });

    test("sag derivative at vertex is 0", () => {
        expect(asphereSagDerivative({ R: 13, k: -0.7, A: [1e-5, -1e-9] }, 0)).toBeCloseTo(0, 12);
    });

    test("sag derivative for sphere matches analytic c·r/√(1−c²r²)", () => {
        const R = 13;
        const r = 5;
        const c = 1 / R;
        const expected = (c * r) / Math.sqrt(1 - c * c * r * r);
        expect(asphereSagDerivative({ R, k: 0, A: [] }, r)).toBeCloseTo(expected, 10);
    });

    test("sag derivative picks up polynomial term: A4 contributes 4·A4·r³", () => {
        const A4 = 1e-4;
        const r = 5;
        // Flat base + A4·r⁴ → derivative = 4·A4·r³ at r > 0.
        expect(asphereSagDerivative({ R: 1e9, k: 0, A: [A4] }, r)).toBeCloseTo(4 * A4 * r ** 3, 10);
    });
});

describe("AsphericLens construction", () => {
    test("default lens has expected paraxial focal length", () => {
        const lens = new AsphericLens({ name: "default" });
        // Plano-asphere with R₁=13, R₂=∞, n=1.5168, t=4 → f ≈ R/(n−1) ≈ 25 mm.
        // Thick-lens correction is small for this geometry.
        expect(lens.focalLength).toBeGreaterThan(20);
        expect(lens.focalLength).toBeLessThan(30);
    });

    test("biconvex preset gives positive symmetric curvatures", () => {
        const { front, back } = asphericPresetSurfaces("biconvex-asphere", 50, 1.5168);
        expect(front.R).toBeGreaterThan(0);
        expect(back.R).toBeLessThan(0);
        expect(front.R).toBeCloseTo(-back.R, 8);
    });

    test("schmidt-corrector preset has near-flat power and non-empty polynomial", () => {
        const { front, back } = asphericPresetSurfaces("schmidt-corrector", 1, 1.5168);
        expect(Math.abs(front.R)).toBeGreaterThan(1e6);
        expect(Math.abs(back.R)).toBeGreaterThan(1e6);
        expect(front.A.length).toBeGreaterThan(0);
    });
});

describe("AsphericLens ray tracing", () => {
    test("axial ray passes through undeflected", () => {
        const lens = new AsphericLens({
            name: "test",
            front: { R: 25, k: 0, A: [] },
            back: { R: -25, k: 0, A: [] },
            apertureRadius: 10,
            thickness: 4,
        });
        const r = ray(new Vector3(0, 0, -20), new Vector3(0, 0, 1));
        const hit = lens.intersect(r);
        expect(hit).not.toBeNull();
        if (!hit) return;
        const result = lens.interact(r, hit);
        expect(result.rays.length).toBe(1);
        const out = result.rays[0];
        expect(out.direction.x).toBeCloseTo(0, 4);
        expect(out.direction.y).toBeCloseTo(0, 4);
        expect(out.direction.z).toBeCloseTo(1, 4);
    });

    test("ray outside aperture misses entirely", () => {
        const lens = new AsphericLens({
            name: "test",
            front: { R: 25, k: 0, A: [] },
            back: { R: -25, k: 0, A: [] },
            apertureRadius: 10,
            thickness: 4,
        });
        const r = ray(new Vector3(15, 0, -20), new Vector3(0, 0, 1));
        const hit = lens.intersect(r);
        expect(hit).toBeNull();
    });

    test("a parabolic singlet matches a sphere for paraxial (small r) rays", () => {
        // At small height the asphere sag agrees with the sphere sag to leading
        // order, so the refracted direction should be near-identical.
        const sphereLens = new AsphericLens({
            front: { R: 25, k: 0, A: [] },
            back: { R: 1e9, k: 0, A: [] },
            apertureRadius: 10, thickness: 4,
        });
        const parabLens = new AsphericLens({
            front: { R: 25, k: -1, A: [] },
            back: { R: 1e9, k: 0, A: [] },
            apertureRadius: 10, thickness: 4,
        });
        const rIn = ray(new Vector3(0.5, 0, -20), new Vector3(0, 0, 1));
        const hitS = sphereLens.intersect(rIn);
        const hitP = parabLens.intersect(rIn);
        expect(hitS).not.toBeNull();
        expect(hitP).not.toBeNull();
        if (!hitS || !hitP) return;
        const outS = sphereLens.interact(rIn, hitS).rays[0];
        const outP = parabLens.interact(rIn, hitP).rays[0];
        expect(outS.direction.x).toBeCloseTo(outP.direction.x, 4);
    });
});
