import type { CatalogFile, CatalogPart } from './types';
import { GENERATED_MECHANICAL_VISUAL_ASSETS } from './generatedMechanicalVisualAssets';

export type MechanicalVisualFormat = 'wrl' | 'stl' | 'glb' | 'gltf' | 'edrawings-json';

export interface CatalogMechanicalVisualAsset {
    partId: string;
    sku: string;
    format: MechanicalVisualFormat;
    url: string;
    sourceUrl: string;
    units: 'mm';
    generatedAt: string;
}

const MECHANICAL_ASSETS_BY_PART_ID = new Map(
    Object.entries(GENERATED_MECHANICAL_VISUAL_ASSETS),
);

export function mechanicalModelSourceForCatalogPart(part: CatalogPart | null | undefined): CatalogFile | null {
    if (!part) return null;
    return part.files.find(file =>
        file.role === 'mechanicalModel' &&
        (file.kind === 'step' || file.kind === 'solidworks')
    ) ?? null;
}

export function stepMechanicalModelSourceForCatalogPart(part: CatalogPart | null | undefined): CatalogFile | null {
    if (!part) return null;
    return part.files.find(file =>
        file.role === 'mechanicalModel' &&
        file.kind === 'step'
    ) ?? null;
}

export function mechanicalVisualAssetForCatalogPart(part: CatalogPart | null | undefined): CatalogMechanicalVisualAsset | null {
    if (!part) return null;
    return MECHANICAL_ASSETS_BY_PART_ID.get(part.id) ?? null;
}
