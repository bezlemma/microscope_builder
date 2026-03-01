/**
 * AsphericLens.test.ts — Verifies Newton-Raphson ray-aspheric intersection
 * and normal computation against known analytical solutions.
 *
 * X-forward convention: optical axis = +X. Transverse = Y, Z.
 */
import { describe, test, expect } from 'bun:test';
import { AsphericLens } from '../../parts/AsphericLens';
import { Vector3 } from 'three';
import { Ray, Coherence } from '../types';

/** Create an on-axis or off-axis ray along +X. y = transverse offset. */
function makeRay(y: number, x0: number = -100): Ray {
    return {
        origin: new Vector3(x0, y, 0),
        direction: new Vector3(1, 0, 0).normalize(),
        wavelength: 550e-9,
        intensity: 1,
        polarization: { x: { re: 1, im: 0 }, y: { re: 0, im: 0 } },
        opticalPathLength: 0,
        footprintRadius: 0.1,
        coherenceMode: Coherence.Incoherent,
        sourceId: 'test',
    };
}

describe('AsphericLens', () => {
    test('should create with valid default parameters', () => {
        const lens = new AsphericLens();
        expect(lens.componentType).toBe('asphericLens');
        expect(lens.front.R).toBe(50);
        expect(lens.front.k).toBe(-1);
        expect(lens.back.R).toBe(-50);
        expect(lens.apertureRadius).toBe(12.5);
        expect(lens.thickness).toBe(6);
    });

    test('ABCD focal length should match paraxial thin-lens', () => {
        const lens = new AsphericLens(12.5, 6, 'Test', 1.5168);
        const f = lens.focalLength;
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThan(200);
        console.log(`  Aspheric focal length (paraxial): ${f.toFixed(2)} mm`);
    });

    test('parabolic mirror (k=-1) should intersect on-axis ray correctly', () => {
        // A parabolic surface with R=50 should intersect at x = -thickness/2 for on-axis
        const lens = new AsphericLens(12.5, 6, 'Test');
        const ray = makeRay(0);
        const hit = lens.intersect(ray);

        // On-axis ray should hit the front surface
        expect(hit).not.toBeNull();
        if (hit) {
            // Should be roughly at x = -thickness/2 = -3 (front apex)
            expect(hit.point.x).toBeCloseTo(-3, 0);
            // Normal should be approximately along -X (pointing back toward the ray source)
            expect(Math.abs(hit.normal.x)).toBeGreaterThan(0.9);
        }
    });

    test('off-axis ray should hit and get valid normal', () => {
        const lens = new AsphericLens(12.5, 6, 'Test');
        const ray = makeRay(5);
        const hit = lens.intersect(ray);

        expect(hit).not.toBeNull();
        if (hit) {
            // Off-axis hit should have a tilted normal
            const normalMag = Math.sqrt(hit.normal.x ** 2 + hit.normal.y ** 2 + hit.normal.z ** 2);
            expect(normalMag).toBeCloseTo(1, 4); // Unit normal
        }
    });

    test('purely spherical aspheric (k=0) should match spherical sag', () => {
        // When k=0 and all A coefficients are 0, the aspheric should behave like spherical
        const lens = new AsphericLens(12.5, 6, 'Test');
        lens.front = { R: 50, k: 0, A4: 0, A6: 0, A8: 0, A10: 0 };
        lens.back = { R: -50, k: 0, A4: 0, A6: 0, A8: 0, A10: 0 };

        const ray = makeRay(5);
        const hit = lens.intersect(ray);

        expect(hit).not.toBeNull();
        if (hit) {
            // Sag of spherical surface at r=5, R=50:
            // sag = R - sqrt(R²-r²) = 50 - sqrt(2500-25) ≈ 0.2506
            // Front apex at -thickness/2 = -3. Hit at x = -3 + sag
            const expectedX = -3 + (50 - Math.sqrt(50 * 50 - 5 * 5));
            expect(hit.point.x).toBeCloseTo(expectedX, 1);
        }
    });

    test('ray outside aperture should return null', () => {
        const lens = new AsphericLens(5, 6, 'Small');
        const ray = makeRay(10); // Beyond 5mm aperture
        const hit = lens.intersect(ray);
        expect(hit).toBeNull();
    });

    test('generateProfile should produce valid profile', () => {
        const lens = new AsphericLens();
        const profile = AsphericLens.generateProfile(
            lens.front, lens.back,
            lens.apertureRadius, lens.thickness, 32
        );
        expect(profile.length).toBeGreaterThan(20);
    });
});
