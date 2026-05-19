import { describe, expect, test } from 'bun:test';
import type { CatalogPart } from '../types';
import { enrichCatalogPartWithPrescriptionText, isOpticalPrescriptionFileName } from '../catalogPrescriptionEnrichment';

function basePart(componentType: CatalogPart['componentType'] = 'sphericalLens'): CatalogPart {
    return {
        id: 'thorlabs:LA1509-A',
        vendor: 'thorlabs',
        sku: 'LA1509-A',
        title: 'LA1509-A',
        productUrl: 'https://www.thorlabs.com/thorproduct.cfm?partnumber=LA1509-A',
        categoryPath: ['Optics', 'Lenses'],
        componentType,
        specs: {
            effectiveFocalLength: { value: 100, unit: 'mm', source: 'vendorPage' },
        },
        normalized: {
            kind: 'sphericalLens',
            focalLengthMm: 100,
            apertureRadiusMm: 12.7,
            thicknessMm: 3,
            r1Mm: 40,
            r2Mm: null,
            ior: 1.5168,
            material: 'N-BK7',
        },
        files: [],
        provenance: [{
            source: 'vendorPage',
            url: 'https://www.thorlabs.com/thorproduct.cfm?partnumber=LA1509-A',
            note: 'test seed',
            retrievedAt: '2026-05-18',
        }],
        confidence: 'derived',
        lastIndexed: '2026-05-18',
    };
}

const zmxSinglet = `
UNIT MM
SURF 1
  TYPE STANDARD
  CURV 0.0194174757
  DISZ 3.6
  GLAS N-BK7
  DIAM 12.7
SURF 2
  TYPE STANDARD
  CURV 0
  DISZ 50
  DIAM 12.7
`;

describe('catalog prescription enrichment', () => {
    test('uses universal importer output as exact Thorlabs catalog geometry', () => {
        const enriched = enrichCatalogPartWithPrescriptionText(
            basePart(),
            zmxSinglet,
            'LA1509-A.zmx',
            'https://www.thorlabs.com/support/LA1509-A.zmx',
            '2026-05-18',
        );

        expect(enriched.confidence).toBe('exact');
        expect(enriched.files).toContainEqual({
            kind: 'zemax',
            role: 'opticalPrescription',
            url: 'https://www.thorlabs.com/support/LA1509-A.zmx',
        });
        expect(enriched.provenance[enriched.provenance.length - 1]?.source).toBe('zemax');
        expect(enriched.normalized.kind).toBe('sphericalLens');
        if (enriched.normalized.kind !== 'sphericalLens') return;
        expect(enriched.normalized.r1Mm).toBeCloseTo(51.5, 3);
        expect(enriched.normalized.r2Mm).toBeGreaterThan(1e8);
        expect(enriched.normalized.thicknessMm).toBeCloseTo(3.6, 6);
        expect(enriched.normalized.focalLengthMm).toBe(100);
    });

    test('does not silently apply a support file to the wrong lens family', () => {
        expect(() => enrichCatalogPartWithPrescriptionText(
            basePart('asphericLens'),
            zmxSinglet,
            'LA1509-A.zmx',
        )).toThrow(/catalog row is asphericLens/);
    });

    test('identifies importable optical support file names', () => {
        expect(isOpticalPrescriptionFileName('part.zmx')).toBe(true);
        expect(isOpticalPrescriptionFileName('part.seq')).toBe(true);
        expect(isOpticalPrescriptionFileName('part.step')).toBe(false);
        expect(isOpticalPrescriptionFileName('part.zos')).toBe(false);
    });
});
