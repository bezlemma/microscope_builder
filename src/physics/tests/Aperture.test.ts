import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { Aperture } from '../components/Aperture';
import { Coherence, Ray } from '../types';

function ray(origin: Vector3, direction: Vector3): Ray {
    return {
        origin,
        direction: direction.normalize(),
        wavelength: 532e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 }, z: { re: 0, im: 0 }},
        opticalPathLength: 0,
        footprintRadius: 0.1,
        coherenceMode: Coherence.Coherent,
    };
}

describe('Aperture', () => {
    test('passes axial rays through the clear bore of a thick aperture', () => {
        const aperture = new Aperture(4, 10, 'Tube', 8);
        const hit = aperture.intersect(ray(new Vector3(0, 0, -10), new Vector3(0, 0, 1)));

        expect(hit).toBeDefined();
        expect(hit!.isBlocked).toBe(false);
        expect(hit!.point.z).toBeCloseTo(-4, 6);
    });

    test('absorbs rays hitting the annular cap', () => {
        const aperture = new Aperture(4, 10, 'Tube', 8);
        const hit = aperture.intersect(ray(new Vector3(3, 0, -10), new Vector3(0, 0, 1)));

        expect(hit).toBeDefined();
        expect(hit!.isBlocked).toBe(true);
        expect(hit!.point.z).toBeCloseTo(-4, 6);
    });

    test('absorbs oblique rays that pass the entrance but hit the bore wall', () => {
        const aperture = new Aperture(4, 10, 'Tube', 8);
        const entrance = aperture.intersect(ray(new Vector3(0, 0, -10), new Vector3(0.2, 0, 1)));
        expect(entrance).toBeDefined();
        expect(entrance!.isBlocked).toBe(false);

        const insideRay = ray(entrance!.point.clone(), new Vector3(0.2, 0, 1));
        const wall = aperture.intersect(insideRay);
        expect(wall).toBeDefined();
        expect(wall!.isBlocked).toBe(true);
        expect(Math.hypot(wall!.point.x, wall!.point.y)).toBeCloseTo(2, 6);
    });
});
