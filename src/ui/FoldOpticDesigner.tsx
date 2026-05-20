import React, { useCallback, useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { Mirror } from '../physics/components/Mirror';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { ForwardTracer } from '../physics/ForwardTracer';
import { SpectralProfile, type ProfilePreset } from '../physics/SpectralProfile';
import { wavelengthToCSS } from '../physics/spectral';
import { Coherence, createRay, defaultTransversePolarization } from '../physics/types';
import { ScrubInput } from './ScrubInput';
import { SpectrumChart } from './SpectrumChart';

export type FoldOpticComponent = Mirror | CurvedMirror | BeamSplitter | PolarizingBeamSplitter | DichroicMirror;
export type FoldOpticMutate = (mutate: (component: FoldOpticComponent) => void) => void;

function parseNumber(value: string): number {
    return Number.parseFloat(value.trim());
}

function formatNumber(value: number, digits = 3): string {
    if (!Number.isFinite(value)) return '0';
    return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

function updateCircularBounds(component: FoldOpticComponent): void {
    const radius = component.diameter / 2;
    component.bounds.set(
        new Vector3(-radius, -radius, -component.thickness / 2),
        new Vector3(radius, radius, component.thickness / 2),
    );
}

const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 6,
    marginBottom: 10,
};

const selectStyle: React.CSSProperties = {
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

const optionStyle: React.CSSProperties = {
    backgroundColor: '#1d2229',
    color: '#eaf2fb',
};

const defaultPreviewRayCount = 10;
const dichroicPreviewRayCount = 15;
const DEG30 = Math.PI / 6;
const SQRT1_2 = Math.SQRT1_2;

interface PreviewSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    opacity: number;
}

function cloneFoldOpticForPreview(component: FoldOpticComponent): FoldOpticComponent {
    if (component instanceof CurvedMirror) return new CurvedMirror(component.diameter, component.radiusOfCurvature, component.thickness, 'preview curved mirror');
    if (component instanceof DichroicMirror) return new DichroicMirror(component.diameter, component.thickness, component.spectralProfile.clone(), 'preview dichroic');
    if (component instanceof PolarizingBeamSplitter) return new PolarizingBeamSplitter(component.diameter, component.thickness, 'preview PBS');
    if (component instanceof BeamSplitter) return new BeamSplitter(component.diameter, component.thickness, component.splitRatio, 'preview beam splitter');
    return new Mirror(component.diameter, component.thickness, 'preview mirror');
}

function previewNormal(component: FoldOpticComponent): Vector3 {
    if (component instanceof CurvedMirror) return new Vector3(-1, 0, 0);
    if (component instanceof BeamSplitter || component instanceof PolarizingBeamSplitter || component instanceof DichroicMirror) {
        return new Vector3(-SQRT1_2, SQRT1_2, 0);
    }
    return new Vector3(-Math.cos(DEG30), Math.sin(DEG30), 0);
}

export function getFoldOpticPreviewRayCount(component: FoldOpticComponent): number {
    return component instanceof DichroicMirror ? dichroicPreviewRayCount : defaultPreviewRayCount;
}

export function getFoldOpticPreviewRayOffsets(component: FoldOpticComponent): number[] {
    const rayCount = getFoldOpticPreviewRayCount(component);
    const radius = Math.max(0.5, component.diameter / 2);
    const normal = previewNormal(component).normalize();
    const halfSpan = component instanceof CurvedMirror
        ? radius * 0.92
        : radius * Math.max(0.05, Math.abs(normal.x)) * 0.92;
    return Array.from({ length: rayCount }, (_, index) => (
        -halfSpan + (2 * halfSpan * index) / Math.max(1, rayCount - 1)
    ));
}

export function getFoldOpticPreviewWavelengthNm(component: FoldOpticComponent, index: number, rayCount: number): number {
    if (!(component instanceof DichroicMirror)) return 550;
    return 380 + ((800 - 380) * index) / Math.max(1, rayCount - 1);
}

function buildFlatOpticPolygon(normal: Vector3, aperture: number, thickness: number, scale: number, centerX: number, centerY: number): string {
    const n = normal.clone().normalize();
    const tangent = new Vector3(-n.y, n.x, 0).normalize();
    const halfAperture = aperture / 2;
    const halfThickness = Math.max(0.05, thickness) / 2;
    const corners = [
        tangent.clone().multiplyScalar(-halfAperture).add(n.clone().multiplyScalar(-halfThickness)),
        tangent.clone().multiplyScalar(halfAperture).add(n.clone().multiplyScalar(-halfThickness)),
        tangent.clone().multiplyScalar(halfAperture).add(n.clone().multiplyScalar(halfThickness)),
        tangent.clone().multiplyScalar(-halfAperture).add(n.clone().multiplyScalar(halfThickness)),
    ];
    return corners.map(point => `${centerX + point.x * scale},${centerY - point.y * scale}`).join(' ');
}

function tracedPreviewSegments(
    component: FoldOpticComponent,
    rayOffsets: number[],
    scale: number,
    centerX: number,
    centerY: number,
): PreviewSegment[] {
    const previewComponent = cloneFoldOpticForPreview(component);
    const normal = previewNormal(component);
    previewComponent.setPosition(0, 0, 0);
    previewComponent.pointAlong(normal.x, normal.y, normal.z);
    if (previewComponent instanceof CurvedMirror) previewComponent.invalidateMesh();

    const sourceDirection = new Vector3(1, 0, 0);
    const sourceX = (24 - centerX) / scale;
    const tailDistance = 286 / scale;
    const sources = rayOffsets.map((offset, index) => {
        const wavelengthNm = getFoldOpticPreviewWavelengthNm(component, index, rayOffsets.length);
        return createRay({
            origin: new Vector3(sourceX, offset, 0),
            direction: sourceDirection,
            wavelength: wavelengthNm * 1e-9,
            intensity: 1,
            polarization: defaultTransversePolarization(sourceDirection),
            opticalPathLength: 0,
            footprintRadius: 0.05,
            coherenceMode: Coherence.Coherent,
            sourceId: `fold-preview-${index}`,
            sourceKind: 'laser',
            isMainRay: index === Math.floor(rayOffsets.length / 2),
        });
    });

    const paths = new ForwardTracer([previewComponent]).trace(sources);
    const segments = new Map<string, PreviewSegment>();
    const toSvg = (point: Vector3) => ({
        x: centerX + point.x * scale,
        y: centerY - point.y * scale,
    });

    for (const path of paths) {
        for (const ray of path) {
            const start = toSvg(ray.origin);
            const distance = ray.interactionDistance ?? tailDistance;
            const endPoint = ray.terminationPoint ?? ray.origin.clone().add(ray.direction.clone().multiplyScalar(distance));
            const end = toSvg(endPoint);
            const key = [
                ray.sourceId,
                ray.wavelength.toPrecision(6),
                start.x.toFixed(2),
                start.y.toFixed(2),
                end.x.toFixed(2),
                end.y.toFixed(2),
            ].join(':');
            segments.set(key, {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                color: component instanceof DichroicMirror ? wavelengthToCSS(ray.wavelength * 1e9) : '#ffcf66',
                opacity: Math.max(0.12, Math.min(0.58, 0.18 + 0.40 * Math.sqrt(Math.max(0, ray.intensity)))),
            });
        }
    }

    return [...segments.values()];
}

const FoldOpticPreview: React.FC<{ component: FoldOpticComponent }> = ({ component }) => {
    const aperture = Math.max(1, component.diameter);
    const thickness = Math.max(0.1, component.thickness);
    const curved = component instanceof CurvedMirror;
    const beamSplitter = component instanceof BeamSplitter || component instanceof PolarizingBeamSplitter || component instanceof DichroicMirror;
    const scale = 120 / Math.max(aperture, thickness * 3, 1);
    const width = Math.max(14, thickness * scale);
    const height = Math.max(36, aperture * scale);
    const opticCenterX = 170;
    const opticCenterY = 105;
    const rayOffsets = getFoldOpticPreviewRayOffsets(component);
    const color = component instanceof Mirror || component instanceof CurvedMirror
        ? '#eef4f7'
        : component instanceof DichroicMirror
            ? '#7bd4ff'
            : '#9dd8ff';
    const curvedVertexX = 238;
    const curvedApertureRadius = Math.min(70, height / 2);
    const curvedRocPx = curved
        ? Math.max(curvedApertureRadius * 1.08, Math.min(900, Math.abs(component.radiusOfCurvature) * scale))
        : 240;
    const curvedCenterX = curvedVertexX - curvedRocPx;
    const curvedSurfaceX = (hitY: number) => {
        const dy = hitY - opticCenterY;
        return curvedCenterX + Math.sqrt(Math.max(0, curvedRocPx * curvedRocPx - dy * dy));
    };
    const curvedTopY = opticCenterY - curvedApertureRadius;
    const curvedBottomY = opticCenterY + curvedApertureRadius;
    const curvedEdgeX = curvedSurfaceX(curvedTopY);
    const curvedBackX = curvedVertexX + width;
    const curvedBackEdgeX = curvedEdgeX + width * 0.92;
    const curvedPath = `M ${curvedEdgeX} ${curvedTopY} Q ${curvedVertexX} ${opticCenterY} ${curvedEdgeX} ${curvedBottomY} L ${curvedBackEdgeX} ${curvedBottomY} Q ${curvedBackX} ${opticCenterY} ${curvedBackEdgeX} ${curvedTopY} Z`;
    const traceCenterX = curved ? curvedVertexX + (component.thickness / 2) * scale : opticCenterX;
    const previewSegments = tracedPreviewSegments(component, rayOffsets, scale, traceCenterX, opticCenterY);
    const flatPolygon = !curved
        ? buildFlatOpticPolygon(previewNormal(component), aperture, thickness, scale, opticCenterX, opticCenterY)
        : '';

    return (
        <svg viewBox="0 0 320 210" style={{ width: '100%', height: 210, display: 'block', marginBottom: 10 }}>
            <rect x="0" y="0" width="320" height="210" rx="7" fill="#11161c" stroke="rgba(255,255,255,0.08)" />
            {previewSegments.map((segment, index) => (
                <line
                    key={index}
                    x1={segment.x1}
                    y1={segment.y1}
                    x2={segment.x2}
                    y2={segment.y2}
                    stroke={segment.color}
                    strokeOpacity={segment.opacity}
                    strokeWidth={component instanceof DichroicMirror ? 1.6 : beamSplitter ? 1.8 : 2}
                />
            ))}
            {curved ? (
                <>
                    <path
                        d={curvedPath}
                        fill={color}
                        fillOpacity="0.75"
                        stroke="#000"
                        strokeWidth="1.4"
                    />
                    <path
                        d={`M ${curvedEdgeX} ${curvedTopY} Q ${curvedVertexX} ${opticCenterY} ${curvedEdgeX} ${curvedBottomY}`}
                        fill="none"
                        stroke="#ffffff"
                        strokeOpacity="0.75"
                        strokeWidth="2"
                    />
                </>
            ) : (
                <polygon
                    points={flatPolygon}
                    fill={color}
                    fillOpacity={beamSplitter ? 0.55 : 0.86}
                    stroke="#000"
                    strokeWidth="1.4"
                />
            )}
            {component instanceof BeamSplitter && (
                <text x="160" y="192" textAnchor="middle" fill="#8d9aa5" fontSize="10" fontFamily="var(--ui-font)">
                    R {Math.round(component.splitRatio * 100)}%
                </text>
            )}
            {component instanceof DichroicMirror && (
                <text x="160" y="192" textAnchor="middle" fill="#8d9aa5" fontSize="10" fontFamily="var(--ui-font)">
                    {component.spectralProfile.getLabel()}
                </text>
            )}
        </svg>
    );
};

export const SpectralProfileEditor: React.FC<{
    label: string;
    profile: SpectralProfile;
    onChange: (profile: SpectralProfile) => void;
}> = ({ label, profile, onChange }) => {
    const [preset, setPreset] = useState<ProfilePreset>(profile.preset);
    const [cutoff, setCutoff] = useState(String(profile.cutoffNm));
    const [center, setCenter] = useState(String(profile.bands[0]?.center ?? 525));
    const [width, setWidth] = useState(String(profile.bands[0]?.width ?? 50));
    const [edge, setEdge] = useState(String(profile.edgeSteepness));
    const [bands, setBands] = useState<{ center: string; width: string }[]>(
        profile.bands.length > 0
            ? profile.bands.map(band => ({ center: String(band.center), width: String(band.width) }))
            : [{ center: '525', width: '50' }],
    );

    useEffect(() => {
        setPreset(profile.preset);
        setCutoff(String(profile.cutoffNm));
        setEdge(String(profile.edgeSteepness));
        if (profile.bands.length > 0) {
            setCenter(String(profile.bands[0].center));
            setWidth(String(profile.bands[0].width));
            setBands(profile.bands.map(band => ({ center: String(band.center), width: String(band.width) })));
        } else {
            setBands([{ center: '525', width: '50' }]);
        }
    }, [profile, profile.preset, profile.cutoffNm, profile.edgeSteepness, profile.bands]);

    const commit = useCallback((nextPreset = preset, nextBands = bands) => {
        const parsedCutoff = parseNumber(cutoff);
        const parsedCenter = parseNumber(center);
        const parsedWidth = parseNumber(width);
        const parsedEdge = parseNumber(edge);
        const fallbackBand = {
            center: Number.isFinite(parsedCenter) ? parsedCenter : 525,
            width: Number.isFinite(parsedWidth) ? parsedWidth : 50,
        };
        const normalizedBands = nextPreset === 'bandpass'
            ? [fallbackBand]
            : nextPreset === 'multiband'
                ? nextBands.map(band => ({
                    center: parseNumber(band.center) || fallbackBand.center,
                    width: parseNumber(band.width) || fallbackBand.width,
                }))
                : profile.bands;
        onChange(new SpectralProfile(
            nextPreset,
            Number.isFinite(parsedCutoff) ? parsedCutoff : 500,
            normalizedBands.length > 0 ? normalizedBands : [fallbackBand],
            Number.isFinite(parsedEdge) ? parsedEdge : 15,
        ));
    }, [bands, center, cutoff, edge, onChange, preset, profile.bands, width]);

    const updateBand = (index: number, field: 'center' | 'width', value: string): { center: string; width: string }[] => {
        const next = bands.slice();
        next[index] = { ...next[index], [field]: value };
        setBands(next);
        return next;
    };

    return (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 9, marginTop: 2 }}>
            <label style={{ fontSize: 11, color: '#8d9aa5', display: 'block', marginBottom: 8 }}>
                {label}: {profile.getLabel()}
            </label>
            <div style={{ marginBottom: 9 }}>
                <SpectrumChart profile={profile} width={280} height={94} />
            </div>
            <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: '#8d9aa5', display: 'block', marginBottom: 4 }}>Type</label>
                <select
                    value={preset}
                    onChange={(event) => {
                        const nextPreset = event.target.value as ProfilePreset;
                        setPreset(nextPreset);
                        commit(nextPreset);
                    }}
                    style={selectStyle}
                >
                    <option style={optionStyle} value="longpass">Longpass</option>
                    <option style={optionStyle} value="shortpass">Shortpass</option>
                    <option style={optionStyle} value="bandpass">Bandpass</option>
                    <option style={optionStyle} value="multiband">Multiband</option>
                </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                {(preset === 'longpass' || preset === 'shortpass') && (
                    <ScrubInput label="Cutoff" suffix="nm" value={cutoff} onChange={setCutoff} onCommit={() => commit()} speed={2} min={350} max={850} />
                )}
                {preset === 'bandpass' && (
                    <>
                        <ScrubInput label="Center" suffix="nm" value={center} onChange={setCenter} onCommit={() => commit()} speed={2} min={350} max={850} />
                        <ScrubInput label="Width" suffix="nm" value={width} onChange={setWidth} onCommit={() => commit()} speed={1} min={5} max={300} />
                    </>
                )}
            </div>
            {preset === 'multiband' && (
                <div style={{ marginTop: 8 }}>
                    {bands.map((band, index) => (
                        <div key={index} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 1fr 22px', gap: 5, alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 10, color: '#8d9aa5' }}>#{index + 1}</span>
                            <ScrubInput
                                label="λ"
                                suffix="nm"
                                value={band.center}
                                onChange={(value) => updateBand(index, 'center', value)}
                                onCommit={(value) => commit(preset, updateBand(index, 'center', value))}
                                speed={2}
                                min={350}
                                max={850}
                            />
                            <ScrubInput
                                label="W"
                                suffix="nm"
                                value={band.width}
                                onChange={(value) => updateBand(index, 'width', value)}
                                onCommit={(value) => commit(preset, updateBand(index, 'width', value))}
                                speed={1}
                                min={5}
                                max={300}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const next = bands.filter((_, bandIndex) => bandIndex !== index);
                                    const normalized = next.length > 0 ? next : [{ center: '525', width: '50' }];
                                    setBands(normalized);
                                    commit(preset, normalized);
                                }}
                                disabled={bands.length <= 1}
                                style={{
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    background: 'transparent',
                                    color: bands.length <= 1 ? '#53606b' : '#ff8b8b',
                                    borderRadius: 4,
                                    cursor: bands.length <= 1 ? 'default' : 'pointer',
                                    height: 22,
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            const next = [...bands, { center: '600', width: '40' }];
                            setBands(next);
                            commit(preset, next);
                        }}
                        style={{
                            width: '100%',
                            padding: '4px 8px',
                            background: '#1c2b23',
                            border: '1px solid #335f48',
                            borderRadius: 5,
                            color: '#a8e6c1',
                            cursor: 'pointer',
                            fontSize: 11,
                        }}
                    >
                        Add Band
                    </button>
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginTop: 8 }}>
                <ScrubInput label="Edge" suffix="nm" value={edge} onChange={setEdge} onCommit={() => commit()} speed={0.5} min={1} max={50} title="Edge steepness — smaller = sharper transition" />
            </div>
        </div>
    );
};

export const FoldOpticDesigner: React.FC<{
    component: FoldOpticComponent;
    onMutate: FoldOpticMutate;
}> = ({ component, onMutate }) => {
    const [diameter, setDiameter] = useState('25.4');
    const [thickness, setThickness] = useState('2');
    const [radiusOfCurvature, setRadiusOfCurvature] = useState('100');
    const [focalLength, setFocalLength] = useState('50');
    const [splitRatio, setSplitRatio] = useState('0.5');

    useEffect(() => {
        setDiameter(formatNumber(component.diameter));
        setThickness(formatNumber(component.thickness));
        if (component instanceof CurvedMirror) {
            setRadiusOfCurvature(formatNumber(component.radiusOfCurvature));
            setFocalLength(formatNumber(component.focalLength));
        }
        if (component instanceof BeamSplitter) setSplitRatio(formatNumber(component.splitRatio, 4));
    }, [
        component,
        component.version,
        component.diameter,
        component.thickness,
        component instanceof CurvedMirror ? component.radiusOfCurvature : undefined,
        component instanceof CurvedMirror ? component.focalLength : undefined,
        component instanceof BeamSplitter ? component.splitRatio : undefined,
    ]);

    const mutateComponent = useCallback((mutate: (target: FoldOpticComponent) => void) => {
        onMutate((target) => {
            mutate(target);
            updateCircularBounds(target);
            if (target instanceof CurvedMirror) target.invalidateMesh();
        });
    }, [onMutate]);

    const commitBase = useCallback((param: 'diameter' | 'thickness', value: string) => {
        const parsed = parseNumber(value);
        if (!Number.isFinite(parsed)) return;
        mutateComponent((target) => {
            if (param === 'diameter') target.diameter = Math.max(0.5, parsed);
            else target.thickness = Math.max(0.05, parsed);
        });
    }, [mutateComponent]);

    const commitCurved = useCallback((value: string) => {
        const parsed = parseNumber(value);
        if (!Number.isFinite(parsed)) return;
        mutateComponent((target) => {
            if (target instanceof CurvedMirror) target.radiusOfCurvature = Math.abs(parsed) < 1e-6 ? 1e9 : parsed;
        });
    }, [mutateComponent]);

    const commitCurvedFocal = useCallback((value: string) => {
        const parsed = parseNumber(value);
        if (!Number.isFinite(parsed)) return;
        mutateComponent((target) => {
            if (target instanceof CurvedMirror) target.radiusOfCurvature = Math.abs(parsed) < 1e-6 ? 1e9 : 2 * parsed;
        });
    }, [mutateComponent]);

    const commitSplit = useCallback((value: string) => {
        const parsed = parseNumber(value);
        if (!Number.isFinite(parsed)) return;
        mutateComponent((target) => {
            if (target instanceof BeamSplitter) target.splitRatio = Math.max(0, Math.min(1, parsed));
        });
    }, [mutateComponent]);

    const commitDichroicSpectrum = useCallback((profile: SpectralProfile) => {
        mutateComponent((target) => {
            if (target instanceof DichroicMirror) {
                target.spectralProfile = profile;
            }
        });
    }, [mutateComponent]);

    return (
        <div>
            <FoldOpticPreview component={component} />
            <div style={gridStyle}>
                <ScrubInput label="Diameter" suffix="mm" value={diameter} onChange={setDiameter} onCommit={(v) => commitBase('diameter', v)} speed={0.4} min={0.5} max={200} step={0.1} />
                <ScrubInput label="Thickness" suffix="mm" value={thickness} onChange={setThickness} onCommit={(v) => commitBase('thickness', v)} speed={0.1} min={0.05} max={80} step={0.05} />
                {component instanceof CurvedMirror && (
                    <ScrubInput label="ROC" suffix="mm" value={radiusOfCurvature} onChange={setRadiusOfCurvature} onCommit={commitCurved} speed={1.0} min={-5000} max={5000} step={0.1} />
                )}
                {component instanceof CurvedMirror && (
                    <ScrubInput label="Focal Len" suffix="mm" value={focalLength} onChange={setFocalLength} onCommit={commitCurvedFocal} speed={1.0} min={-2500} max={2500} step={0.1} />
                )}
                {component instanceof BeamSplitter && (
                    <ScrubInput label="Reflect" value={splitRatio} onChange={setSplitRatio} onCommit={commitSplit} speed={0.01} min={0} max={1} step={0.01} />
                )}
            </div>
            {component instanceof DichroicMirror && (
                <SpectralProfileEditor
                    label="Dichroic Spectrum"
                    profile={component.spectralProfile}
                    onChange={commitDichroicSpectrum}
                />
            )}
        </div>
    );
};
