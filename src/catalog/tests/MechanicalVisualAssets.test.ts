import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findCatalogPart } from '../catalog';
import {
    mechanicalModelSourceForCatalogPart,
    mechanicalVisualAssetForCatalogPart,
    stepMechanicalModelSourceForCatalogPart,
} from '../mechanicalVisualAssets';

describe('catalog mechanical visual assets', () => {
    test('objectives expose STEP as source CAD but only render converted assets', () => {
        const part = findCatalogPart('thorlabs:TL10X-2P');
        expect(part?.componentType).toBe('objective');

        const mechanicalSource = mechanicalModelSourceForCatalogPart(part);
        expect(mechanicalSource?.role).toBe('mechanicalModel');

        const stepSource = stepMechanicalModelSourceForCatalogPart(part);
        expect(stepSource?.kind).toBe('step');
        expect(stepSource?.url).toContain('.step');

        const visualAsset = mechanicalVisualAssetForCatalogPart(part);
        if (visualAsset) {
            expect(['wrl', 'stl', 'edrawings-json']).toContain(visualAsset.format);
            expect(visualAsset.url).toContain('/catalog/mechanical/objectives/');
        }
    });

    test('TL10X-2P eDrawing visual asset preserves imported linework', () => {
        const asset = JSON.parse(readFileSync(new URL('../../../public/catalog/mechanical/objectives/tl10x-2p.edrawings.json', import.meta.url), 'utf8'));
        const lineBodies = asset.bodies.filter((body: { lines?: number[] }) => (body.lines?.length ?? 0) >= 6);
        expect(lineBodies.length).toBeGreaterThan(10);
        expect(lineBodies.some((body: { id: number; lines?: number[] }) => body.id === 102 && (body.lines?.length ?? 0) > 10_000)).toBe(true);
    });

    test('catalog objective visual manifest includes imported eDrawing assets', () => {
        for (const partId of ['thorlabs:TL10X-2P', 'thorlabs:TL15X-2P', 'thorlabs:TL28X-MP', 'thorlabs:TL2X-SAP']) {
            const part = findCatalogPart(partId);
            const visualAsset = mechanicalVisualAssetForCatalogPart(part);
            expect(visualAsset?.format).toBe('edrawings-json');
            expect(visualAsset?.url).toEndWith('.edrawings.json');
        }
    });
});
