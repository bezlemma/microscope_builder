import React, { useMemo, useState } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens } from '../physics/components/AsphericLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Objective } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import { Mirror } from '../physics/components/Mirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Filter } from '../physics/components/Filter';
import { SpectralProfile } from '../physics/SpectralProfile';
import {
    applyCatalogPartToComponent,
    rankCatalogPartsForDesignComponent,
} from '../catalog/catalog';
import { casingLabelForCatalogPart, isCasedCatalogPart } from '../catalog/catalogCasing';
import type { CatalogPart } from '../catalog/types';
import { LensFamilyDesigner, type LensFamilyComponent } from './LensFamilyDesigner';
import { FoldOpticDesigner, SpectralProfileEditor, type FoldOpticComponent } from './FoldOpticDesigner';
import { MODAL_Z_INDEX } from './zLayers';

function formatCatalogNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    return value.toFixed(4).replace(/\.?0+$/, '');
}

function formatSpecValue(value: number | string | boolean): string {
    return typeof value === 'number' ? formatCatalogNumber(value) : String(value);
}

function humanizeSpecKey(key: string): string {
    const spaced = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/_/g, ' ');
    return spaced
        .split(/\s+/)
        .filter(Boolean)
        .map(word => {
            if (/^(ior|na|ct|et)$/i.test(word)) return word.toUpperCase();
            if (/^r\d$/i.test(word)) return word.toUpperCase();
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
}

function partSummary(part: CatalogPart): string {
    const f = part.specs.effectiveFocalLength?.value;
    const diameter = part.specs.diameter?.value;
    const length = part.specs.length?.value;
    const height = part.specs.height?.value;
    const clearAperture = part.specs.clearAperture?.value;
    const width = part.specs.width?.value;
    const coating = part.specs.coating?.value;
    const magnification = part.specs.magnification?.value;
    const na = part.specs.numericalAperture?.value;
    const workingDistance = part.specs.workingDistance?.value;
    const prismType = part.specs.prismType?.value;
    const legLength = part.specs.legLength?.value;
    const wedgeAngle = part.specs.wedgeAngle?.value;
    const splitRatio = part.specs.splitRatio?.value;
    const wavelengthRange = part.specs.wavelengthRange?.value;
    const cutoff = part.specs.cutoffWavelength?.value;
    const center = part.specs.centerWavelength?.value;
    const bandwidth = part.specs.bandwidth?.value;
    const focalLength = part.specs.focalLength?.value;
    const radiusOfCurvature = part.specs.radiusOfCurvature?.value;
    if (part.componentType === 'objective') {
        return [
            typeof magnification === 'number' ? `${formatCatalogNumber(magnification)}X` : null,
            typeof na === 'number' ? `NA ${formatCatalogNumber(na)}` : null,
            typeof workingDistance === 'number' ? `WD ${formatCatalogNumber(workingDistance)} mm` : null,
            typeof coating === 'string' ? coating : null,
        ].filter(Boolean).join(' · ');
    }
    if (part.componentType === 'prism') {
        return [
            typeof prismType === 'string' ? prismType : null,
            typeof legLength === 'number' ? `L=${formatCatalogNumber(legLength)} mm` : null,
            typeof wedgeAngle === 'number' ? `${formatCatalogNumber(wedgeAngle)}° wedge` : null,
            typeof coating === 'string' ? coating : null,
        ].filter(Boolean).join(' · ');
    }
    if (part.componentType === 'mirror' || part.componentType === 'curvedMirror') {
        const size = typeof diameter === 'number'
            ? `Ø${formatCatalogNumber(diameter)} mm`
            : (typeof length === 'number' && typeof height === 'number')
                ? `${formatCatalogNumber(length)} x ${formatCatalogNumber(height)} mm`
                : typeof width === 'number'
                    ? `${formatCatalogNumber(width)} mm wide`
                    : null;
        return [
            size,
            typeof focalLength === 'number' ? `f=${formatCatalogNumber(focalLength)} mm` : null,
            typeof radiusOfCurvature === 'number' ? `ROC ${formatCatalogNumber(radiusOfCurvature)} mm` : null,
            casingLabelForCatalogPart(part),
            typeof coating === 'string' ? coating : null,
        ].filter(Boolean).join(' · ');
    }
    if (part.componentType === 'beamSplitter' || part.componentType === 'polarizingBeamSplitter' || part.componentType === 'dichroic') {
        const size = typeof diameter === 'number'
            ? `Ø${formatCatalogNumber(diameter)} mm`
            : (typeof length === 'number' && typeof height === 'number')
                ? `${formatCatalogNumber(length)} x ${formatCatalogNumber(height)} mm`
                : typeof width === 'number'
                    ? `${formatCatalogNumber(width)} mm wide`
                    : null;
        return [
            size,
            typeof splitRatio === 'number' ? `R=${formatCatalogNumber(splitRatio * 100)}%` : null,
            typeof cutoff === 'number' ? `${formatCatalogNumber(cutoff)} nm` : null,
            typeof wavelengthRange === 'string' ? wavelengthRange : null,
            casingLabelForCatalogPart(part),
        ].filter(Boolean).join(' · ');
    }
    if (part.componentType === 'filter') {
        const size = typeof diameter === 'number'
            ? `Ø${formatCatalogNumber(diameter)} mm`
            : (typeof length === 'number' && typeof height === 'number')
                ? `${formatCatalogNumber(length)} x ${formatCatalogNumber(height)} mm`
                : typeof width === 'number'
                    ? `${formatCatalogNumber(width)} mm wide`
                    : null;
        return [
            size,
            typeof center === 'number' ? `CWL ${formatCatalogNumber(center)} nm` : null,
            typeof bandwidth === 'number' ? `FWHM ${formatCatalogNumber(bandwidth)} nm` : null,
            typeof cutoff === 'number' ? `${formatCatalogNumber(cutoff)} nm` : null,
            casingLabelForCatalogPart(part),
            typeof coating === 'string' ? coating : null,
        ].filter(Boolean).join(' · ');
    }
    const size = typeof diameter === 'number'
        ? `Ø${formatCatalogNumber(diameter)} mm`
        : (typeof length === 'number' && typeof height === 'number')
            ? `${formatCatalogNumber(length)} x ${formatCatalogNumber(height)} mm`
            : typeof width === 'number'
                ? `${formatCatalogNumber(width)} mm wide`
                : typeof clearAperture === 'number'
                    ? `CA ${formatCatalogNumber(clearAperture)} mm`
                    : null;
    return [
        size,
        typeof f === 'number' ? `f=${formatCatalogNumber(f)} mm` : null,
        casingLabelForCatalogPart(part),
        typeof coating === 'string' ? coating : null,
    ].filter(Boolean).join(' · ');
}

export { isCasedCatalogPart };

function isBareCatalogPart(part: CatalogPart): boolean {
    return !isCasedCatalogPart(part);
}

export function filterCatalogPartsByCasingPreference(parts: CatalogPart[], preferCased: boolean): CatalogPart[] {
    const cased = parts.filter(isCasedCatalogPart);
    const bare = parts.filter(isBareCatalogPart);
    if (preferCased) return cased.length > 0 ? cased : parts;
    return bare.length > 0 ? bare : parts;
}

export function applyCatalogPartToDesignLens(lens: SphericalLens, part: CatalogPart): boolean {
    return applyCatalogPartToDesignComponent(lens, part);
}

type CatalogDesignComponent = LensFamilyComponent | FoldOpticComponent | Filter;

function isLensFamilyComponent(component: CatalogDesignComponent): component is LensFamilyComponent {
    return component instanceof SphericalLens
        || component instanceof AsphericLens
        || component instanceof CylindricalLens
        || component instanceof AchromatDoublet
        || component instanceof Objective
        || component instanceof PrismLens;
}

function isFoldOpticComponent(component: CatalogDesignComponent): component is FoldOpticComponent {
    return component instanceof Mirror
        || component instanceof CurvedMirror
        || component instanceof BeamSplitter
        || component instanceof PolarizingBeamSplitter
        || component instanceof DichroicMirror;
}

function isFilterComponent(component: CatalogDesignComponent): component is Filter {
    return component instanceof Filter;
}

export function applyCatalogPartToDesignComponent(component: CatalogDesignComponent, part: CatalogPart): boolean {
    const applied = applyCatalogPartToComponent(component, part);
    if (applied) component.name = `${part.sku} design`;
    return applied;
}

function createDesignComponent(componentType?: string): CatalogDesignComponent | null {
    if (componentType === 'lens') return new SphericalLens(0.02, 12.7, 5, 'Catalog design');
    if (componentType === 'asphericLens') return new AsphericLens({ name: 'Catalog asphere design' });
    if (componentType === 'cylindricalLens') return new CylindricalLens(40, 1e9, 12, 24, 3, 'Catalog cylindrical design');
    if (componentType === 'achromatDoublet') return new AchromatDoublet();
    if (componentType === 'objective') return new Objective({ name: 'Catalog objective design' });
    if (componentType === 'prism') return new PrismLens(Math.PI / 3, 20, 20, 'Catalog prism design');
    if (componentType === 'mirror') return new Mirror(25.4, 6, 'Catalog mirror design');
    if (componentType === 'curvedMirror') return new CurvedMirror(25.4, 100, 6, 'Catalog curved mirror design');
    if (componentType === 'beamSplitter') return new BeamSplitter(25.4, 2, 0.5, 'Catalog beam splitter design');
    if (componentType === 'polarizingBeamSplitter') return new PolarizingBeamSplitter(25.4, 2, 'Catalog PBS design');
    if (componentType === 'dichroic') return new DichroicMirror(25.4, 1, new SpectralProfile('longpass', 500), 'Catalog dichroic design');
    if (componentType === 'filter') return new Filter(25.4, 3, new SpectralProfile('bandpass', 525, [{ center: 525, width: 50 }]), 'Catalog filter design');
    return null;
}

export const CatalogPartChooser: React.FC<{
    title: string;
    componentType?: string;
    parts: CatalogPart[];
    onCancel: () => void;
    onConfirm: (part: CatalogPart) => void;
}> = ({ title, componentType, parts, onCancel, onConfirm }) => {
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(parts[0]?.id ?? '');
    const [preferCased, setPreferCased] = useState(() => parts.some(isCasedCatalogPart));
    const [designComponent] = useState(() => createDesignComponent(componentType));
    const [designRevision, setDesignRevision] = useState(0);
    const hasDesigner = !!designComponent;
    const hasCasedParts = useMemo(() => parts.some(isCasedCatalogPart), [parts]);
    const hasBareParts = useMemo(() => parts.some(isBareCatalogPart), [parts]);
    const casingFilterEnabled = hasCasedParts && hasBareParts;
    const rankedParts = useMemo(() => (
        hasDesigner && designComponent ? rankCatalogPartsForDesignComponent(designComponent, parts) : parts
    ), [designComponent, designRevision, hasDesigner, parts]);
    const casingFilteredParts = useMemo(() => (
        filterCatalogPartsByCasingPreference(rankedParts, preferCased)
    ), [rankedParts, preferCased]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return casingFilteredParts;
        return casingFilteredParts.filter(part => [
            part.vendor,
            part.sku,
            part.title,
            part.categoryPath.join(' '),
            partSummary(part),
        ].join(' ').toLowerCase().includes(q));
    }, [casingFilteredParts, query]);
    const selected = filtered.find(part => part.id === selectedId) ?? filtered[0] ?? null;
    const casingModeLabel = hasCasedParts
        ? hasBareParts
            ? 'Cased / mounted'
            : 'Cased only'
        : 'Bare only';
    const casingCount = preferCased
        ? rankedParts.filter(isCasedCatalogPart).length
        : rankedParts.filter(isBareCatalogPart).length;
    const casingControl = (
        <label
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 8px',
                marginBottom: 9,
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 6,
                background: preferCased ? 'rgba(100,255,218,0.08)' : '#171c22',
                color: casingFilterEnabled ? '#dbe7f0' : '#7f8b95',
                fontSize: 11,
                fontWeight: 700,
                cursor: casingFilterEnabled ? 'pointer' : 'default',
                userSelect: 'none',
            }}
        >
            <input
                type="checkbox"
                checked={preferCased}
                disabled={!casingFilterEnabled}
                onChange={(event) => {
                    setPreferCased(event.target.checked);
                    setSelectedId('');
                }}
                style={{ accentColor: '#64ffda' }}
            />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {casingModeLabel}
            </span>
            <span style={{ marginLeft: 'auto', color: '#7f8b95', fontSize: 10 }}>
                {casingCount}
            </span>
        </label>
    );

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.46)',
                zIndex: MODAL_Z_INDEX,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 18,
                fontFamily: 'var(--ui-font)',
            }}
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div
                style={{
                    width: hasDesigner ? 'min(1060px, calc(100vw - 36px))' : 'min(720px, calc(100vw - 36px))',
                    maxHeight: 'min(680px, calc(var(--app-height, 100dvh) - 36px))',
                    display: 'grid',
                    gridTemplateRows: 'auto 1fr auto',
                    background: 'rgba(15, 18, 23, 0.96)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    boxShadow: '0 22px 80px rgba(0,0,0,0.65)',
                    color: '#eaf2fb',
                    overflow: 'hidden',
                }}
            >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <Search size={14} color="#64ffda" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search SKU, specs, coating..."
                        style={{
                            width: '100%',
                            background: '#1d2229',
                            border: '1px solid #37404a',
                            borderRadius: 5,
                            color: '#eaf2fb',
                            padding: '7px 8px',
                            fontFamily: 'var(--ui-font)',
                            fontSize: 12,
                        }}
                    />
                    <button
                        type="button"
                        aria-label="Close catalog selector"
                        onClick={onCancel}
                        style={{
                            marginLeft: 'auto',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: 5,
                            border: '1px solid transparent',
                            background: 'transparent',
                            color: '#9aa7b2',
                            cursor: 'pointer',
                        }}
                    >
                        <X size={16} />
                    </button>
                </label>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: hasDesigner
                        ? 'minmax(300px, 0.95fr) minmax(240px, 0.8fr) minmax(220px, 0.9fr)'
                        : 'minmax(240px, 0.95fr) minmax(220px, 1.05fr)',
                    minHeight: 260,
                    overflow: 'hidden',
                }}>
                    {hasDesigner && designComponent && (
                        <div style={{ overflowY: 'auto', borderRight: '1px solid rgba(255,255,255,0.08)', padding: 12 }}>
                            {casingControl}
                            {isLensFamilyComponent(designComponent) && (
                                <LensFamilyDesigner
                                    component={designComponent}
                                    onMutate={(mutate) => {
                                        mutate(designComponent);
                                        setSelectedId('');
                                        setDesignRevision(revision => revision + 1);
                                    }}
                                />
                            )}
                            {isFoldOpticComponent(designComponent) && (
                                <FoldOpticDesigner
                                    component={designComponent}
                                    onMutate={(mutate) => {
                                        mutate(designComponent);
                                        setSelectedId('');
                                        setDesignRevision(revision => revision + 1);
                                    }}
                                />
                            )}
                            {isFilterComponent(designComponent) && (
                                <SpectralProfileEditor
                                    label="Filter Spectrum"
                                    profile={designComponent.spectralProfile}
                                    onChange={(profile) => {
                                        designComponent.spectralProfile = profile;
                                        designComponent.version++;
                                        setSelectedId('');
                                        setDesignRevision(revision => revision + 1);
                                    }}
                                />
                            )}
                        </div>
                    )}
                    <div style={{ overflowY: 'auto', borderRight: '1px solid rgba(255,255,255,0.08)', padding: 8 }}>
                        {!hasDesigner && casingControl}
                        {hasDesigner && (
                            <div style={{ color: '#8d9aa5', fontSize: 10, fontWeight: 800, padding: '2px 3px 7px' }}>
                                CLOSEST CATALOG MATCHES
                            </div>
                        )}
                        {filtered.map(part => {
                            const selectedPart = selected?.id === part.id;
                            return (
                                <button
                                    key={part.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedId(part.id);
                                        if (hasDesigner && designComponent && applyCatalogPartToDesignComponent(designComponent, part)) {
                                            setDesignRevision(revision => revision + 1);
                                        }
                                    }}
                                    style={{
                                        width: '100%',
                                        display: 'block',
                                        textAlign: 'left',
                                        padding: '8px 9px',
                                        marginBottom: 5,
                                        borderRadius: 6,
                                        border: `1px solid ${selectedPart ? 'rgba(100,255,218,0.55)' : 'rgba(255,255,255,0.06)'}`,
                                        background: selectedPart ? 'rgba(100,255,218,0.12)' : '#1c2027',
                                        color: '#dbe7f0',
                                        cursor: 'pointer',
                                        fontFamily: 'var(--ui-font)',
                                    }}
                                >
                                    <div style={{ fontSize: 12, fontWeight: 800 }}>{part.vendor.toUpperCase()} {part.sku}</div>
                                    <div style={{ fontSize: 10, color: '#8d9aa5', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {partSummary(part) || part.title}
                                    </div>
                                </button>
                            );
                        })}
                        {filtered.length === 0 && (
                            <div style={{ padding: 12, color: '#77838d', fontSize: 12 }}>No matching catalog parts</div>
                        )}
                    </div>

                    <div style={{ padding: 14, overflowY: 'auto' }}>
                        {selected && (
                            <>
                                {selected.productUrl ? (
                                    <a
                                        href={selected.productUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={`Open ${selected.sku} on ${selected.vendor}`}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 5,
                                            color: '#64ffda',
                                            fontSize: 11,
                                            fontWeight: 800,
                                            marginBottom: 5,
                                            textDecoration: 'none',
                                        }}
                                    >
                                        <span>{selected.vendor.toUpperCase()} {selected.sku}</span>
                                        <ExternalLink size={12} />
                                    </a>
                                ) : (
                                    <div style={{ color: '#64ffda', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
                                        {selected.vendor.toUpperCase()} {selected.sku}
                                    </div>
                                )}
                                <div style={{ fontSize: 15, lineHeight: 1.3, fontWeight: 800, marginBottom: 10 }}>
                                    {selected.title}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                                    {Object.entries(selected.specs).filter(([key]) => key !== 'note').map(([key, spec]) => (
                                        <div key={key} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, padding: 7, background: '#191e25' }}>
                                            <div style={{ color: '#7c8994', fontSize: 9 }}>{humanizeSpecKey(key)}</div>
                                            <div style={{ color: '#eef6ff', fontSize: 11, marginTop: 2 }}>
                                                {formatSpecValue(spec.value)}{spec.unit ? ` ${spec.unit}` : ''}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <button
                        type="button"
                        onClick={onCancel}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: '1px solid #3e4650',
                            background: '#20252c',
                            color: '#cdd8e2',
                            cursor: 'pointer',
                            fontFamily: 'var(--ui-font)',
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={!selected}
                        onClick={() => selected && onConfirm(selected)}
                        style={{
                            padding: '8px 14px',
                            borderRadius: 6,
                            border: '1px solid rgba(100,255,218,0.45)',
                            background: selected ? '#0b5a4e' : '#30343a',
                            color: selected ? '#ecfffb' : '#7b858f',
                            cursor: selected ? 'pointer' : 'not-allowed',
                            fontFamily: 'var(--ui-font)',
                            fontWeight: 800,
                        }}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};
