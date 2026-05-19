import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findCatalogPart } from '../catalog';
import {
    catalogGeometryPackUrlForPart,
    resolveCatalogPartGeometry,
    type CatalogOpticalGeometryPack,
} from '../catalogGeometryAssets';

function readPack(fileName: string): CatalogOpticalGeometryPack {
    return JSON.parse(readFileSync(new URL(`../../../public/catalog/optical/thorlabs/${fileName}`, import.meta.url), 'utf8'));
}

describe('catalog optical geometry assets', () => {
    test('maps supported Thorlabs part families to lazy geometry packs', () => {
        expect(catalogGeometryPackUrlForPart(findCatalogPart('thorlabs:AC254-200-A')!)).toBe('/catalog/optical/thorlabs/achromatDoublet.geometries.json');
        expect(catalogGeometryPackUrlForPart(findCatalogPart('thorlabs:LA1509-A')!)).toBe('/catalog/optical/thorlabs/sphericalLens.geometries.json');
        expect(catalogGeometryPackUrlForPart(findCatalogPart('thorlabs:354060-A')!)).toBe('/catalog/optical/thorlabs/asphericLens.geometries.json');
        expect(catalogGeometryPackUrlForPart(findCatalogPart('thorlabs:LJ1821L1')!)).toBe('/catalog/optical/thorlabs/cylindricalLens.geometries.json');
        expect(catalogGeometryPackUrlForPart(findCatalogPart('thorlabs:PS910')!)).toBe('/catalog/optical/thorlabs/prism.geometries.json');
    });

    test('generated packs include exact imported geometry for lenses and vendor geometry for prisms', () => {
        const achromats = readPack('achromatDoublet.geometries.json');
        const aspheres = readPack('asphericLens.geometries.json');
        const cylinders = readPack('cylindricalLens.geometries.json');
        const prisms = readPack('prism.geometries.json');

        expect(achromats.parts['thorlabs:AC254-200-A'].confidence).toBe('exact');
        expect(achromats.parts['thorlabs:AC254-200-A'].source).toBe('zemax');
        expect(achromats.parts['thorlabs:AC254-200-A'].normalized.kind).toBe('achromatDoublet');
        expect(aspheres.parts['thorlabs:354060-A'].normalized.kind).toBe('asphericLens');
        expect(cylinders.parts['thorlabs:LJ1821L1'].normalized.kind).toBe('cylindricalLens');
        expect(prisms.parts['thorlabs:PS910'].source).toBe('vendorPage');
        expect(prisms.parts['thorlabs:PS910'].normalized.kind).toBe('prism');
    });

    test('lazy geometry resolution replaces stale catalog geometry with pack geometry', async () => {
        const part = findCatalogPart('thorlabs:AC254-200-A')!;
        expect(part.normalized.kind).toBe('achromatDoublet');
        if (part.normalized.kind !== 'achromatDoublet') return;

        const stalePart = {
            ...part,
            normalized: {
                ...part.normalized,
                r1Mm: 1,
                r2Mm: 2,
                r3Mm: 3,
            },
        };
        const pack = readPack('achromatDoublet.geometries.json');
        const resolved = await resolveCatalogPartGeometry(stalePart, async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => pack,
        }));

        expect(resolved.normalized.kind).toBe('achromatDoublet');
        if (resolved.normalized.kind !== 'achromatDoublet') return;
        expect(resolved.normalized.r1Mm).toBeCloseTo(part.normalized.r1Mm, 8);
        expect(resolved.normalized.r2Mm).toBeCloseTo(part.normalized.r2Mm, 8);
        expect(resolved.normalized.r3Mm).toBeCloseTo(part.normalized.r3Mm, 8);
    });
});
