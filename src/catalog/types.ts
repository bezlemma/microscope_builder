export type CatalogVendor = 'thorlabs' | 'edmund' | 'coherent';

export type CatalogComponentType =
    | 'sphericalLens'
    | 'asphericLens'
    | 'cylindricalLens'
    | 'achromatDoublet'
    | 'objective'
    | 'prism'
    | 'mirror'
    | 'filter'
    | 'laser'
    | 'camera'
    | 'mount'
    | 'unknown';

export interface CatalogValue {
    value: number | string | boolean;
    unit?: string;
    source: 'vendorPage' | 'zemax' | 'pdf' | 'cad' | 'manualSeed';
}

export type CatalogFileKind =
    | 'zemax'
    | 'opticStudio'
    | 'codeV'
    | 'oslo'
    | 'glassCatalog'
    | 'coating'
    | 'step'
    | 'solidworks'
    | 'pdf'
    | 'dxf'
    | 'rayData'
    | 'image';

export type CatalogFileRole =
    | 'opticalPrescription'
    | 'mechanicalModel'
    | 'datasheet'
    | 'drawing'
    | 'glassCatalog'
    | 'coating'
    | 'image';

export type OpticalSurfaceSource =
    | 'exactPrescription'
    | 'catalogRow'
    | 'estimatedFromFocalLength';

export interface CatalogFile {
    kind: CatalogFileKind;
    role?: CatalogFileRole;
    url: string;
    localPath?: string;
    sha256?: string;
}

export interface CatalogPriceSnapshot {
    amount: number;
    currency: string;
    quantity: number;
    region: string;
    checkedAt: string;
    sourceUrl: string;
}

export interface CatalogProvenance {
    source: 'vendorPage' | 'zemax' | 'pdf' | 'manualSeed';
    url?: string;
    note: string;
    retrievedAt?: string;
}

export interface SphericalLensParams {
    kind: 'sphericalLens';
    focalLengthMm?: number;
    apertureRadiusMm: number;
    thicknessMm: number;
    r1Mm?: number | null;
    r2Mm?: number | null;
    ior?: number;
    material?: string;
}

export interface AsphericLensParams {
    kind: 'asphericLens';
    focalLengthMm?: number;
    apertureRadiusMm: number;
    thicknessMm: number;
    r1Mm: number;
    r2Mm: number;
    k1: number;
    k2: number;
    a1?: number[];
    a2?: number[];
    ior?: number;
    material?: string;
    surfaceSource?: OpticalSurfaceSource;
}

export interface CylindricalLensParams {
    kind: 'cylindricalLens';
    focalLengthMm?: number;
    apertureRadiusMm: number;
    widthMm: number;
    thicknessMm: number;
    r1Mm: number;
    r2Mm: number;
    ior?: number;
    material?: string;
}

export interface AchromatDoubletParams {
    kind: 'achromatDoublet';
    focalLengthMm?: number;
    apertureRadiusMm: number;
    r1Mm: number;
    r2Mm: number;
    r3Mm: number;
    t1Mm: number;
    t2Mm: number;
    ior1?: number;
    ior2?: number;
    glass1?: string;
    glass2?: string;
}

export interface ObjectiveParams {
    kind: 'objective';
    magnification: number;
    numericalAperture: number;
    workingDistanceMm: number;
    tubeLensFocalMm?: number;
    immersionIndex?: number;
    immersionMediumKind?: 'air' | 'oil' | 'water' | 'silicone' | 'custom';
    parfocalLengthMm?: number;
    coverGlassThicknessMm?: number;
    fieldNumberMm?: number;
    diameterMm?: number;
}

export interface PrismParams {
    kind: 'prism';
    prismType: 'rightAngle' | 'wedge' | 'equilateral' | 'polygon';
    widthMm: number;
    verticesMm: [number, number][];
    ior?: number;
    material?: string;
    apexAngleDeg?: number;
    legLengthMm?: number;
    wedgeAngleDeg?: number;
    deviationAngleDeg?: number;
}

export type NormalizedCatalogParams =
    | SphericalLensParams
    | AsphericLensParams
    | CylindricalLensParams
    | AchromatDoubletParams
    | ObjectiveParams
    | PrismParams
    | { kind: 'unknown' };

export interface CatalogPart {
    id: string;
    vendor: CatalogVendor;
    sku: string;
    title: string;
    productUrl: string;
    categoryPath: string[];
    componentType: CatalogComponentType;
    specs: Record<string, CatalogValue>;
    normalized: NormalizedCatalogParams;
    files: CatalogFile[];
    price?: CatalogPriceSnapshot;
    provenance: CatalogProvenance[];
    confidence: 'exact' | 'derived' | 'approximate';
    lastIndexed: string;
}

export interface CatalogAttachment {
    partId: string;
    vendor: CatalogVendor;
    sku: string;
    title: string;
    productUrl: string;
    snapshotVersion: string;
    attachedAt: string;
    confidence: CatalogPart['confidence'];
    price?: CatalogPriceSnapshot;
}
