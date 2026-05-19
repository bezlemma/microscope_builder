import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { Objective } from '../../physics/components/Objective';
import { PrismLens } from '../../physics/components/PrismLens';
import { deserializeScene, serializeScene } from '../../state/ubzSerializer';
import {
    applyCatalogPartToComponent,
    CATALOG_PARTS,
    catalogPartsForPaletteType,
    compatibleCatalogParts,
    findCatalogPart,
    rankCatalogPartsForSphericalLens,
    scoreCatalogPartAgainstSphericalLens,
    summarizeBom,
} from '../catalog';
import type { CatalogPart } from '../types';

describe('vendor catalog integration', () => {
    test('applies a Thorlabs spherical lens to existing lens geometry', () => {
        const lens = new SphericalLens(1 / 50, 15, 4, 'test lens');
        const part = findCatalogPart('thorlabs:LA1509-A');
        expect(part).not.toBeNull();

        const applied = applyCatalogPartToComponent(lens, part!);
        expect(applied).toBe(true);
        expect(lens.name).toBe('LA1509-A');
        expect(lens.apertureRadius).toBeCloseTo(12.7, 6);
        expect(lens.thickness).toBeCloseTo(3.6, 6);
        expect(lens.r1).toBeCloseTo(51.5, 6);
        expect(lens.r2).toBeUndefined();
        expect(lens.catalog?.partId).toBe('thorlabs:LA1509-A');
    });

    test('catalog compatibility follows component class', () => {
        const lens = new SphericalLens(1 / 50, 15, 4, 'sphere');
        const asphere = new AsphericLens();
        const cylinder = new CylindricalLens(40, 1e9, 12, 24, 3);
        const doublet = new AchromatDoublet();

        expect(compatibleCatalogParts(lens).map(part => part.id)).toContain('thorlabs:LA1509-A');
        expect(compatibleCatalogParts(lens).map(part => part.id)).not.toContain('thorlabs:AC254-200-A');
        expect(compatibleCatalogParts(asphere).map(part => part.id)).toContain('thorlabs:354060-A');
        expect(compatibleCatalogParts(cylinder).map(part => part.id)).toContain('thorlabs:LJ1821L1');
        expect(compatibleCatalogParts(doublet).map(part => part.id)).toContain('thorlabs:AC254-200-A');
        expect(compatibleCatalogParts(new Objective()).map(part => part.id)).toContain('thorlabs:TL10X-2P');
        expect(compatibleCatalogParts(new PrismLens()).map(part => part.id)).toContain('thorlabs:PS910');
    });

    test('palette catalog lookup only exposes catalog-backed component families', () => {
        const sphericalParts = catalogPartsForPaletteType('lens');
        expect(sphericalParts.map(part => part.id)).toContain('thorlabs:LA1509-A');
        expect(sphericalParts.length).toBeGreaterThan(2400);
        expect(catalogPartsForPaletteType('asphericLens').map(part => part.id)).toContain('thorlabs:354060-A');
        expect(catalogPartsForPaletteType('asphericLens').length).toBeGreaterThan(150);
        expect(catalogPartsForPaletteType('cylindricalLens').map(part => part.id)).toContain('thorlabs:LJ1821L1');
        expect(catalogPartsForPaletteType('cylindricalLens').length).toBeGreaterThan(300);
        expect(catalogPartsForPaletteType('achromatDoublet').map(part => part.id)).toContain('thorlabs:AC254-200-A');
        expect(catalogPartsForPaletteType('achromatDoublet').length).toBeGreaterThan(250);
        expect(catalogPartsForPaletteType('objective').map(part => part.id)).toContain('thorlabs:TL10X-2P');
        expect(catalogPartsForPaletteType('objective').length).toBeGreaterThanOrEqual(6);
        expect(catalogPartsForPaletteType('prism').map(part => part.id)).toContain('thorlabs:PS910');
        expect(catalogPartsForPaletteType('prism').length).toBeGreaterThan(25);
        expect(catalogPartsForPaletteType('idealLens')).toEqual([]);
        expect(catalogPartsForPaletteType('mirror')).toEqual([]);
    });

    test('catalog includes the generated Thorlabs lens families without duplicate part ids', () => {
        const partIds = CATALOG_PARTS.map(part => part.id);
        expect(new Set(partIds).size).toBe(partIds.length);

        const expectedFamilies = [
            { id: 'thorlabs:LA1509-A', type: 'sphericalLens' },
            { id: 'thorlabs:LB1761-A', type: 'sphericalLens' },
            { id: 'thorlabs:LC1054-A', type: 'sphericalLens' },
            { id: 'thorlabs:LD1170-A', type: 'sphericalLens' },
            { id: 'thorlabs:LE1015', type: 'sphericalLens' },
            { id: 'thorlabs:LF1015', type: 'sphericalLens' },
            { id: 'thorlabs:LBF254-100-A', type: 'sphericalLens' },
            { id: 'thorlabs:354060-A', type: 'asphericLens' },
            { id: 'thorlabs:LJ1821L1', type: 'cylindricalLens' },
            { id: 'thorlabs:AC254-200-A', type: 'achromatDoublet' },
            { id: 'thorlabs:TL10X-2P', type: 'objective' },
            { id: 'thorlabs:PS910', type: 'prism' },
        ] as const;
        for (const { id, type } of expectedFamilies) {
            const part = findCatalogPart(id);
            expect(part?.componentType).toBe(type);
            expect(part?.normalized.kind).toBe(type);
            expect(part?.files.some(file => file.role === 'opticalPrescription')).toBe(true);
        }
    });

    test('applies generated Thorlabs asphere, cylindrical, achromat, objective, and prism geometry', () => {
        const asphere = new AsphericLens();
        const aspherePart = findCatalogPart('thorlabs:354060-A');
        expect(aspherePart).not.toBeNull();
        expect(applyCatalogPartToComponent(asphere, aspherePart!)).toBe(true);
        expect(asphere.name).toBe('354060-A');
        expect(asphere.apertureRadius).toBeCloseTo(3.1625, 6);
        expect(asphere.thickness).toBeCloseTo(2.493334552329, 6);
        expect(asphere.r2).toBeGreaterThan(1e8);
        expect(asphere.k2).toBe(0);
        expect(asphere.catalog?.partId).toBe('thorlabs:354060-A');
        expect(aspherePart!.confidence).toBe('exact');

        const largeAspherePart = findCatalogPart('thorlabs:ACL25416U');
        expect(largeAspherePart).not.toBeNull();
        expect(largeAspherePart!.normalized.kind).toBe('asphericLens');
        if (largeAspherePart!.normalized.kind === 'asphericLens') {
            expect(largeAspherePart!.normalized.apertureRadiusMm).toBeCloseTo(12.7, 6);
            expect(largeAspherePart!.specs.note).toBeUndefined();
        }

        const exactTwoSurfaceAsphere: CatalogPart = {
            ...aspherePart!,
            id: 'test:two-surface-asphere',
            sku: 'TWO-SURFACE',
            confidence: 'exact',
            normalized: {
                kind: 'asphericLens',
                focalLengthMm: 20,
                apertureRadiusMm: 5,
                thicknessMm: 3,
                r1Mm: 11,
                r2Mm: -14,
                k1: -0.4,
                k2: 0.25,
                a1: [1e-5, -2e-9],
                a2: [-3e-6],
                ior: 1.6,
                surfaceSource: 'exactPrescription',
            },
        };
        expect(applyCatalogPartToComponent(asphere, exactTwoSurfaceAsphere)).toBe(true);
        expect(asphere.r2).toBeCloseTo(-14, 6);
        expect(asphere.k2).toBeCloseTo(0.25, 6);
        expect(asphere.A1).toEqual([1e-5, -2e-9]);
        expect(asphere.A2).toEqual([-3e-6]);

        const cylinder = new CylindricalLens(40, 1e9, 12, 24, 3);
        const cylinderPart = findCatalogPart('thorlabs:LJ1821L1');
        expect(cylinderPart).not.toBeNull();
        expect(applyCatalogPartToComponent(cylinder, cylinderPart!)).toBe(true);
        expect(cylinder.name).toBe('LJ1821L1');
        expect(cylinder.width).toBeCloseTo(50, 6);
        expect(cylinder.apertureRadius).toBeCloseTo(10, 6);
        expect(cylinder.thickness).toBeCloseTo(4.01, 6);
        expect(cylinder.r1).toBeCloseTo(25.84, 6);
        expect(cylinderPart!.confidence).toBe('exact');
        expect(cylinder.catalog?.partId).toBe('thorlabs:LJ1821L1');

        const achromat = new AchromatDoublet();
        const achromatPart = findCatalogPart('thorlabs:AC254-200-A');
        expect(achromatPart).not.toBeNull();
        expect(applyCatalogPartToComponent(achromat, achromatPart!)).toBe(true);
        expect(achromat.name).toBe('AC254-200-A');
        expect(achromat.apertureRadius).toBeCloseTo(12.7, 6);
        expect(achromat.r1).toBeCloseTo(77.4, 6);
        expect(achromat.r2).toBeCloseTo(-87.57, 6);
        expect(achromat.r3).toBeCloseTo(291.07, 6);
        expect(achromat.t1).toBeCloseTo(4, 6);
        expect(achromat.t2).toBeCloseTo(2.5, 6);
        expect(achromat.catalog?.partId).toBe('thorlabs:AC254-200-A');

        const objective = new Objective();
        const objectivePart = findCatalogPart('thorlabs:TL10X-2P');
        expect(objectivePart).not.toBeNull();
        expect(applyCatalogPartToComponent(objective, objectivePart!)).toBe(true);
        expect(objective.name).toBe('TL10X-2P');
        expect(objective.magnification).toBeCloseTo(10, 6);
        expect(objective.NA).toBeCloseTo(0.5, 6);
        expect(objective.workingDistance).toBeCloseTo(7.77, 6);
        expect(objective.immersionMediumKind).toBe('air');
        expect(objective.catalog?.partId).toBe('thorlabs:TL10X-2P');

        const prism = new PrismLens();
        const prismPart = findCatalogPart('thorlabs:PS910');
        expect(prismPart).not.toBeNull();
        expect(applyCatalogPartToComponent(prism, prismPart!)).toBe(true);
        expect(prism.name).toBe('PS910');
        expect(prism.width).toBeCloseTo(10, 6);
        expect(prism.ior).toBeCloseTo(1.5168, 4);
        expect(prism.vertices).toHaveLength(3);
        expect(prism.catalog?.partId).toBe('thorlabs:PS910');
    });

    test('steep catalog lenses use edge thickness to derive a physical modeled aperture', () => {
        const part = findCatalogPart('thorlabs:LB5766');
        expect(part).not.toBeNull();
        expect(part!.normalized.kind).toBe('sphericalLens');
        if (part!.normalized.kind !== 'sphericalLens') return;

        expect(part!.specs.diameter?.value).toBeCloseTo(25.4, 6);
        expect(part!.normalized.apertureRadiusMm).toBeCloseTo(6.3498, 3);
        expect(part!.specs.modeledApertureDiameter?.value).toBeCloseTo(12.6996, 3);
    });

    test('catalog attachment survives UBZ save/load and appears in BoM', () => {
        const lens = new SphericalLens(1 / 50, 15, 4, 'test lens');
        const part = findCatalogPart('thorlabs:LA1509-A');
        expect(part).not.toBeNull();
        applyCatalogPartToComponent(lens, part!);

        const loaded = deserializeScene(serializeScene([lens]));
        expect(loaded).toHaveLength(1);
        expect(loaded[0].catalog?.partId).toBe('thorlabs:LA1509-A');
        expect(loaded[0].catalog?.sku).toBe('LA1509-A');

        const bom = summarizeBom([lens, loaded[0]]);
        expect(bom.lines).toHaveLength(1);
        expect(bom.lines[0].quantity).toBe(2);
    });

    test('spherical catalog matching ranks parts by the designed lens geometry', () => {
        const near = findCatalogPart('thorlabs:LA1509-A');
        expect(near).not.toBeNull();
        const far: CatalogPart = {
            ...near!,
            id: 'test:far-lens',
            sku: 'FAR-LENS',
            normalized: {
                kind: 'sphericalLens',
                focalLengthMm: 25,
                apertureRadiusMm: 5,
                thicknessMm: 12,
                r1Mm: 12,
                r2Mm: null,
                ior: 1.6,
            },
        };
        const design = new SphericalLens(1 / 100, 12.7, 3.6, 'designed', 51.5, undefined);

        expect(scoreCatalogPartAgainstSphericalLens(design, near!)).toBeLessThan(scoreCatalogPartAgainstSphericalLens(design, far));
        expect(rankCatalogPartsForSphericalLens(design, [far, near!])[0].id).toBe('thorlabs:LA1509-A');
    });

    test('spherical catalog matching changes with the designed lens family', () => {
        const parts = catalogPartsForPaletteType('lens');
        const concaveDesign = new SphericalLens(-1 / 25, 12.7, 3, 'concave design', -12.9, undefined);

        const topMatch = rankCatalogPartsForSphericalLens(concaveDesign, parts)[0];
        expect(topMatch.id.startsWith('thorlabs:LC1054')).toBe(true);
        expect(topMatch.id).not.toBe('thorlabs:LA1509-A');
    });
});
