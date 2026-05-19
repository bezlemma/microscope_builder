import type { CatalogPart } from './types';

const INDEXED_AT = '2026-05-17';

const sourceNote = 'Seeded from public Thorlabs product tables and complete Zemax catalog references; regenerate with scripts/catalog/import-thorlabs-lenses.mjs for a full local catalog.';

interface PlanoConvexSeed {
    sku: string;
    focalLength: number;
    diopter: number;
    radius: number;
    centerThickness: number;
    edgeThickness: number;
    backFocalLength: number;
}

const PLANO_CONVEX_1IN_A: PlanoConvexSeed[] = [
    { sku: 'LA1951-A', focalLength: 25.3, diopter: 39.5, radius: 13.1, centerThickness: 11.7, edgeThickness: 1.8, backFocalLength: 17.6 },
    { sku: 'LA1805-A', focalLength: 29.9, diopter: 33.4, radius: 15.5, centerThickness: 8.6, edgeThickness: 2.0, backFocalLength: 24.2 },
    { sku: 'LA1027-A', focalLength: 34.9, diopter: 28.7, radius: 18.0, centerThickness: 7.2, edgeThickness: 2.0, backFocalLength: 30.1 },
    { sku: 'LA1422-A', focalLength: 39.9, diopter: 25.1, radius: 20.6, centerThickness: 6.4, edgeThickness: 2.0, backFocalLength: 35.7 },
    { sku: 'LA1131-A', focalLength: 49.8, diopter: 20.1, radius: 25.8, centerThickness: 5.3, edgeThickness: 2.0, backFocalLength: 46.3 },
    { sku: 'LA1134-A', focalLength: 59.8, diopter: 16.7, radius: 30.9, centerThickness: 4.7, edgeThickness: 2.0, backFocalLength: 56.7 },
    { sku: 'LA1608-A', focalLength: 74.8, diopter: 13.4, radius: 38.6, centerThickness: 4.1, edgeThickness: 2.0, backFocalLength: 72.0 },
    { sku: 'LA1509-A', focalLength: 99.7, diopter: 10.0, radius: 51.5, centerThickness: 3.6, edgeThickness: 2.0, backFocalLength: 97.3 },
    { sku: 'LA1986-A', focalLength: 124.6, diopter: 8.0, radius: 64.4, centerThickness: 3.3, edgeThickness: 2.0, backFocalLength: 122.4 },
    { sku: 'LA1433-A', focalLength: 149.5, diopter: 6.7, radius: 77.3, centerThickness: 3.1, edgeThickness: 2.0, backFocalLength: 147.5 },
    { sku: 'LA1229-A', focalLength: 174.4, diopter: 5.7, radius: 90.1, centerThickness: 2.9, edgeThickness: 2.0, backFocalLength: 172.5 },
    { sku: 'LA1708-A', focalLength: 199.3, diopter: 5.0, radius: 103.0, centerThickness: 2.8, edgeThickness: 2.0, backFocalLength: 197.5 },
    { sku: 'LA1461-A', focalLength: 249.2, diopter: 4.0, radius: 128.8, centerThickness: 2.6, edgeThickness: 2.0, backFocalLength: 247.4 },
    { sku: 'LA1484-A', focalLength: 299.0, diopter: 3.3, radius: 154.5, centerThickness: 2.5, edgeThickness: 2.0, backFocalLength: 297.3 },
    { sku: 'LA1172-A', focalLength: 398.7, diopter: 2.5, radius: 206.0, centerThickness: 2.4, edgeThickness: 2.0, backFocalLength: 397.1 },
    { sku: 'LA1908-A', focalLength: 498.3, diopter: 2.0, radius: 257.5, centerThickness: 2.3, edgeThickness: 2.0, backFocalLength: 496.8 },
    { sku: 'LA1978-A', focalLength: 747.5, diopter: 1.3, radius: 386.3, centerThickness: 2.2, edgeThickness: 2.0, backFocalLength: 746.1 },
    { sku: 'LA1464-A', focalLength: 996.7, diopter: 1.0, radius: 515.1, centerThickness: 2.2, edgeThickness: 2.0, backFocalLength: 995.3 },
];

function makePlanoConvexA(row: PlanoConvexSeed): CatalogPart {
    return {
        id: `thorlabs:${row.sku}`,
        vendor: 'thorlabs',
        sku: row.sku,
        title: `N-BK7 Plano-Convex Lens, Ø1", f = ${Math.round(row.focalLength)} mm, ARC 350-700 nm`,
        productUrl: `https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=3279&pn=${row.sku}`,
        categoryPath: ['Optics', 'Lenses', 'Spherical Lenses', 'Plano-Convex'],
        componentType: 'sphericalLens',
        specs: {
            diameter: { value: 25.4, unit: 'mm', source: 'vendorPage' },
            effectiveFocalLength: { value: row.focalLength, unit: 'mm', source: 'vendorPage' },
            diopter: { value: row.diopter, source: 'vendorPage' },
            backFocalLength: { value: row.backFocalLength, unit: 'mm', source: 'vendorPage' },
            r1: { value: row.radius, unit: 'mm', source: 'vendorPage' },
            r2: { value: 'Infinity', unit: 'mm', source: 'vendorPage' },
            centerThickness: { value: row.centerThickness, unit: 'mm', source: 'vendorPage' },
            edgeThickness: { value: row.edgeThickness, unit: 'mm', source: 'vendorPage' },
            material: { value: 'N-BK7', source: 'vendorPage' },
            coating: { value: 'A: 350-700 nm', source: 'vendorPage' },
        },
        normalized: {
            kind: 'sphericalLens',
            focalLengthMm: row.focalLength,
            apertureRadiusMm: 12.7,
            thicknessMm: row.centerThickness,
            r1Mm: row.radius,
            r2Mm: null,
            ior: 1.5168,
            material: 'N-BK7',
        },
        files: [
            { kind: 'zemax', url: 'https://www.thorlabs.com/software-pages/Zemax' },
        ],
        provenance: [
            {
                source: 'manualSeed',
                url: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=3279',
                note: sourceNote,
                retrievedAt: INDEXED_AT,
            },
        ],
        confidence: 'derived',
        lastIndexed: INDEXED_AT,
    };
}

export const THORLABS_SEED_CATALOG: CatalogPart[] = [
    ...PLANO_CONVEX_1IN_A.map(makePlanoConvexA),
    {
        id: 'thorlabs:AC254-200-A',
        vendor: 'thorlabs',
        sku: 'AC254-200-A',
        title: 'Unmounted Achromatic Doublet, Ø25.4 mm, f = 200 mm, ARC 400-700 nm',
        productUrl: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=120&pn=AC254-200-A',
        categoryPath: ['Optics', 'Lenses', 'Achromatic Lenses', 'Unmounted Achromatic Doublets'],
        componentType: 'achromatDoublet',
        specs: {
            diameter: { value: 25.4, unit: 'mm', source: 'vendorPage' },
            effectiveFocalLength: { value: 200.0, unit: 'mm', source: 'vendorPage' },
            backFocalLength: { value: 194.0, unit: 'mm', source: 'vendorPage' },
            r1: { value: 77.4, unit: 'mm', source: 'vendorPage' },
            r2: { value: -87.6, unit: 'mm', source: 'vendorPage' },
            r3: { value: 291.1, unit: 'mm', source: 'vendorPage' },
            centerThickness1: { value: 4.0, unit: 'mm', source: 'vendorPage' },
            centerThickness2: { value: 2.5, unit: 'mm', source: 'vendorPage' },
            edgeThickness: { value: 5.7, unit: 'mm', source: 'vendorPage' },
            glass: { value: 'N-SSK5 / LAFN7', source: 'vendorPage' },
            coating: { value: 'A: 400-700 nm', source: 'vendorPage' },
        },
        normalized: {
            kind: 'achromatDoublet',
            focalLengthMm: 200.0,
            apertureRadiusMm: 12.7,
            r1Mm: 77.4,
            r2Mm: -87.6,
            r3Mm: 291.1,
            t1Mm: 4.0,
            t2Mm: 2.5,
            ior1: 1.6484,
            ior2: 1.7335,
            glass1: 'N-SSK5',
            glass2: 'LAFN7',
        },
        files: [
            { kind: 'zemax', url: 'https://www.thorlabs.com/software-pages/Zemax' },
        ],
        provenance: [
            {
                source: 'manualSeed',
                url: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=120&pn=AC254-200-A',
                note: sourceNote,
                retrievedAt: INDEXED_AT,
            },
        ],
        confidence: 'derived',
        lastIndexed: INDEXED_AT,
    },
    {
        id: 'thorlabs:LJ5709RM-E1',
        vendor: 'thorlabs',
        sku: 'LJ5709RM-E1',
        title: 'Mounted Plano-Convex CaF2 Cylindrical Lens, Ø1", f = 50 mm, ARC 2-5 µm',
        productUrl: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_ID=7654&pn=LJ5709RM-E1',
        categoryPath: ['Optics', 'Lenses', 'Cylindrical Lenses', 'Round Cylindrical Lenses'],
        componentType: 'cylindricalLens',
        specs: {
            diameter: { value: 25.4, unit: 'mm', source: 'vendorPage' },
            effectiveFocalLength: { value: 50.0, unit: 'mm', source: 'vendorPage' },
            material: { value: 'CaF2', source: 'vendorPage' },
            coating: { value: 'E1: 2-5 µm', source: 'vendorPage' },
        },
        normalized: {
            kind: 'cylindricalLens',
            focalLengthMm: 50.0,
            apertureRadiusMm: 12.7,
            widthMm: 25.4,
            thicknessMm: 5.0,
            r1Mm: 21.65,
            r2Mm: 1e9,
            ior: 1.4338,
            material: 'CaF2',
        },
        files: [
            { kind: 'zemax', url: 'https://www.thorlabs.com/software-pages/Zemax' },
        ],
        provenance: [
            {
                source: 'manualSeed',
                url: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_ID=7654&pn=LJ5709RM-E1',
                note: 'Seed uses catalog-level focal length and material; full importer should replace radius/thickness with product-table or Zemax values.',
                retrievedAt: INDEXED_AT,
            },
        ],
        confidence: 'approximate',
        lastIndexed: INDEXED_AT,
    },
    {
        id: 'thorlabs:C240TMD-1064',
        vendor: 'thorlabs',
        sku: 'C240TMD-1064',
        title: 'Mounted Molded Glass Aspheric Lens, f = 8 mm class, ARC 1064 nm',
        productUrl: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=6922&partnumber=C240TMD-1064',
        categoryPath: ['Optics', 'Lenses', 'Aspheric Lenses', 'Molded Glass Aspheres'],
        componentType: 'asphericLens',
        specs: {
            coating: { value: '1064 nm V-coat', source: 'vendorPage' },
            mounting: { value: 'Mounted', source: 'vendorPage' },
            note: { value: 'Use importer/Zemax file for exact conic and even-asphere coefficients.', source: 'manualSeed' },
        },
        normalized: {
            kind: 'asphericLens',
            focalLengthMm: 8.0,
            apertureRadiusMm: 3.0,
            thicknessMm: 2.8,
            r1Mm: 4.5,
            r2Mm: 1e9,
            k1: -1.0,
            k2: 0,
            a1: [],
            a2: [],
            ior: 1.8,
            material: 'Molded optical glass',
        },
        files: [
            { kind: 'zemax', url: 'https://www.thorlabs.com/software-pages/Zemax' },
        ],
        provenance: [
            {
                source: 'manualSeed',
                url: 'https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=6922&partnumber=C240TMD-1064',
                note: 'Approximate seed for UI/workflow testing. Exact asphere surfaces must come from product support documents or Thorlabs Zemax catalog.',
                retrievedAt: INDEXED_AT,
            },
        ],
        confidence: 'approximate',
        lastIndexed: INDEXED_AT,
    },
];
