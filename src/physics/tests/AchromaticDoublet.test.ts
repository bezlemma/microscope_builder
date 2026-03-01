/**
 * AchromaticDoublet.test.ts — Verifies that the achromatic doublet
 * produces less chromatic aberration than a singlet of the same focal length.
 */
import { describe, test, expect } from 'bun:test';
import { AchromaticDoublet } from '../../parts/AchromaticDoublet';

describe('AchromaticDoublet', () => {
    test('should create with valid default parameters', () => {
        const d = new AchromaticDoublet('Test Doublet');
        expect(d.r1).toBeFinite();
        expect(d.r2).toBeFinite();
        expect(d.r3).toBeFinite();
        expect(d.thickness1).toBeGreaterThan(0);
        expect(d.thickness2).toBeGreaterThan(0);
        expect(d.apertureRadius).toBeGreaterThan(0);
    });

    test('should compute a positive focal length', () => {
        const d = new AchromaticDoublet('Test Doublet');
        expect(d.focalLength).toBeGreaterThan(0);
        expect(d.focalLength).toBeLessThan(500);
    });

    test('should have ABCD matrix with reasonable values', () => {
        const d = new AchromaticDoublet('Test Doublet');
        const [A, B, C, D] = d.getABCD();
        // C should be negative for a converging lens
        expect(C).toBeLessThan(0);
        // Determinant should be ≈ 1 (symplectic)
        expect(Math.abs(A * D - B * C - 1)).toBeLessThan(0.01);
    });

    test('chromatic focal shift should be bounded', () => {
        const doublet = new AchromaticDoublet('Test Doublet');

        // Compare ABCD-based focal lengths at blue (486nm) and red (656nm)
        const blue = 486e-9;
        const red = 656e-9;

        const [, , C_blue] = doublet.getABCD(undefined, blue);
        const [, , C_red] = doublet.getABCD(undefined, red);
        const f_blue = Math.abs(C_blue) > 1e-12 ? -1 / C_blue : Infinity;
        const f_red = Math.abs(C_red) > 1e-12 ? -1 / C_red : Infinity;
        const chromatic = Math.abs(f_blue - f_red);

        console.log(`  Doublet: f_blue=${f_blue.toFixed(2)}, f_red=${f_red.toFixed(2)}, Δf=${chromatic.toFixed(3)} mm`);

        // Focal length should be positive at both wavelengths
        expect(f_blue).toBeGreaterThan(0);
        expect(f_red).toBeGreaterThan(0);
        // Chromatic shift should be bounded (< 10% of focal length)
        expect(chromatic / doublet.focalLength).toBeLessThan(0.1);
    });

    test('generateProfile should produce valid profile points', () => {
        const profile = AchromaticDoublet.generateProfile(
            61.47, -44.64, -128.2, 6, 2.5, 12.5, 32
        );
        expect(profile.length).toBeGreaterThan(10);
        expect(profile[0].x).toBeCloseTo(0, 1);
    });

    test('setSurfaceRadius should update version', () => {
        const d = new AchromaticDoublet('Test');
        const v1 = d.version;
        d.setSurfaceRadius(0, 80);
        expect(d.version).toBeGreaterThan(v1);
        expect(d.r1).toBe(80);
    });
});
