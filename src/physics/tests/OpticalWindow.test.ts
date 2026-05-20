import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { OpticalWindow } from '../components/OpticalWindow';
import { Coherence, createRay, defaultTransversePolarization } from '../types';

function testRay(direction: Vector3) {
    return createRay({
        origin: new Vector3(-20, 0, 0),
        direction,
        wavelength: 532e-9,
        intensity: 1,
        polarization: defaultTransversePolarization(direction),
        opticalPathLength: 0,
        footprintRadius: 0.1,
        coherenceMode: Coherence.Coherent,
    });
}

describe('OpticalWindow', () => {
    test('transmits through a parallel plate and adds glass optical path length', () => {
        const window = new OpticalWindow(25.4, 5, 1.5, 'Test Window', 1);
        window.pointAlong(1, 0, 0);

        const ray = testRay(new Vector3(1, 0, 0));
        const hit = window.chkIntersection(ray);
        expect(hit).not.toBeNull();

        const result = window.interact(ray, hit!);
        expect(result.passthrough).toBe(true);
        expect(result.rays).toHaveLength(1);

        const out = result.rays[0];
        expect(out.direction.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);
        expect(out.origin.x).toBeCloseTo(2.5, 9);
        expect(out.opticalPathLength).toBeCloseTo(17.5 + 5 * 1.5, 9);
        expect(out.intensity).toBeCloseTo(1, 9);
    });

    test('fine optical path trim maps to phase without pretending to be a pupil mask', () => {
        const window = new OpticalWindow(25.4, 5, 1.5, 'Phase Plate', 1);
        window.opticalPathOffsetMm = 532e-6 / 2;
        window.pointAlong(1, 0, 0);

        const ray = testRay(new Vector3(1, 0, 0));
        const hit = window.chkIntersection(ray)!;
        const out = window.interact(ray, hit).rays[0];

        expect(out.opticalPathLength).toBeCloseTo(17.5 + 5 * 1.5 + 532e-6 / 2, 12);
    });
});
