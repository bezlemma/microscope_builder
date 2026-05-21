import type { CSSProperties } from 'react';

export function parseLensNumber(value: string): number {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'infinity') return 1e9;
    if (trimmed === '-infinity') return -1e9;
    return Number.parseFloat(value);
}

export function formatLensNumber(value: number, digits = 2): string {
    if (Math.abs(value) >= 1e6) return value >= 0 ? 'Infinity' : '-Infinity';
    return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export function clampRadiusOfCurvature(value: number, apertureRadius: number): number {
    if (Math.abs(value) >= 1e8) return value;
    const minR = apertureRadius * 1.05;
    if (Math.abs(value) >= minR) return value;
    return Math.sign(value || 1) * minR;
}

export const designerGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 6,
    marginBottom: 10,
};

export const designerCompactGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 6,
    marginBottom: 10,
};

export const designerSelectStyle: CSSProperties = {
    backgroundColor: '#1d2229',
    border: '1px solid #37404a',
    color: '#eaf2fb',
    fontWeight: 500,
    outline: 'none',
    padding: '4px 6px',
    borderRadius: 5,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    cursor: 'pointer',
};

export const designerOptionStyle: CSSProperties = {
    backgroundColor: '#1d2229',
    color: '#eaf2fb',
};
