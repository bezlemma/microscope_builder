// Verifies the app's PBS model: a thin circular polarizing beam-splitter
// plate. S/P are defined by the ray's incidence plane on the plate surface.

import { describe, test, expect } from 'bun:test';
import { Vector3 } from 'three';
import { PolarizingBeamSplitter } from '../components/PolarizingBeamSplitter';
import { SphericalLens } from '../components/SphericalLens';
import { Solver1 } from '../Solver1';
import { Coherence, type JonesVector, type Ray } from '../types';

function makeRay(direction: Vector3, polarization: JonesVector, origin = new Vector3(0, 0, -50)): Ray {
    return {
        origin,
        direction: direction.clone().normalize(),
        wavelength: 532e-9,
        intensity: 1,
        polarization,
        opticalPathLength: 0,
        footprintRadius: 0.5,
        coherenceMode: Coherence.Coherent,
        isMainRay: true,
    };
}

function pol(x: number, y: number, z: number): JonesVector {
    return {
        x: { re: x, im: 0 },
        y: { re: y, im: 0 },
        z: { re: z, im: 0 },
    };
}

/** Find a child ray that reflects (different direction) vs transmits (same direction). */
function classify(paths: Ray[][], inputDir: Vector3): { reflected?: Ray; transmitted?: Ray } {
    const out: { reflected?: Ray; transmitted?: Ray } = {};
    for (const path of paths) {
        for (let i = 1; i < path.length; i++) {
            const r = path[i];
            const sameDir = r.direction.dot(inputDir.clone().normalize()) > 0.999;
            if (sameDir) out.transmitted ??= r;
            else out.reflected ??= r;
        }
    }
    return out;
}

describe('PolarizingBeamSplitter physics', () => {
    test('normal incidence passes through because S/P incidence plane is undefined', () => {
        const pbs = new PolarizingBeamSplitter();
        pbs.setPosition(0, 0, 0);
        const dirIn = new Vector3(0, 0, 1);

        const result = classify(new Solver1([pbs]).trace([makeRay(dirIn, pol(1, 0, 0))]), dirIn);
        expect(result.transmitted).toBeDefined();
        expect(result.transmitted!.intensity).toBeGreaterThan(0.99);
        expect(result.reflected).toBeUndefined();
    });

    test('S-pol perpendicular to the incidence plane reflects, P-pol transmits', () => {
        const pbs = new PolarizingBeamSplitter();
        pbs.setPosition(0, 0, 0);
        pbs.pointAlong(0, -1, 1);
        const dirIn = new Vector3(0, 0, 1);

        // d = +Z, n approximately (0,-1,+1), so S = d x n = +X.
        const sOut = classify(new Solver1([pbs]).trace([makeRay(dirIn, pol(1, 0, 0))]), dirIn);
        expect(sOut.reflected).toBeDefined();
        expect(sOut.reflected!.intensity).toBeGreaterThan(0.99);
        expect(sOut.transmitted).toBeUndefined();

        // P lies in the incidence plane and is transverse to d: ±Y.
        const pOut = classify(new Solver1([pbs]).trace([makeRay(dirIn, pol(0, 1, 0))]), dirIn);
        expect(pOut.transmitted).toBeDefined();
        expect(pOut.transmitted!.intensity).toBeGreaterThan(0.99);
        expect(pOut.reflected).toBeUndefined();
    });

    test('rolling the circular plate about its normal does not change S/P', () => {
        const makePbs = (roll: number) => {
            const pbs = new PolarizingBeamSplitter();
            pbs.setPosition(0, 0, 0);
            pbs.pointAlong(0, -1, 1);
            pbs.rollAngle = roll;
            pbs.recomputeRotation();
            return pbs;
        };
        const dirIn = new Vector3(0, 0, 1);

        for (const roll of [0, Math.PI / 4, Math.PI / 2]) {
            const pbs = makePbs(roll);
            const { reflected, transmitted } = classify(
                new Solver1([pbs]).trace([makeRay(dirIn, pol(1, 0, 0))]),
                dirIn,
            );
            expect(reflected).toBeDefined();
            expect(reflected!.intensity).toBeGreaterThan(0.99);
            expect(transmitted).toBeUndefined();
        }
    });

    test('a 50/50 S+P input splits 50/50', () => {
        const pbs = new PolarizingBeamSplitter();
        pbs.setPosition(0, 0, 0);
        pbs.pointAlong(0, -1, 1);
        const dirIn = new Vector3(0, 0, 1);
        const mixed = pol(1 / Math.SQRT2, 1 / Math.SQRT2, 0);

        const { reflected, transmitted } = classify(new Solver1([pbs]).trace([makeRay(dirIn, mixed)]), dirIn);
        expect(reflected).toBeDefined();
        expect(transmitted).toBeDefined();
        expect(reflected!.intensity).toBeCloseTo(0.5, 5);
        expect(transmitted!.intensity).toBeCloseTo(0.5, 5);
    });

    test('P-pol stays P after refracting through a lens at an oblique angle', () => {
        const lens = new SphericalLens(1 / 50, 12.7, 5, 'L');
        lens.setPosition(0, 0, 0);
        lens.pointAlong(1, 0, 0);

        const pbs = new PolarizingBeamSplitter();
        pbs.setPosition(80, 0, 0);
        pbs.pointAlong(-1, 1, 0);

        // For a +X-travelling beam and this plate normal, S is +Z and P is +Y.
        const ray = makeRay(new Vector3(1, 0, 0), pol(0, 1, 0), new Vector3(-30, 6, 0));
        const paths = new Solver1([lens, pbs]).trace([ray]);

        let reflectedPower = 0;
        let transmittedPower = 0;
        for (const path of paths) {
            for (let i = 0; i < path.length; i++) {
                const r = path[i];
                if (r.interactionComponentId !== pbs.id) continue;
                const next = path[i + 1];
                if (!next) continue;
                const dot = next.direction.dot(r.direction);
                if (dot > 0.99) transmittedPower += next.intensity;
                else reflectedPower += next.intensity;
            }
        }
        expect(transmittedPower).toBeGreaterThan(0.999);
        expect(reflectedPower).toBeLessThan(0.001);
    });

    test('reflected ray E-field is aligned with the incidence-plane S direction', () => {
        const pbs = new PolarizingBeamSplitter();
        pbs.setPosition(0, 0, 0);
        pbs.pointAlong(-1, 1, 0);
        const dirIn = new Vector3(1, 0, 0);

        const { reflected } = classify(
            new Solver1([pbs]).trace([makeRay(dirIn, pol(0, 0, 1), new Vector3(-50, 0, 0))]),
            dirIn,
        );
        expect(reflected).toBeDefined();
        const z = reflected!.polarization.z ?? { re: 0, im: 0 };
        expect(Math.hypot(z.re, z.im)).toBeGreaterThan(0.95);
        expect(Math.hypot(reflected!.polarization.x.re, reflected!.polarization.x.im)).toBeLessThan(0.05);
        expect(Math.hypot(reflected!.polarization.y.re, reflected!.polarization.y.im)).toBeLessThan(0.05);
    });
});
