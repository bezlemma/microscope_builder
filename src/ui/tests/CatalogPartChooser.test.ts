import { describe, expect, test } from 'bun:test';
import { SphericalLens } from '../../physics/components/SphericalLens';
import { AsphericLens } from '../../physics/components/AsphericLens';
import { CylindricalLens } from '../../physics/components/CylindricalLens';
import { AchromatDoublet } from '../../physics/components/AchromatDoublet';
import { Objective } from '../../physics/components/Objective';
import { PrismLens } from '../../physics/components/PrismLens';
import { findCatalogPart } from '../../catalog/catalog';
import {
    applyCatalogPartToDesignComponent,
    applyCatalogPartToDesignLens,
    filterCatalogPartsByCasingPreference,
    isCasedCatalogPart,
} from '../CatalogPartChooser';

describe('CatalogPartChooser design lens sync', () => {
    test('copies selected spherical catalog geometry into the editable design lens', () => {
        const lens = new SphericalLens(1 / 50, 8, 2, 'design');
        const part = findCatalogPart('thorlabs:LC1054-A');
        expect(part).not.toBeNull();

        const applied = applyCatalogPartToDesignLens(lens, part!);

        expect(applied).toBe(true);
        expect(lens.name).toBe('LC1054-A design');
        expect(part!.normalized.kind).toBe('sphericalLens');
        if (part!.normalized.kind !== 'sphericalLens') return;
        expect(lens.apertureRadius).toBeCloseTo(part!.normalized.apertureRadiusMm, 6);
        expect(lens.thickness).toBeCloseTo(part!.normalized.thicknessMm, 6);
        expect(lens.r1).toBeCloseTo(part!.normalized.r1Mm!, 6);
        expect(lens.r2).toBe(part!.normalized.r2Mm ?? undefined);
        expect(lens.focalLength).toBeLessThan(0);
    });

    test('copies derived modeled aperture and thick focal length for steep catalog lenses', () => {
        const lens = new SphericalLens(1 / 50, 8, 2, 'design');
        const part = findCatalogPart('thorlabs:LB5766');
        expect(part).not.toBeNull();

        const applied = applyCatalogPartToDesignLens(lens, part!);

        expect(applied).toBe(true);
        expect(part!.normalized.kind).toBe('sphericalLens');
        if (part!.normalized.kind !== 'sphericalLens') return;
        expect(lens.apertureRadius).toBeCloseTo(part!.normalized.apertureRadiusMm, 6);
        expect(lens.thickness).toBeCloseTo(part!.normalized.thicknessMm, 6);
        expect(lens.r1).toBeCloseTo(part!.normalized.r1Mm!, 6);
        expect(lens.r2).toBeCloseTo(part!.normalized.r2Mm!, 6);
    });

    test('copies selected catalog geometry into non-spherical design lenses', () => {
        const asphere = new AsphericLens();
        const cylinder = new CylindricalLens(40, 1e9, 12, 24, 3);
        const achromat = new AchromatDoublet();
        const objective = new Objective();
        const prism = new PrismLens();
        const aspherePart = findCatalogPart('thorlabs:354060-A');
        const cylinderPart = findCatalogPart('thorlabs:LJ1821L1');
        const achromatPart = findCatalogPart('thorlabs:AC254-200-A');
        const objectivePart = findCatalogPart('thorlabs:TL10X-2P');
        const prismPart = findCatalogPart('thorlabs:PS910');
        expect(aspherePart).not.toBeNull();
        expect(cylinderPart).not.toBeNull();
        expect(achromatPart).not.toBeNull();
        expect(objectivePart).not.toBeNull();
        expect(prismPart).not.toBeNull();

        expect(applyCatalogPartToDesignComponent(asphere, aspherePart!)).toBe(true);
        expect(applyCatalogPartToDesignComponent(cylinder, cylinderPart!)).toBe(true);
        expect(applyCatalogPartToDesignComponent(achromat, achromatPart!)).toBe(true);
        expect(applyCatalogPartToDesignComponent(objective, objectivePart!)).toBe(true);
        expect(applyCatalogPartToDesignComponent(prism, prismPart!)).toBe(true);

        expect(asphere.name).toBe('354060-A design');
        expect(cylinder.name).toBe('LJ1821L1 design');
        expect(achromat.name).toBe('AC254-200-A design');
        expect(objective.name).toBe('TL10X-2P design');
        expect(prism.name).toBe('PS910 design');
        expect(asphere.apertureRadius).toBeCloseTo(aspherePart!.normalized.kind === 'asphericLens' ? aspherePart!.normalized.apertureRadiusMm : 0, 6);
        expect(cylinder.width).toBeCloseTo(cylinderPart!.normalized.kind === 'cylindricalLens' ? cylinderPart!.normalized.widthMm : 0, 6);
        expect(achromat.r2).toBeCloseTo(achromatPart!.normalized.kind === 'achromatDoublet' ? achromatPart!.normalized.r2Mm : 0, 6);
        expect(objective.NA).toBeCloseTo(objectivePart!.normalized.kind === 'objective' ? objectivePart!.normalized.numericalAperture : 0, 6);
        expect(prism.vertices).toHaveLength(prismPart!.normalized.kind === 'prism' ? prismPart!.normalized.verticesMm.length : 0);
    });

    test('catalog casing filter distinguishes mounted from unmounted parts', () => {
        const mountedLens = findCatalogPart('thorlabs:LA1027-ML');
        const bareLens = findCatalogPart('thorlabs:LA1027');
        const objective = findCatalogPart('thorlabs:TL10X-2P');
        const prism = findCatalogPart('thorlabs:PS910');
        expect(mountedLens).not.toBeNull();
        expect(bareLens).not.toBeNull();
        expect(objective).not.toBeNull();
        expect(prism).not.toBeNull();

        expect(isCasedCatalogPart(mountedLens!)).toBe(true);
        expect(isCasedCatalogPart(bareLens!)).toBe(false);
        expect(isCasedCatalogPart(objective!)).toBe(true);
        expect(isCasedCatalogPart(prism!)).toBe(false);

        expect(filterCatalogPartsByCasingPreference([bareLens!, mountedLens!], true).map(part => part.id)).toEqual([mountedLens!.id]);
        expect(filterCatalogPartsByCasingPreference([bareLens!, mountedLens!], false).map(part => part.id)).toEqual([bareLens!.id]);
        expect(filterCatalogPartsByCasingPreference([prism!], true).map(part => part.id)).toEqual([prism!.id]);
        expect(filterCatalogPartsByCasingPreference([objective!], false).map(part => part.id)).toEqual([objective!.id]);
    });
});
