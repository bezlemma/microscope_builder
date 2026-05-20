import type { CatalogPart } from './types';

export function isCasedCatalogPart(part: CatalogPart): boolean {
    const mounting = String(part.specs.mounting?.value ?? '').trim().toLowerCase();
    if (mounting === 'mounted') return true;
    if (mounting === 'unmounted') return false;
    if (part.specs.threading) return true;

    const text = `${part.title} ${part.categoryPath.join(' ')}`;
    if (/\bunmounted\b/i.test(text)) return false;
    return /\b(mounted|mount|housing|housed|cased|threaded)\b/i.test(text);
}

export function casingLabelForCatalogPart(part: CatalogPart): string | null {
    const mounting = String(part.specs.mounting?.value ?? '').trim();
    if (/^mounted$/i.test(mounting)) return 'Mounted';
    if (/^unmounted$/i.test(mounting)) return 'Bare';
    if (part.specs.threading) return 'Threaded';
    if (isCasedCatalogPart(part)) return 'Cased';
    return null;
}
