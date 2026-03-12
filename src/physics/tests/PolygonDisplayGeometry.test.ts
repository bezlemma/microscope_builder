import { describe, expect, test } from 'bun:test';
import { PrismLens } from '../components/PrismLens';
import { PolygonScanner } from '../components/PolygonScanner';

describe('polygon display geometry', () => {
    test('prism display geometry carries analytical normals for stable rendering', () => {
        const prism = new PrismLens();
        const geometry = prism.buildDisplayGeometry();
        const normals = geometry.getAttribute('normal');
        expect(normals).toBeDefined();
        expect(normals?.count).toBeGreaterThan(0);
    });

    test('polygon scanner display geometry carries analytical normals for stable rendering', () => {
        const scanner = new PolygonScanner();
        const geometry = scanner.buildDisplayGeometry();
        const normals = geometry.getAttribute('normal');
        expect(normals).toBeDefined();
        expect(normals?.count).toBeGreaterThan(0);
    });

    test('prism editor profile is rotated to match the table view', () => {
        const prism = new PrismLens();
        const raw = prism.getProfileVertices();
        const editor = prism.getEditorProfileVertices();
        expect(raw[0][0]).toBeGreaterThan(0);
        expect(Math.abs(raw[0][1])).toBeLessThan(1e-6);
        expect(Math.abs(editor[0][0])).toBeLessThan(1e-6);
        expect(editor[0][1]).toBeGreaterThan(0);
    });
});
