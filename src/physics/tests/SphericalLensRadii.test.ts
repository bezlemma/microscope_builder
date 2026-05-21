import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../components/SphericalLens';

describe('SphericalLens radii', () => {
    test('supports asymmetric radii', () => {
        const lens = new SphericalLens(0.02, 10, 5, 'TestLens');

        const initial = lens.getRadii();
        expect(initial.R1).toBeCloseTo(51.68, 1);
        expect(initial.R2).toBeCloseTo(-51.68, 1);

        lens.r1 = 100;
        lens.r2 = -30;

        const updated = lens.getRadii();
        expect(updated.R1).toBe(100);
        expect(updated.R2).toBe(-30);
    });

    test('treats very large radius as planar', () => {
        const lens = new SphericalLens(0.02, 10, 5, 'TestLens');

        lens.r1 = 1e9;
        lens.r2 = -50;

        const radii = lens.getRadii();
        expect(radii.R1).toBeGreaterThan(1e8);
        expect(radii.R2).toBe(-50);
    });
});
