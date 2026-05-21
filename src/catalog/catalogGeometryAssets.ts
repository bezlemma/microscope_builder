import type {
    CatalogComponentType,
    CatalogPart,
    CatalogVendor,
    NormalizedCatalogParams,
} from './types';
import { publicAssetUrlCandidates } from './publicAssetUrls';

export interface CatalogOpticalGeometryAsset {
    partId: string;
    sku: string;
    confidence: CatalogPart['confidence'];
    source: 'vendorPage' | 'zemax' | 'pdf' | 'manualSeed';
    sourceUrl?: string;
    normalized: NormalizedCatalogParams;
}

export interface CatalogOpticalGeometryPack {
    version: 1;
    generatedAt: string;
    vendor: CatalogVendor;
    componentType: CatalogComponentType;
    parts: Record<string, CatalogOpticalGeometryAsset>;
}

type GeometryFetch = (url: string) => Promise<Pick<Response, 'ok' | 'json' | 'status' | 'statusText'>>;

const THORLABS_GEOMETRY_PACK_BY_TYPE: Partial<Record<CatalogComponentType, string>> = {
    sphericalLens: '/catalog/optical/thorlabs/sphericalLens.geometries.json',
    asphericLens: '/catalog/optical/thorlabs/asphericLens.geometries.json',
    cylindricalLens: '/catalog/optical/thorlabs/cylindricalLens.geometries.json',
    achromatDoublet: '/catalog/optical/thorlabs/achromatDoublet.geometries.json',
    prism: '/catalog/optical/thorlabs/prism.geometries.json',
};

const packCache = new Map<string, Promise<CatalogOpticalGeometryPack | null>>();

function isCompatibleGeometry(part: CatalogPart, asset: CatalogOpticalGeometryAsset): boolean {
    return asset.partId === part.id && asset.normalized.kind === part.normalized.kind;
}

export function catalogGeometryPackUrlForPart(part: CatalogPart): string | null {
    if (part.vendor !== 'thorlabs') return null;
    return THORLABS_GEOMETRY_PACK_BY_TYPE[part.componentType] ?? null;
}

async function loadGeometryPack(url: string, fetcher: GeometryFetch): Promise<CatalogOpticalGeometryPack | null> {
    const existing = packCache.get(url);
    if (existing) return existing;

    const promise = (async () => {
        let lastFailure = '';
        try {
            for (const candidateUrl of publicAssetUrlCandidates(url)) {
                const response = await fetcher(candidateUrl);
                if (response.ok) return await response.json() as CatalogOpticalGeometryPack;
                lastFailure = `${candidateUrl} (${response.status} ${response.statusText})`;
            }
            console.warn(`Catalog geometry pack unavailable: ${url}${lastFailure ? `; last attempt ${lastFailure}` : ''}`);
            return null;
        } catch (error) {
            console.warn(`Catalog geometry pack failed to load: ${url}`, error);
            return null;
        }
    })();
    packCache.set(url, promise);
    return promise;
}

export async function resolveCatalogPartGeometry(
    part: CatalogPart,
    fetcher: GeometryFetch = fetch,
): Promise<CatalogPart> {
    const url = catalogGeometryPackUrlForPart(part);
    if (!url) return part;

    const pack = await loadGeometryPack(url, fetcher);
    const asset = pack?.parts[part.id];
    if (!asset || !isCompatibleGeometry(part, asset)) return part;

    return {
        ...part,
        normalized: asset.normalized,
        confidence: asset.confidence,
    };
}

export function prefetchCatalogGeometryForPart(part: CatalogPart): void {
    const url = catalogGeometryPackUrlForPart(part);
    if (!url) return;
    void loadGeometryPack(url, fetch);
}
