export type DisplayMapping = 'linear' | 'gamma' | 'log';

export function nextDisplayMapping(mapping: DisplayMapping): DisplayMapping {
    if (mapping === 'linear') return 'gamma';
    if (mapping === 'gamma') return 'log';
    return 'linear';
}

export function displayMappingLabel(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'LIN';
    if (mapping === 'gamma') return 'GAM';
    return 'LOG';
}

export function displayMappingTitle(mapping: DisplayMapping): string {
    if (mapping === 'linear') return 'Switch to gamma display';
    if (mapping === 'gamma') return 'Switch to log display';
    return 'Switch to linear display';
}

export function mapDisplayValue(normalized: number, mapping: DisplayMapping): number {
    const safe = Math.max(0, Math.min(1, normalized));
    if (mapping === 'linear') return safe;
    if (mapping === 'log') return Math.log10(1 + safe * 2047) / Math.log10(2048);
    return Math.pow(safe, 0.45);
}
