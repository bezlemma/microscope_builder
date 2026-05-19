import {
    decodePrescriptionBytes,
    normalizedParamsFromPrescription,
    parseOpticalPrescription,
} from './opticsImporter';
import type {
    CatalogComponentType,
    CatalogFile,
    CatalogFileKind,
    CatalogPart,
    NormalizedCatalogParams,
} from './types';

const OPTICAL_PRESCRIPTION_EXTENSIONS = new Set([
    'zmx',
    'zemax',
    'seq',
    'len',
    'dat',
    'txt',
    'csv',
    'tsv',
    'json',
]);

function extensionFromName(fileName: string): string {
    const path = fileName.split(/[?#]/)[0] ?? fileName;
    return path.toLowerCase().split('.').pop() ?? '';
}

export function isOpticalPrescriptionFileName(fileName: string): boolean {
    return OPTICAL_PRESCRIPTION_EXTENSIONS.has(extensionFromName(fileName));
}

function componentTypeFromNormalized(params: NormalizedCatalogParams): CatalogComponentType {
    switch (params.kind) {
        case 'sphericalLens': return 'sphericalLens';
        case 'asphericLens': return 'asphericLens';
        case 'cylindricalLens': return 'cylindricalLens';
        case 'achromatDoublet': return 'achromatDoublet';
        default: return 'unknown';
    }
}

function fileKindFromName(fileName: string): CatalogFileKind {
    const extension = extensionFromName(fileName);
    if (extension === 'zmx' || extension === 'zemax') return 'zemax';
    if (extension === 'seq') return 'codeV';
    if (extension === 'len' || extension === 'dat') return 'oslo';
    return 'opticStudio';
}

function mergeExactWithCatalogHints(
    exact: NormalizedCatalogParams,
    existing: NormalizedCatalogParams,
): NormalizedCatalogParams {
    if (exact.kind === 'unknown' || exact.kind !== existing.kind) return exact;

    const existingFocalLength = 'focalLengthMm' in existing ? existing.focalLengthMm : undefined;
    if (exact.kind === 'cylindricalLens' && existing.kind === 'cylindricalLens') {
        return {
            ...exact,
            ...(existingFocalLength !== undefined ? { focalLengthMm: exact.focalLengthMm ?? existingFocalLength } : {}),
            widthMm: existing.widthMm,
        };
    }
    if (existingFocalLength === undefined) return exact;

    if (exact.kind === 'sphericalLens') {
        return { ...exact, focalLengthMm: exact.focalLengthMm ?? existingFocalLength };
    }
    if (exact.kind === 'asphericLens') {
        return { ...exact, focalLengthMm: exact.focalLengthMm ?? existingFocalLength };
    }
    if (exact.kind === 'achromatDoublet') {
        return { ...exact, focalLengthMm: exact.focalLengthMm ?? existingFocalLength };
    }

    return exact;
}

function upsertCatalogFile(files: CatalogFile[], next: CatalogFile): CatalogFile[] {
    const existingIndex = files.findIndex(file => file.url === next.url || (next.localPath && file.localPath === next.localPath));
    if (existingIndex < 0) return [...files, next];
    return files.map((file, index) => index === existingIndex ? { ...file, ...next } : file);
}

export function enrichCatalogPartWithPrescriptionText(
    part: CatalogPart,
    text: string,
    fileName: string,
    sourceUrl = fileName,
    retrievedAt = new Date().toISOString().slice(0, 10),
): CatalogPart {
    const prescription = parseOpticalPrescription(text, fileName);
    const exactNormalized = normalizedParamsFromPrescription(prescription);
    const exactComponentType = componentTypeFromNormalized(exactNormalized);

    if (exactComponentType === 'unknown') {
        throw new Error(`Imported prescription for ${part.sku} does not map to a catalog lens component.`);
    }
    if (part.componentType !== exactComponentType) {
        throw new Error(`Imported prescription for ${part.sku} is ${exactComponentType}, but the catalog row is ${part.componentType}.`);
    }

    const prescriptionFile: CatalogFile = {
        kind: fileKindFromName(fileName),
        role: 'opticalPrescription',
        url: sourceUrl,
    };

    return {
        ...part,
        normalized: mergeExactWithCatalogHints(exactNormalized, part.normalized),
        files: upsertCatalogFile(part.files, prescriptionFile),
        provenance: [
            ...part.provenance,
            {
                source: 'zemax',
                url: sourceUrl,
                note: `Exact optical prescription imported through the universal importer (${prescription.format}).`,
                retrievedAt,
            },
        ],
        confidence: 'exact',
    };
}

export function enrichCatalogPartWithPrescriptionBytes(
    part: CatalogPart,
    bytes: Uint8Array | ArrayBuffer,
    fileName: string,
    sourceUrl = fileName,
    retrievedAt = new Date().toISOString().slice(0, 10),
): CatalogPart {
    const text = decodePrescriptionBytes(bytes, fileName);
    return enrichCatalogPartWithPrescriptionText(part, text, fileName, sourceUrl, retrievedAt);
}
