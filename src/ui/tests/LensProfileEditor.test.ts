import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { Mirror } from '../../physics/components/Mirror';
import { CurvedMirror } from '../../physics/components/CurvedMirror';
import { PrismLens } from '../../physics/components/PrismLens';
import { PolygonScanner } from '../../physics/components/PolygonScanner';
import {
    radiusFromSagAtAperture,
    traceAsphericLensPreviewRays,
    traceCylindricalLensPreviewRays,
    supportsLensProfileEditor,
    traceSphericalLensPreviewRays,
} from '../LensProfileEditor';

describe('Lens profile editor support', () => {
    test('supports the current lens and mirror profile classes', () => {
        expect(supportsLensProfileEditor(new SphericalLens(0.02, 12.7, 5))).toBe(true);
        expect(supportsLensProfileEditor(new AsphericLens())).toBe(true);
        expect(supportsLensProfileEditor(new CylindricalLens(50, -50, 12, 20, 5))).toBe(true);
        expect(supportsLensProfileEditor(new AchromatDoublet())).toBe(true);
        expect(supportsLensProfileEditor(new Mirror())).toBe(true);
        expect(supportsLensProfileEditor(new CurvedMirror())).toBe(true);
    });

    test('supports polygon optics built on the shared editable vertex model', () => {
        expect(supportsLensProfileEditor(new PrismLens())).toBe(true);
        expect(supportsLensProfileEditor(new PolygonScanner())).toBe(true);
    });

    test('sag handle math converts a dragged edge sag into radius of curvature', () => {
        expect(radiusFromSagAtAperture(5, 10)).toBeCloseTo(12.5, 6);
        expect(radiusFromSagAtAperture(-5, 10)).toBeCloseTo(-12.5, 6);
        expect(Math.abs(radiusFromSagAtAperture(0.001, 10))).toBeGreaterThan(1e8);
    });

    test('spherical lens preview rays use the lens surfaces and converge through a positive lens', () => {
        const lens = new SphericalLens(0.02, 12.7, 5, 'preview lens', 50, -50);
        const rays = traceSphericalLensPreviewRays(lens, 11, -70, 90);

        expect(rays).toHaveLength(11);
        expect(rays.every(ray => ray.transmitted)).toBe(true);
        expect(rays[5].points[rays[5].points.length - 1]?.r).toBeCloseTo(0, 3);
        expect(rays[10].points[rays[10].points.length - 1]!.r).toBeLessThan(rays[10].points[0].r);
        expect(rays[0].points[rays[0].points.length - 1]!.r).toBeGreaterThan(rays[0].points[0].r);
    });

    test('aspheric lens preview rays trace through both surfaces', () => {
        const lens = new AsphericLens({
            apertureRadius: 6,
            thickness: 3,
            front: { R: 12, k: -0.7, A: [] },
            back: { R: 1e9, k: 0, A: [] },
        });
        const rays = traceAsphericLensPreviewRays(lens, 9, -50, 70);

        expect(rays).toHaveLength(9);
        expect(rays.every(ray => ray.transmitted)).toBe(true);
        expect(rays[4].points.length).toBe(4);
        expect(Math.abs(rays[4].points[rays[4].points.length - 1]!.r)).toBeLessThan(0.001);
    });

    test('cylindrical lens preview rays trace through the powered axis', () => {
        const lens = new CylindricalLens(20, 1e9, 5, 12, 3);
        const rays = traceCylindricalLensPreviewRays(lens, 9, -50, 70);

        expect(rays).toHaveLength(9);
        expect(rays.every(ray => ray.transmitted)).toBe(true);
        expect(rays[4].points.length).toBe(4);
        expect(rays[8].points[rays[8].points.length - 1]!.r).toBeLessThan(rays[8].points[0].r);
    });
});
