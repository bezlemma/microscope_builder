import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { Mirror } from '../../physics/components/Mirror';
import { CurvedMirror } from '../../physics/components/CurvedMirror';
import { PrismLens } from '../../physics/components/PrismLens';
import { PolygonScanner } from '../../physics/components/PolygonScanner';
import { supportsLensProfileEditor } from '../LensProfileEditor';

describe('Lens profile editor support', () => {
    test('supports the current lens and mirror profile classes', () => {
        expect(supportsLensProfileEditor(new SphericalLens(0.02, 12.7, 5))).toBe(true);
        expect(supportsLensProfileEditor(new CylindricalLens(50, -50, 12, 20, 5))).toBe(true);
        expect(supportsLensProfileEditor(new Mirror())).toBe(true);
        expect(supportsLensProfileEditor(new CurvedMirror())).toBe(true);
    });

    test('supports polygon optics built on the shared editable vertex model', () => {
        expect(supportsLensProfileEditor(new PrismLens())).toBe(true);
        expect(supportsLensProfileEditor(new PolygonScanner())).toBe(true);
    });
});
