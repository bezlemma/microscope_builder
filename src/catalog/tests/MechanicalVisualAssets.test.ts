import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { CATALOG_PARTS, findCatalogPart } from '../catalog';
import { isCasedCatalogPart } from '../catalogCasing';
import {
    type CatalogMechanicalVisualAsset,
    type MechanicalVisualFormat,
    mechanicalModelSourceForCatalogPart,
    mechanicalVisualAssetForCatalogPart,
    stepMechanicalModelSourceForCatalogPart,
} from '../mechanicalVisualAssets';

interface GltfAssetManifest {
    asset: { version: string };
    buffers?: Array<{ uri: string }>;
}

function requireMechanicalVisualAsset(partId: string): CatalogMechanicalVisualAsset {
    const part = findCatalogPart(partId);
    const visualAsset = mechanicalVisualAssetForCatalogPart(part);
    expect(visualAsset).toBeDefined();
    if (!visualAsset) throw new Error(`Missing mechanical visual asset for ${partId}`);
    return visualAsset;
}

function expectVisualAssetFormat(partId: string, expectedFormat: MechanicalVisualFormat): CatalogMechanicalVisualAsset {
    const visualAsset = requireMechanicalVisualAsset(partId);
    expect(visualAsset.format).toBe(expectedFormat);
    return visualAsset;
}

describe('catalog mechanical visual assets', () => {
    test('catalog parts expose STEP as source CAD but render converted assets', () => {
        const part = findCatalogPart('thorlabs:TL10X-2P');
        expect(part?.componentType).toBe('objective');

        const mechanicalSource = mechanicalModelSourceForCatalogPart(part);
        expect(mechanicalSource?.role).toBe('mechanicalModel');

        const stepSource = stepMechanicalModelSourceForCatalogPart(part);
        expect(stepSource?.kind).toBe('step');
        expect(stepSource?.url).toContain('.step');

        const visualAsset = mechanicalVisualAssetForCatalogPart(part);
        if (visualAsset) {
            expect(['wrl', 'stl', 'glb', 'gltf', 'edrawings-json']).toContain(visualAsset.format);
            expect(visualAsset.url).toContain('/catalog/mechanical/objectives/');
        }
    });

    test('ASI AMS-AGY v1 uses the vendor STEP-derived snout objective mesh', () => {
        const part = findCatalogPart('asi:54-10-5');
        expect(part?.componentType).toBe('objective');

        const stepSource = stepMechanicalModelSourceForCatalogPart(part);
        expect(stepSource?.kind).toBe('step');
        expect(stepSource?.url).toContain('54-10-5');

        const visualAsset = mechanicalVisualAssetForCatalogPart(part);
        expect(visualAsset?.format).toBe('wrl');
        expect(visualAsset?.url).toBe('/catalog/mechanical/objectives/asi-54-10-5-ams-agy-v1.wrl');

        const assetText = readFileSync(new URL('../../../public/catalog/mechanical/objectives/asi-54-10-5-ams-agy-v1.wrl', import.meta.url), 'utf8');
        expect(assetText).toContain('#VRML');
        expect(assetText).toContain('Shape');
    });

    test('mounted spherical lenses can render converted vendor mechanical assets', () => {
        for (const partId of ['thorlabs:LB1471-A-ML', 'thorlabs:LA1131-C-ML', 'thorlabs:LA4148-C-ML']) {
            const part = findCatalogPart(partId);
            expect(part?.componentType).toBe('sphericalLens');

            const stepSource = stepMechanicalModelSourceForCatalogPart(part);
            expect(stepSource?.kind).toBe('step');

            const visualAsset = expectVisualAssetFormat(partId, 'gltf');
            expect(visualAsset.url).toContain('/catalog/mechanical/lenses/');
            expect(visualAsset.url).toEndWith('.gltf');

            const assetUrl = new URL(`../../../public${visualAsset.url}`, import.meta.url);
            const asset = JSON.parse(readFileSync(assetUrl, 'utf8')) as GltfAssetManifest;
            expect(asset.asset.version).toBe('2.0');
            for (const buffer of asset.buffers ?? []) {
                expect(existsSync(new URL(buffer.uri, assetUrl))).toBe(true);
            }
        }
    });

    test('only mounted STEP-backed lens catalog parts keep converted mechanical visual assets', () => {
        const lensTypes = new Set(['sphericalLens', 'asphericLens', 'cylindricalLens', 'achromatDoublet']);
        const stepBackedLensParts = CATALOG_PARTS.filter(part =>
            lensTypes.has(part.componentType) &&
            stepMechanicalModelSourceForCatalogPart(part)
        );
        const casedLensParts = stepBackedLensParts.filter(isCasedCatalogPart);
        const bareLensParts = stepBackedLensParts.filter(part => !isCasedCatalogPart(part));

        expect(stepBackedLensParts.length).toBeGreaterThan(3_000);
        expect(casedLensParts.length).toBeGreaterThan(700);
        expect(bareLensParts.length).toBeGreaterThan(3_000);

        const missing = casedLensParts
            .filter(part => !mechanicalVisualAssetForCatalogPart(part))
            .map(part => part.sku);
        expect(missing).toEqual([]);

        const nonGltfAssets = casedLensParts
            .map(part => mechanicalVisualAssetForCatalogPart(part))
            .filter(asset => asset?.format !== 'gltf')
            .map(asset => asset?.sku);
        expect(nonGltfAssets).toEqual([]);

        expect(mechanicalVisualAssetForCatalogPart(findCatalogPart('thorlabs:LA1027'))).toBeNull();
        expect(mechanicalVisualAssetForCatalogPart(findCatalogPart('thorlabs:AC254-200-A'))).toBeNull();
    });

    test('only cased STEP-backed fold optics keep converted mechanical visual assets', () => {
        const foldTypes = new Set(['mirror', 'curvedMirror', 'beamSplitter', 'polarizingBeamSplitter', 'dichroic']);
        const stepBackedFoldParts = CATALOG_PARTS.filter(part =>
            foldTypes.has(part.componentType) &&
            stepMechanicalModelSourceForCatalogPart(part)
        );
        const casedFoldParts = stepBackedFoldParts.filter(isCasedCatalogPart);
        const bareFoldParts = stepBackedFoldParts.filter(part => !isCasedCatalogPart(part));

        expect(stepBackedFoldParts.length).toBeGreaterThan(700);
        expect(casedFoldParts.length).toBeGreaterThan(70);
        expect(bareFoldParts.length).toBeGreaterThan(700);
        for (const partId of [
            'thorlabs:CCM1-P01',
            'thorlabs:CCM1-BS013',
            'thorlabs:CCM1-PBS25-633',
        ]) {
            const visualAsset = expectVisualAssetFormat(partId, 'glb');
            expect(visualAsset.url).toContain('/catalog/mechanical/fold-optics/');
        }

        const missing = casedFoldParts
            .filter(part => !mechanicalVisualAssetForCatalogPart(part))
            .map(part => part.sku);
        expect(missing).toEqual([]);

        const nonGlbAssets = casedFoldParts
            .map(part => mechanicalVisualAssetForCatalogPart(part))
            .filter(asset => asset?.format !== 'glb')
            .map(asset => asset?.sku);
        expect(nonGlbAssets).toEqual([]);

        for (const partId of [
            'thorlabs:PF10-03-P01',
            'thorlabs:CM254-050-P01',
            'thorlabs:BS013',
            'thorlabs:PBS513',
            'thorlabs:DMLP505',
        ]) {
            expect(mechanicalVisualAssetForCatalogPart(findCatalogPart(partId))).toBeNull();
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
