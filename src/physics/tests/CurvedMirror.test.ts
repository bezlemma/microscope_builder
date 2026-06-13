import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { CurvedMirror } from '../components/CurvedMirror';
import { reflectVector } from '../math_solvers';
import type { Ray } from '../types';

function reflectOffMirror(mirror: CurvedMirror, originX: number): Vector3 {
    const ray = {
        origin: new Vector3(originX, 0, -1000),
        direction: new Vector3(0, 0, 1),
    } as Ray;
    const hit = mirror.intersect(ray);
    expect(hit).not.toBeNull();
    return reflectVector(ray.direction, hit!.normal);
}

describe('CurvedMirror sign convention', () => {
    test('R > 0 is concave: off-axis rays reflect back toward the axis (focusing)', () => {
        const mirror = new CurvedMirror(25.4, 100, 3);
        expect(mirror.focalLength).toBeCloseTo(50, 6);

        const reflected = reflectOffMirror(mirror, 10);
        // Reflected back toward -z and toward the axis (-x for a +x ray).
        expect(reflected.z).toBeLessThan(0);
        expect(reflected.x).toBeLessThan(0);

        // Paraxial focus at f = R/2: the reflected ray crosses the axis ~50mm
        // in front of the vertex.
        const small = reflectOffMirror(mirror, 1);
        const slope = small.x / small.z; // dx per dz (both negative)
        const crossingDistance = 1 / Math.abs(slope);
        expect(crossingDistance).toBeCloseTo(50, 0);
    });

    test('R < 0 is convex: off-axis rays reflect away from the axis (diverging)', () => {
        const mirror = new CurvedMirror(25.4, -100, 3);
        const reflected = reflectOffMirror(mirror, 10);
        expect(reflected.z).toBeLessThan(0);
        expect(reflected.x).toBeGreaterThan(0);
    });

    test('flat limit reflects straight back', () => {
        const mirror = new CurvedMirror(25.4, 1e9, 3);
        const reflected = reflectOffMirror(mirror, 10);
        expect(reflected.x).toBeCloseTo(0, 9);
        expect(reflected.z).toBeCloseTo(-1, 9);
    });
});
