import { describe, expect, test } from 'bun:test';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { BeamSplitter } from '../../physics/components/BeamSplitter';
import { CurvedMirror } from '../../physics/components/CurvedMirror';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { DichroicMirror } from '../../physics/components/DichroicMirror';
import { Filter } from '../../physics/components/Filter';
import { Mirror } from '../../physics/components/Mirror';
import { Objective } from '../../physics/components/Objective';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { semanticCatalogMechanicalMaterialName } from '../visualizers/ComponentVisualizers';

describe('catalog mechanical material semantics', () => {
    test('catalog geometry falls back to component-standard material families', () => {
        expect(semanticCatalogMechanicalMaterialName(new SphericalLens(0.02, 12.5, 3))).toBe('lens');
        expect(semanticCatalogMechanicalMaterialName(new AsphericLens())).toBe('lens');
        expect(semanticCatalogMechanicalMaterialName(new CylindricalLens(50, -50, 3, 6, 4))).toBe('lens');
        expect(semanticCatalogMechanicalMaterialName(new AchromatDoublet())).toBe('lens');
        expect(semanticCatalogMechanicalMaterialName(new Mirror())).toBe('mirror');
        expect(semanticCatalogMechanicalMaterialName(new CurvedMirror())).toBe('mirror');
        expect(semanticCatalogMechanicalMaterialName(new BeamSplitter())).toBe('splitter');
        expect(semanticCatalogMechanicalMaterialName(new DichroicMirror())).toBe('dichroic');
        expect(semanticCatalogMechanicalMaterialName(new Filter())).toBe('filter');
        expect(semanticCatalogMechanicalMaterialName(new Objective())).toBe('objective');
    });
});
