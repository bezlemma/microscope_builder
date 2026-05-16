import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Ruler, Trash2 } from 'lucide-react';
import { useIsMobile } from './useIsMobile';
import { useHaptic } from './useHaptic';
import { useAtom } from 'jotai';
import {
    componentsAtom,
    selectionAtom,
    pinnedViewersAtom,
    rayConfigAtom,
    setVisualizationModeAtom,
    solver3RenderTriggerAtom,
    solver3RenderingAtom,
    pushUndoAtom,
    animatorAtom,
    animationPlayingAtom,
    animationSpeedAtom,
    scanAccumTriggerAtom,
    scanAccumProgressAtom,
    solverDiagnosticsAtom,
    selectedRodAtom,
    rodPathsAtom,
    MAX_FORWARD_RAY_COUNT,
    MAX_REVERSE_PATH_COUNT,
    MIN_FORWARD_RAY_COUNT,
    MIN_REVERSE_PATH_COUNT,
    OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT,
    drawnRayCountsAtom,
    uiLockedAtom,
    measurementAtom,
} from '../state/store';
import type { RayConfig, Measurement, MeasurementDrawMode, MeasurementPlaneMode, MeasurementPoint } from '../state/store';
import { RodPropertiesPanel } from './RodPropertiesPanel';
import { generateChannelId, AnimationChannel, PropertyAnimator } from '../physics/PropertyAnimator';
import { Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { AsphericLens, AsphericPreset, ASPHERE_MAX_TERMS } from '../physics/components/AsphericLens';
import { AchromatDoublet } from '../physics/components/AchromatDoublet';
import { Mirror } from '../physics/components/Mirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';

import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { IdealLens } from '../physics/components/IdealLens';
import { Objective } from '../physics/components/Objective';
import { AbstractPolygonOptic } from '../physics/components/AbstractPolygonOptic';
import { Waveplate } from '../physics/components/Waveplate';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { Diffuser } from '../physics/components/Diffuser';
import { DoubleSlit } from '../physics/components/DoubleSlit';
import { Annotation } from '../physics/components/Annotation';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { TrappedBead } from '../physics/components/TrappedBead';
import { PMT, derivePMTScanResolution } from '../physics/components/PMT';
import { PupilMaskElement } from '../physics/components/PupilMaskElement';
import { MediumVolume } from '../physics/components/MediumVolume';
import { PointSourceBase } from '../physics/components/PointSourceBase';
import { ConeSource3D } from '../physics/components/ConeSource3D';
import { WedgeSource2D } from '../physics/components/WedgeSource2D';
import { StructuredSource } from '../physics/components/StructuredSource';
import { FaradayIsolator } from '../physics/components/FaradayIsolator';
import { QPD } from '../physics/components/QPD';
import { AOD } from '../physics/components/AOD';
import { SpectralProfile, ProfilePreset } from '../physics/SpectralProfile';
import { ScrubInput } from './ScrubInput';
import { SpectrumChart } from './SpectrumChart';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';
import { PMTViewer } from './PMTViewer';
import { QPDViewer } from './QPDViewer';
import { LensProfileEditor, supportsLensProfileEditor } from './LensProfileEditor';
import { getComponentCapabilities } from './componentPresentation';

import { wavelengthToCSS as wavelengthToColor, isVisibleSpectrum } from '../physics/spectral';
import { snapToRingBoundary } from '../physics/SourceRayFactory';
import { findMaxUnclippedScanHalfAngleDeg, measureChiefRayForScan } from '../physics/confocalScanDiagnostics';

function clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

const COUNT_SLIDER_STEPS = 1000;
const MEDIUM_INDEX_PRESETS = [
    { label: 'Air', value: 1.0 },
    { label: 'Water', value: 1.33 },
    { label: 'Oil', value: 1.515 },
] as const;

function countToSliderPosition(value: number, min: number, max: number): number {
    const clamped = clampValue(value, min, max);
    const minLog = Math.log(min);
    const maxLog = Math.log(max);
    if (maxLog - minLog < 1e-9) return 0;
    const t = (Math.log(clamped) - minLog) / (maxLog - minLog);
    return Math.round(t * COUNT_SLIDER_STEPS);
}

function sliderPositionToCount(position: number, min: number, max: number): number {
    const clamped = clampValue(position, 0, COUNT_SLIDER_STEPS);
    const minLog = Math.log(min);
    const maxLog = Math.log(max);
    const t = clamped / COUNT_SLIDER_STEPS;
    return Math.round(Math.exp(minLog + (maxLog - minLog) * t));
}

function stickyForwardRodCount(value: number): number {
    const clamped = clampValue(value, MIN_FORWARD_RAY_COUNT, MAX_FORWARD_RAY_COUNT);
    const nice = snapToRingBoundary(clamped);
    const threshold = nice >= 24 ? 2 : 1;
    return Math.abs(clamped - nice) <= threshold ? nice : clamped;
}

function formatMeasurementMm(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
}

function formatSignedMeasurementMm(value: number): string {
    return `${value >= 0 ? '+' : '-'}${formatMeasurementMm(Math.abs(value))}`;
}

function measurementSegmentStats(a: MeasurementPoint, b: MeasurementPoint) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return {
        dx,
        dy,
        dz,
        length: Math.hypot(dx, dy, dz),
        xy: Math.hypot(dx, dy),
        xz: Math.hypot(dx, dz),
        yz: Math.hypot(dy, dz),
    };
}

function distanceForPlane(stats: ReturnType<typeof measurementSegmentStats>, planeMode: MeasurementPlaneMode): number {
    switch (planeMode) {
        case 'xy': return stats.xy;
        case 'xz': return stats.xz;
        case 'yz': return stats.yz;
        default: return stats.length;
    }
}

function planeModeLabel(planeMode: MeasurementPlaneMode): string {
    switch (planeMode) {
        case 'xy': return 'XY';
        case 'xz': return 'XZ';
        case 'yz': return 'YZ';
        default: return '3D';
    }
}

function measurementAngleDeg(a: MeasurementPoint, b: MeasurementPoint, c: MeasurementPoint, planeMode: MeasurementPlaneMode): number | null {
    const ba = new Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
    const bc = new Vector3(c.x - b.x, c.y - b.y, c.z - b.z);
    if (planeMode === 'xy') {
        ba.z = 0;
        bc.z = 0;
    } else if (planeMode === 'xz') {
        ba.y = 0;
        bc.y = 0;
    } else if (planeMode === 'yz') {
        ba.x = 0;
        bc.x = 0;
    }
    if (ba.lengthSq() < 1e-10 || bc.lengthSq() < 1e-10) return null;
    const angle = Math.acos(Math.max(-1, Math.min(1, ba.normalize().dot(bc.normalize()))));
    return angle * 180 / Math.PI;
}

const CoordinateInput: React.FC<{
    label: string;
    value: number;
    onChange: (value: number) => void;
}> = ({ label, value, onChange }) => {
    const [text, setText] = React.useState(formatMeasurementMm(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
        if (!focused) setText(formatMeasurementMm(value));
    }, [focused, value]);

    return (
        <label style={{ display: 'grid', gridTemplateColumns: '12px 1fr', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#88a8bf', fontSize: 9 }}>{label}</span>
            <input
                type="number"
                step="0.1"
                value={text}
                onFocus={() => setFocused(true)}
                onChange={(event) => {
                    const next = event.target.value;
                    setText(next);
                    const parsed = Number(next);
                    if (Number.isFinite(parsed)) onChange(parsed);
                }}
                onBlur={() => {
                    setFocused(false);
                    const parsed = Number(text);
                    setText(Number.isFinite(parsed) ? formatMeasurementMm(parsed) : formatMeasurementMm(value));
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        (event.currentTarget as HTMLInputElement).blur();
                    }
                }}
                style={{
                    width: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    background: 'rgba(0, 12, 24, 0.75)',
                    color: '#d9efff',
                    border: '1px solid rgba(0, 127, 255, 0.35)',
                    borderRadius: 3,
                    padding: '1px 3px',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                }}
            />
        </label>
    );
};

const MeasurementReadout: React.FC<{
    measurement: Measurement;
    index: number;
    planeMode: MeasurementPlaneMode;
    showProjected: boolean;
    onDelete: () => void;
    onPointChange: (pointIndex: number, point: MeasurementPoint) => void;
}> = ({ measurement, index, planeMode, showProjected, onDelete, onPointChange }) => {
    const [a, b, c] = measurement.points;
    const ab = a && b ? measurementSegmentStats(a, b) : null;
    const bc = b && c ? measurementSegmentStats(b, c) : null;
    const angle = a && b && c ? measurementAngleDeg(a, b, c, planeMode) : null;
    const planeLabel = planeModeLabel(planeMode);
    const pointLabels = ['A', 'B', 'C'];

    const metricStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        color: '#cfe8ff',
        fontVariantNumeric: 'tabular-nums',
    };

    return (
        <div style={{
            marginTop: 6,
            marginBottom: 8,
            padding: '7px 8px',
            border: '1px solid rgba(0, 127, 255, 0.45)',
            borderRadius: 6,
            background: 'rgba(0, 45, 85, 0.35)',
            color: '#d9efff',
            fontSize: 10,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, color: '#9bd0ff' }}>
                <span>{`M${index + 1}`}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{planeLabel}</span>
                    <button
                        type="button"
                        onClick={onDelete}
                        title="Delete selected measurement"
                        style={{
                            width: 18,
                            height: 18,
                            background: 'rgba(0, 20, 38, 0.6)',
                            border: '1px solid rgba(0, 127, 255, 0.55)',
                            borderRadius: 4,
                            color: '#9bd0ff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                        }}
                    >
                        <Trash2 size={11} />
                    </button>
                </div>
            </div>
            {ab && (
                <>
                    <div style={metricStyle}><span>{`${planeLabel} A to B`}</span><span>{formatMeasurementMm(distanceForPlane(ab, planeMode))} mm</span></div>
                    <div style={metricStyle}><span>dx / dy / dz</span><span>{`${formatSignedMeasurementMm(ab.dx)} / ${formatSignedMeasurementMm(ab.dy)} / ${formatSignedMeasurementMm(ab.dz)}`}</span></div>
                    {showProjected && (
                        <div style={metricStyle}><span>XY / XZ / YZ</span><span>{`${formatMeasurementMm(ab.xy)} / ${formatMeasurementMm(ab.xz)} / ${formatMeasurementMm(ab.yz)}`}</span></div>
                    )}
                </>
            )}
            {bc && (
                <div style={metricStyle}><span>{`${planeLabel} B to C`}</span><span>{`${formatMeasurementMm(distanceForPlane(bc, planeMode))} mm`}</span></div>
            )}
            {angle !== null && (
                <div style={metricStyle}><span>{`${planeLabel} angle at B`}</span><span>{`${angle.toFixed(1)}°`}</span></div>
            )}
            <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {measurement.points.map((point, pointIndex) => (
                    <div
                        key={pointIndex}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '14px 1fr 1fr 1fr',
                            alignItems: 'center',
                            gap: 4,
                        }}
                    >
                        <span style={{ color: '#9bd0ff', fontWeight: 600 }}>{pointLabels[pointIndex]}</span>
                        <CoordinateInput
                            label="x"
                            value={point.x}
                            onChange={(value) => onPointChange(pointIndex, { ...point, x: value })}
                        />
                        <CoordinateInput
                            label="y"
                            value={point.y}
                            onChange={(value) => onPointChange(pointIndex, { ...point, y: value })}
                        />
                        <CoordinateInput
                            label="z"
                            value={point.z}
                            onChange={(value) => onPointChange(pointIndex, { ...point, z: value })}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

const MeasurementControls: React.FC<{
    active: boolean;
    drawMode: MeasurementDrawMode;
    planeMode: MeasurementPlaneMode;
    showProjected: boolean;
    onDrawModeChange: (mode: MeasurementDrawMode) => void;
    onPlaneModeChange: (mode: MeasurementPlaneMode) => void;
    onShowProjectedChange: (enabled: boolean) => void;
}> = ({ active, drawMode, planeMode, showProjected, onDrawModeChange, onPlaneModeChange, onShowProjectedChange }) => {
    if (!active) return null;

    const buttonStyle = (selected: boolean): React.CSSProperties => ({
        flex: 1,
        minWidth: 0,
        padding: '3px 4px',
        background: selected ? 'rgba(0, 127, 255, 0.25)' : 'rgba(20, 20, 20, 0.75)',
        border: `1px solid ${selected ? 'rgba(0, 127, 255, 0.7)' : '#444'}`,
        borderRadius: 4,
        color: selected ? '#d7ecff' : '#aaa',
        cursor: 'pointer',
        fontSize: 10,
        fontFamily: 'var(--ui-font)',
    });

    return (
        <div style={{ margin: '4px 0 8px', display: 'grid', gap: 4, fontSize: 10 }}>
            <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => onDrawModeChange('line')} style={buttonStyle(drawMode === 'line')}>Line</button>
                <button type="button" onClick={() => onDrawModeChange('angle')} style={buttonStyle(drawMode === 'angle')}>Angle</button>
                <button type="button" onClick={() => onShowProjectedChange(!showProjected)} style={buttonStyle(showProjected)}>Proj</button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
                {(['free', 'xy', 'xz', 'yz'] as MeasurementPlaneMode[]).map(mode => (
                    <button key={mode} type="button" onClick={() => onPlaneModeChange(mode)} style={buttonStyle(planeMode === mode)}>
                        {planeModeLabel(mode)}
                    </button>
                ))}
            </div>
        </div>
    );
};

function opacityToPercent(value: number): number {
    return Math.round(clampValue(value, 0, 1) * 100);
}

function percentToOpacity(value: number): number {
    return clampValue(value / 100, 0, 1);
}

// ─── CardViewer with pin toggle ─────────────────────────────────────

const CardViewerWithPin: React.FC<{
    card: Card;
    pinnedIds: Set<string>;
    setPinnedIds: (s: Set<string>) => void;
}> = ({ card, pinnedIds, setPinnedIds }) => {
    const isPinned = pinnedIds.has(card.id);
    const [autoFitNonce, setAutoFitNonce] = useState(0);
    return (
        <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: '#aaa' }}>Beam Profile</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                        onClick={() => setAutoFitNonce(n => n + 1)}
                        title="Auto-fit card view to current beam/field footprint"
                        style={{
                            background: 'none',
                            border: '1px solid #444',
                            borderRadius: '3px',
                            color: '#888',
                            cursor: 'pointer',
                            fontSize: '10px',
                            padding: '1px 5px',
                            lineHeight: 1.2,
                        }}
                    >
                        Fit
                    </button>
                    <button
                        onClick={() => {
                            const next = new Set(pinnedIds);
                            if (isPinned) next.delete(card.id);
                            else next.add(card.id);
                            setPinnedIds(next);
                        }}
                        title={isPinned ? 'Unpin viewer' : 'Pin viewer (keep visible when deselected)'}
                        style={{
                            background: isPinned ? '#333' : 'none',
                            border: isPinned ? '1px solid #555' : '1px solid #444',
                            borderRadius: '3px',
                            color: isPinned ? '#fff' : '#888',
                            cursor: 'pointer',
                            fontSize: '11px',
                            padding: '1px 5px',
                            lineHeight: 1.2,
                        }}
                    >
                        📌
                    </button>
                </div>
            </div>
            <CardViewer card={card} autoFitNonce={autoFitNonce} />
        </div>
    );
};

const SolverPanel: React.FC<{
    rayConfig: any;
    setrayConfig: (v: any) => void;
    setVisualizationMode: (mode: RayConfig['viewerMode']) => void;
    isRendering: boolean;
    setImageFormationTrigger: (fn: (prev: number) => number) => void;
    animator: PropertyAnimator;
    animPlaying: boolean;
    setAnimPlaying: (v: boolean) => void;
}> = ({ rayConfig, setrayConfig, setVisualizationMode, isRendering, setImageFormationTrigger: _setImageFormationTrigger, animator, animPlaying, setAnimPlaying }) => {
    const isMobile = useIsMobile();
    const [mobileOpen, setMobileOpen] = React.useState(false);
    const isVisible = !isMobile || mobileOpen;
    const hasChannels = animator.channels.length > 0;
    const [components] = useAtom(componentsAtom);
    const [, setSelection] = useAtom(selectionAtom);
    const [, setUiLocked] = useAtom(uiLockedAtom);
    const [measurement, setMeasurement] = useAtom(measurementAtom);
    const measurements = Array.isArray(measurement.measurements) ? measurement.measurements : [];
    const measurementDrawMode = measurement.drawMode ?? 'line';
    const measurementPlaneMode = measurement.planeMode ?? 'free';
    const measurementShowProjected = measurement.showProjected ?? true;
    const selectedMeasurementIndex = measurement.selectedId
        ? measurements.findIndex(current => current.id === measurement.selectedId)
        : -1;
    const selectedMeasurement = selectedMeasurementIndex >= 0 ? measurements[selectedMeasurementIndex] : null;
    const [scanConfig, setScanConfig] = useAtom(scanAccumTriggerAtom);
    const [scanProgress] = useAtom(scanAccumProgressAtom);
    const [solverDiag] = useAtom(solverDiagnosticsAtom);
    const [drawnRayCounts] = useAtom(drawnRayCountsAtom);
    const hasCamera = components.some(component => component instanceof Camera);
    const [timelineSteps, setTimelineSteps] = React.useState(String(scanConfig.steps));
    const opacityTrackRef = React.useRef<HTMLDivElement | null>(null);
    const [activeOpacityHandle, setActiveOpacityHandle] = React.useState<'min' | 'max' | null>(null);
    const forwardRayMin = rayConfig.viewerMode === 'planes'
        ? OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT
        : MIN_FORWARD_RAY_COUNT;
    const displayedForwardRayCount = clampValue(rayConfig.rayCount, forwardRayMin, MAX_FORWARD_RAY_COUNT);
    // newVisualStyleAtom removed — new style is always on

    React.useEffect(() => {
        setTimelineSteps(String(scanConfig.steps));
    }, [scanConfig.steps]);

    React.useEffect(() => {
        if (!activeOpacityHandle) return;

        const updateFromClientX = (clientX: number) => {
            const track = opacityTrackRef.current;
            if (!track) return;
            const rect = track.getBoundingClientRect();
            if (rect.width <= 0) return;
            const percent = clampValue(((clientX - rect.left) / rect.width) * 100, 0, 100);
            const opacity = percentToOpacity(percent);

            if (activeOpacityHandle === 'min') {
                setrayConfig({
                    ...rayConfig,
                    minRayOpacity: Math.min(opacity, rayConfig.maxRayOpacity),
                });
                return;
            }

            setrayConfig({
                ...rayConfig,
                maxRayOpacity: Math.max(opacity, rayConfig.minRayOpacity),
            });
        };

        const handlePointerMove = (event: PointerEvent) => {
            updateFromClientX(event.clientX);
        };

        const handlePointerUp = () => {
            setActiveOpacityHandle(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [activeOpacityHandle, rayConfig, setrayConfig]);

    return (
        <>
            {/* Mobile backdrop */}
            {isMobile && mobileOpen && (
                <div
                    onClick={() => setMobileOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: 'var(--app-height, 100dvh)',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        zIndex: 14,
                    }}
                />
            )}

            {/* Mobile toggle button */}
            {isMobile && !mobileOpen && (
                <button
                    onClick={() => setMobileOpen(true)}
                    style={{
                        position: 'fixed',
                        top: 10,
                        right: 10,
                        zIndex: 20,
                        width: 44,
                        height: 44,
                        borderRadius: '8px',
                        border: '1px solid #444',
                        backgroundColor: '#1a1a1a',
                        color: '#aaa',
                        fontSize: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}
                    title="Ray display"
                >
                    ⚙
                </button>
            )}

            {/* Panel */}
            <div style={{
                position: 'fixed',
                top: isMobile ? undefined : 20,
                bottom: isMobile ? 0 : undefined,
                left: isMobile ? 0 : undefined,
                right: isMobile ? 0 : 20,
                width: isMobile ? '100vw' : 'min(280px, calc(100% - 40px))',
                maxWidth: isMobile ? '100vw' : 'calc(100% - 40px)',
                borderBottomLeftRadius: isMobile ? 0 : undefined,
                borderBottomRightRadius: isMobile ? 0 : undefined,
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                color: 'white',
                padding: 15,
                borderRadius: 8,
                border: '1px solid #444',
                fontFamily: 'sans-serif',
                fontSize: '12px',
                zIndex: 15,
                transform: isVisible
                    ? (isMobile ? 'translateY(0)' : 'translateX(0)')
                    : (isMobile ? 'translateY(100%)' : 'translateX(calc(100% + 40px))'),
                transition: 'transform 0.25s ease',
            }}>
                    {isMobile && (
                        <button
                            onClick={() => setMobileOpen(false)}
                            style={{
                                position: 'absolute',
                                top: 8,
                                right: 10,
                                background: 'none',
                                border: 'none',
                                color: '#888',
                                fontSize: '18px',
                                cursor: 'pointer',
                            }}
                        >
                            ✕
                        </button>
                    )}
                {/* Header row — title + play/pause inline */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ flex: 1 }} />
                    <button
                        type="button"
                        onClick={() => setMeasurement(state => ({
                            ...state,
                            active: !state.active,
                            selectedId: state.active ? null : state.selectedId,
                            measurements: Array.isArray(state.measurements) ? state.measurements : [],
                        }))}
                        title={measurement.active ? 'Stop measuring' : 'Start a new measurement'}
                        style={{
                            width: '22px',
                            height: '22px',
                            background: measurement.active ? '#062545' : '#222',
                            border: `1px solid ${measurement.active ? '#007fff' : '#555'}`,
                            borderRadius: '4px',
                            color: measurement.active ? '#74b9ff' : '#aaa',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            marginRight: 6,
                            transition: 'all 0.15s',
                        }}
                    >
                        <Ruler size={13} />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSelection([]);
                            setMeasurement(state => ({
                                ...state,
                                active: false,
                                selectedId: null,
                                measurements: Array.isArray(state.measurements) ? state.measurements : [],
                            }));
                            setUiLocked(true);
                        }}
                        title="Lock editing UI"
                        style={{
                            width: '22px',
                            height: '22px',
                            background: '#222',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            color: '#aaa',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            marginRight: hasChannels ? 6 : 0,
                            transition: 'all 0.15s',
                        }}
                    >
                        <Lock size={13} />
                    </button>
                    {hasChannels && (
                        <button
                            onClick={() => {
                                if (animPlaying) {
                                    // Pausing — snap all animated components back to rest position
                                    animator.restoreAll(components);
                                }
                                setAnimPlaying(!animPlaying);
                            }}
                            style={{
                                width: '22px',
                                height: '22px',
                                background: animPlaying ? '#1a3a2a' : '#333',
                                border: `1px solid ${animPlaying ? '#64ffda' : '#555'}`,
                                borderRadius: '4px',
                                color: animPlaying ? '#64ffda' : '#aaa',
                                cursor: 'pointer',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                                transition: 'all 0.15s',
                            }}
                            title={animPlaying ? 'Pause animation' : 'Play animation'}
                        >
                            {animPlaying ? '⏸' : '▶'}
                        </button>
                    )}
                </div>

                    <MeasurementControls
                        active={measurement.active || Boolean(selectedMeasurement)}
                        drawMode={measurementDrawMode}
                        planeMode={measurementPlaneMode}
                        showProjected={measurementShowProjected}
                        onDrawModeChange={(drawMode: MeasurementDrawMode) => setMeasurement(state => ({ ...state, drawMode }))}
                        onPlaneModeChange={(planeMode: MeasurementPlaneMode) => setMeasurement(state => ({ ...state, planeMode }))}
                        onShowProjectedChange={(showProjected: boolean) => setMeasurement(state => ({ ...state, showProjected }))}
                    />

                    {selectedMeasurement && (
                        <MeasurementReadout
                            measurement={selectedMeasurement}
                            index={selectedMeasurementIndex}
                            planeMode={measurementPlaneMode}
                            showProjected={measurementShowProjected}
                            onDelete={() => setMeasurement(state => ({
                                ...state,
                                active: state.active,
                                ...(() => {
                                    const measurements = Array.isArray(state.measurements) ? state.measurements : [];
                                    const selectedIndex = measurements.findIndex(current => current.id === selectedMeasurement.id);
                                    const nextMeasurements = measurements.filter(current => current.id !== selectedMeasurement.id);
                                    const nextSelected = nextMeasurements[Math.min(Math.max(selectedIndex, 0), nextMeasurements.length - 1)]?.id ?? null;
                                    return { selectedId: nextSelected, measurements: nextMeasurements };
                                })(),
                            }))}
                            onPointChange={(pointIndex, point) => setMeasurement(state => ({
                                ...state,
                                active: state.active,
                                selectedId: selectedMeasurement.id,
                                measurements: Array.isArray(state.measurements)
                                    ? state.measurements.map(current => current.id === selectedMeasurement.id
                                        ? {
                                            ...current,
                                            points: current.points.map((existing, index) => index === pointIndex ? point : existing),
                                        }
                                        : current)
                                    : [],
                            }))}
                        />
                    )}

                    <div style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ color: '#aaa', fontSize: '10px' }}>Rays per source</span>
                            <span style={{ color: '#777', fontSize: '10px' }}>
                                {displayedForwardRayCount}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="range"
                                min="0"
                                max={String(COUNT_SLIDER_STEPS)}
                                step="1"
                                value={countToSliderPosition(
                                    displayedForwardRayCount,
                                    forwardRayMin,
                                    MAX_FORWARD_RAY_COUNT,
                                )}
                                onChange={(e) => setrayConfig({
                                    ...rayConfig,
                                    rayCount: stickyForwardRodCount(
                                        sliderPositionToCount(parseInt(e.target.value), forwardRayMin, MAX_FORWARD_RAY_COUNT),
                                    ),
                                })}
                                style={{ flex: 1, minWidth: 0 }}
                                title="Approximate forward source rays per source"
                            />
                            <input
                                type="number"
                                min={forwardRayMin}
                                max={MAX_FORWARD_RAY_COUNT}
                                step={1}
                                value={displayedForwardRayCount}
                                onChange={(e) => setrayConfig({
                                    ...rayConfig,
                                    rayCount: clampValue(parseInt(e.target.value, 10) || displayedForwardRayCount, forwardRayMin, MAX_FORWARD_RAY_COUNT),
                                })}
                                onBlur={(e) => setrayConfig({
                                    ...rayConfig,
                                    rayCount: clampValue(parseInt(e.target.value || String(forwardRayMin), 10), forwardRayMin, MAX_FORWARD_RAY_COUNT),
                                })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        setrayConfig({
                                            ...rayConfig,
                                            rayCount: clampValue(parseInt((e.target as HTMLInputElement).value || String(forwardRayMin), 10), forwardRayMin, MAX_FORWARD_RAY_COUNT),
                                        });
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                style={{
                                    width: '64px',
                                    background: '#111',
                                    color: '#ddd',
                                    border: '1px solid #444',
                                    borderRadius: '3px',
                                    padding: '1px 4px',
                                }}
                                title="Exact forward source rays per source. Slider sticks near symmetric shell counts."
                            />
                        </div>
                    </div>
                    {/* Reverse/Px slider intentionally removed: each progressive
                        round contributes one sample/pixel and the accumulator
                        builds the running average across rounds, so the knob
                        was redundant.  reversePathCount is locked to 1 in
                        DEFAULT_RAY_CONFIG. */}

                    <div style={{ display: 'flex', gap: '6px', marginTop: 8, flexWrap: 'wrap' }}>
                        {(['rods', 'wave', 'planes'] as const).map(mode => {
                            const active = rayConfig.viewerMode === mode;
                            const label = mode === 'rods' ? 'Ray View' : mode === 'wave' ? 'Wave View' : 'Optical Plane View';
                            return (
                                <button
                                    key={mode}
                                    onClick={() => setVisualizationMode(mode)}
                                    title={mode === 'rods'
                                        ? 'Draw individual traced rays'
                                        : mode === 'wave'
                                            ? 'Draw grouped bundles with a representative wave'
                                            : 'Draw local sensor, focal, pupil, and stop plane landmarks'}
                                    style={{
                                        padding: '2px 8px',
                                        background: active ? '#24415c' : '#1a1a1a',
                                        border: active ? '1px solid #4af' : '1px solid #444',
                                        borderRadius: '999px',
                                        color: active ? '#d7ecff' : '#888',
                                        cursor: 'pointer',
                                        fontSize: '10px',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                        {/* Polarization view is an orthogonal coloring overlay,
                            not a view mode — toggle it independently of the
                            Ray/Wave/Plane buttons above. */}
                        <button
                            onClick={() => setrayConfig({ ...rayConfig, colorByPolarization: !rayConfig.colorByPolarization })}
                            title="Color each ray segment by its polarization state — entry/exit beams that differ only by polarization become visibly distinct."
                            style={{
                                padding: '2px 8px',
                                background: rayConfig.colorByPolarization ? '#3a2f48' : '#1a1a1a',
                                border: rayConfig.colorByPolarization ? '1px solid #c084fc' : '1px solid #444',
                                borderRadius: '999px',
                                color: rayConfig.colorByPolarization ? '#e9d5ff' : '#888',
                                cursor: 'pointer',
                                fontSize: '10px',
                                transition: 'all 0.2s',
                            }}
                        >
                            Polarization View
                        </button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: '10px', color: '#aaa' }}>Ray Opacity</span>
                            <span style={{ fontSize: '10px', color: '#777' }}>
                                {opacityToPercent(rayConfig.minRayOpacity)}% .. {opacityToPercent(rayConfig.maxRayOpacity)}%
                            </span>
                        </div>
                        <div
                            ref={opacityTrackRef}
                            style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'center' }}
                        >
                            <div style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                height: '4px',
                                background: '#333',
                                borderRadius: '999px',
                            }} />
                            <div style={{
                                position: 'absolute',
                                left: `${opacityToPercent(rayConfig.minRayOpacity)}%`,
                                width: `${Math.max(0, opacityToPercent(rayConfig.maxRayOpacity) - opacityToPercent(rayConfig.minRayOpacity))}%`,
                                height: '4px',
                                background: '#4af',
                                borderRadius: '999px',
                            }} />
                            <button
                                type="button"
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    setActiveOpacityHandle('min');
                                }}
                                style={{
                                    position: 'absolute',
                                    left: `calc(${opacityToPercent(rayConfig.minRayOpacity)}% - 7px)`,
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    border: '1px solid #9fd8ff',
                                    background: activeOpacityHandle === 'min' ? '#9fd8ff' : '#d7ecff',
                                    boxShadow: activeOpacityHandle === 'min' ? '0 0 0 2px rgba(74, 170, 255, 0.25)' : 'none',
                                    cursor: 'ew-resize',
                                    padding: 0,
                                }}
                                title="Minimum opacity for the dimmest visible rays"
                            />
                            <button
                                type="button"
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    setActiveOpacityHandle('max');
                                }}
                                style={{
                                    position: 'absolute',
                                    left: `calc(${opacityToPercent(rayConfig.maxRayOpacity)}% - 7px)`,
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    border: '1px solid #4af',
                                    background: activeOpacityHandle === 'max' ? '#4af' : '#8fd6ff',
                                    boxShadow: activeOpacityHandle === 'max' ? '0 0 0 2px rgba(74, 170, 255, 0.25)' : 'none',
                                    cursor: 'ew-resize',
                                    padding: 0,
                                }}
                                title="Maximum opacity for the brightest visible rays"
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666', marginTop: 2 }}>
                            <span>Dimmest</span>
                            <span>Brightest</span>
                        </div>
                    </div>

                    {/* Image Formation: Calculate Emission and Image */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: isRendering ? '#fa4' : '#555',
                                transition: 'background-color 0.2s'
                            }}></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '10px', color: '#888', fontFamily: 'monospace' }}>
                                    {isRendering
                                        ? `Image tracing… ${Math.round(scanProgress * 100)}%`
                                        : `${drawnRayCounts.forward} forward · ${drawnRayCounts.reverse} reverse rays drawn`}
                                </span>
                            </div>
                        </div>
                        {isRendering && scanProgress > 0 && scanProgress < 1 && (
                            <div style={{
                                height: '3px',
                                background: '#333',
                                borderRadius: '2px',
                                overflow: 'hidden',
                                marginLeft: '16px',
                            }}>
                                <div style={{
                                    width: `${scanProgress * 100}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #2a8a4a, #4af088)',
                                    transition: 'width 0.1s',
                                }} />
                            </div>
                        )}
                        {isRendering && solverDiag && (
                            <div style={{
                                marginLeft: '16px',
                                marginTop: '4px',
                                fontSize: '9px',
                                color: '#888',
                                fontFamily: 'monospace',
                                display: 'flex',
                                gap: '8px',
                            }}>
                                {solverDiag.totalSteps > 0 && (
                                    <span>{solverDiag.label}</span>
                                )}
                                <span>{(solverDiag.elapsedMs / 1000).toFixed(1)}s</span>
                            </div>
                        )}
                    </div>

                    {hasChannels && hasCamera && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 54px 64px',
                            gap: '6px',
                            alignItems: 'center',
                            marginTop: 8,
                        }}>
                            <span style={{ fontSize: '10px', color: '#888' }}>Timeline</span>
                            <input
                                type="number"
                                min={2}
                                max={128}
                                step={1}
                                value={timelineSteps}
                                onChange={e => setTimelineSteps(e.target.value)}
                                onBlur={() => {
                                    const steps = clampValue(parseInt(timelineSteps, 10) || scanConfig.steps, 2, 128);
                                    setTimelineSteps(String(steps));
                                    setScanConfig(config => ({ steps, trigger: config.trigger }));
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                style={{
                                    width: '54px',
                                    background: '#111',
                                    color: '#ddd',
                                    border: '1px solid #444',
                                    borderRadius: '3px',
                                    padding: '1px 4px',
                                    fontSize: '10px',
                                }}
                                title="Timeline frames"
                            />
                            <button
                                type="button"
                                disabled={isRendering}
                                onClick={() => {
                                    const steps = clampValue(parseInt(timelineSteps, 10) || scanConfig.steps, 2, 128);
                                    setTimelineSteps(String(steps));
                                    setScanConfig(config => ({ steps, trigger: config.trigger + 1 }));
                                }}
                                style={{
                                    padding: '3px 7px',
                                    borderRadius: '4px',
                                    border: '1px solid #3a6a8a',
                                    background: isRendering ? '#222' : '#1a2a3a',
                                    color: isRendering ? '#666' : '#74b9ff',
                                    cursor: isRendering ? 'default' : 'pointer',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                }}
                                title="Render animation timeline"
                            >
                                Render
                            </button>
                        </div>
                    )}

            </div>
        </>
    );
};

// ─── Dual Galvo Scan Controls ─────────────────────────────────────────
// Extracted as a proper component so it can use useState for controlled inputs.
const DualGalvoControls: React.FC<{
    component: DualGalvoScanHead;
    channelX: AnimationChannel | undefined;
    channelY: AnimationChannel | undefined;
    savedSettings: { halfDeg: number; halfDegY?: number; periodMs: number; periodMsY?: number; axis: string } | undefined;
    animator: PropertyAnimator;
    animPlaying: boolean;
    setGalvoAngles: React.Dispatch<React.SetStateAction<Map<string, any>>>;
    setAnimPlaying: (v: boolean) => void;
    setChannelVersion: React.Dispatch<React.SetStateAction<number>>;
}> = ({ component, channelX, channelY, savedSettings, animator, animPlaying, setGalvoAngles, setAnimPlaying, setChannelVersion }) => {
    const hasScanChannels = !!(channelX || channelY);
    const isScanning = hasScanChannels && animPlaying;

    const initHalfX = channelX ? Math.round((channelX.to - channelX.from) * 90 / Math.PI * 10) / 10 : (savedSettings?.halfDeg ?? 5);
    const initHalfY = channelY ? Math.round((channelY.to - channelY.from) * 90 / Math.PI * 10) / 10 : (savedSettings?.halfDegY ?? 5);
    const initHzX = channelX ? Math.round(1000 / channelX.periodMs * 10) / 10 : Math.round(1000 / (savedSettings?.periodMs ?? 2000) * 10) / 10;
    const initHzY = channelY ? Math.round(1000 / channelY.periodMs * 10) / 10 : Math.round(1000 / (savedSettings?.periodMsY ?? 500) * 10) / 10;

    const [rangeX, setRangeX] = useState(String(initHalfX));
    const [rangeY, setRangeY] = useState(String(initHalfY));
    const [hzX, setHzX] = useState(String(initHzX));
    const [hzY, setHzY] = useState(String(initHzY));

    // Persist to galvoAngles on every change
    const persist = useCallback((patch: { halfDeg?: number; halfDegY?: number; periodMs?: number; periodMsY?: number }) => {
        setGalvoAngles(prev => {
            const old = prev.get(component.id);
            const next = new Map(prev);
            next.set(component.id, {
                halfDeg: patch.halfDeg ?? old?.halfDeg ?? initHalfX,
                halfDegY: patch.halfDegY ?? old?.halfDegY ?? initHalfY,
                periodMs: patch.periodMs ?? old?.periodMs ?? (savedSettings?.periodMs ?? 2000),
                periodMsY: patch.periodMsY ?? old?.periodMsY ?? (savedSettings?.periodMsY ?? 500),
                axis: 'V',
            });
            return next;
        });
    }, [component.id, setGalvoAngles, initHalfX, initHalfY, savedSettings]);

    const inputStyle10: React.CSSProperties = {
        width: '40px', background: 'transparent', color: '#fff', fontWeight: 500,
        border: 'none', borderBottom: '1px solid rgba(255,255,255,0.2)', borderRadius: '0px',
        fontSize: '11px', padding: '2px 4px', textAlign: 'center', outline: 'none',
        transition: 'border-color 0.2s',
    };
    return (
        <>
            {/* Pan (scanX) row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', color: '#888', minWidth: '26px' }}>Pan</span>
                <span style={{ fontSize: '10px', color: '#888' }}>±</span>
                <input type="number" value={rangeX} min={0} max={45} step={0.5}
                    onChange={e => {
                        setRangeX(e.target.value);
                        const hd = parseFloat(e.target.value);
                        if (isNaN(hd) || hd < 0) return;
                        persist({ halfDeg: hd });
                        if (channelX) {
                            const hr = hd * Math.PI / 180;
                            const c = channelX.restoreValue ?? (channelX.from + channelX.to) / 2;
                            channelX.from = c - hr; channelX.to = c + hr;
                        }
                    }}
                    style={inputStyle10}
                />
                <span style={{ fontSize: '10px', color: '#888' }}>°</span>
                <span style={{ fontSize: '10px', color: '#888', marginLeft: 4 }}>Hz</span>
                <input type="number" value={hzX} min={0.1} max={10000} step={0.1}
                    onChange={e => {
                        setHzX(e.target.value);
                        const hz = parseFloat(e.target.value);
                        if (isNaN(hz) || hz <= 0) return;
                        persist({ periodMs: 1000 / hz });
                        if (channelX) channelX.periodMs = 1000 / hz;
                    }}
                    style={inputStyle10}
                />
            </div>
            {/* Tilt (scanY) row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: '#888', minWidth: '26px' }}>Tilt</span>
                <span style={{ fontSize: '10px', color: '#888' }}>±</span>
                <input type="number" value={rangeY} min={0} max={45} step={0.5}
                    onChange={e => {
                        setRangeY(e.target.value);
                        const hd = parseFloat(e.target.value);
                        if (isNaN(hd) || hd < 0) return;
                        persist({ halfDegY: hd });
                        if (channelY) {
                            const hr = hd * Math.PI / 180;
                            const c = channelY.restoreValue ?? (channelY.from + channelY.to) / 2;
                            channelY.from = c - hr; channelY.to = c + hr;
                        }
                    }}
                    style={inputStyle10}
                />
                <span style={{ fontSize: '10px', color: '#888' }}>°</span>
                <span style={{ fontSize: '10px', color: '#888', marginLeft: 4 }}>Hz</span>
                <input type="number" value={hzY} min={0.1} max={10000} step={0.1}
                    onChange={e => {
                        setHzY(e.target.value);
                        const hz = parseFloat(e.target.value);
                        if (isNaN(hz) || hz <= 0) return;
                        persist({ periodMsY: 1000 / hz });
                        if (channelY) channelY.periodMs = 1000 / hz;
                    }}
                    style={inputStyle10}
                />
            </div>
            {/* Start / Stop button */}
            <button
                onClick={() => {
                    if (hasScanChannels) {
                        setAnimPlaying(!isScanning);
                        setChannelVersion(v => v + 1);
                    } else {
                        const halfX = (parseFloat(rangeX) || 0) * Math.PI / 180;
                        const halfY = (parseFloat(rangeY) || 0) * Math.PI / 180;
                        const periodX = 1000 / (parseFloat(hzX) || 0.5);
                        const periodY = 1000 / (parseFloat(hzY) || 2);
                        const centerX = component.scanX;
                        const centerY = component.scanY;
                        animator.addChannel({
                            id: generateChannelId(), targetId: component.id, property: 'scanX',
                            from: centerX - halfX, to: centerX + halfX,
                            easing: 'sinusoidal', periodMs: periodX, repeat: true, restoreValue: centerX,
                        });
                        animator.addChannel({
                            id: generateChannelId(), targetId: component.id, property: 'scanY',
                            from: centerY - halfY, to: centerY + halfY,
                            easing: 'sinusoidal', periodMs: periodY, repeat: true, restoreValue: centerY,
                        });
                        setAnimPlaying(true);
                        setChannelVersion(v => v + 1);
                    }
                }}
                style={{
                    width: '100%', padding: '6px 0',
                    background: isScanning ? '#3a1a1a' : '#1a2a3a',
                    border: `1px solid ${isScanning ? '#8a3a3a' : '#3a6a8a'}`,
                    borderRadius: '5px',
                    color: isScanning ? '#ff7b7b' : '#74b9ff',
                    cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                    letterSpacing: '0.3px', transition: 'all 0.15s',
                }}
                onMouseOver={e => {
                    e.currentTarget.style.background = isScanning ? '#4a2a2a' : '#253a4a';
                    e.currentTarget.style.borderColor = isScanning ? '#f44' : '#64b5f6';
                }}
                onMouseOut={e => {
                    e.currentTarget.style.background = isScanning ? '#3a1a1a' : '#1a2a3a';
                    e.currentTarget.style.borderColor = isScanning ? '#8a3a3a' : '#3a6a8a';
                }}
            >
                {isScanning ? '⏹ Stop Scan' : '⏵ Start Scan'}
            </button>
        </>
    );
};

// Inject a one-time CSS rule that flows the mobile inspector's property
// blocks into a row-major grid (left → right, then next row).  Each block
// is a grid cell; auto-fit + minmax(140px, 1fr) means the column count
// scales naturally with the screen — 2 cols on a 360 px phone, 3 cols
// around 480 px, 4 cols at landscape / tablet widths.  We use Grid (not
// CSS multi-column) because multicol needs an explicit container height
// to wrap into additional columns; without it, all content piles into
// column 1 and the rest stay empty.
const INSPECTOR_MOBILE_STYLE_ID = 'inspector-mobile-multicol';
function ensureInspectorMobileStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(INSPECTOR_MOBILE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = INSPECTOR_MOBILE_STYLE_ID;
    style.textContent = `
        .inspector-multicol-mobile {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 10px 14px;
            align-items: start;
        }
        .inspector-multicol-mobile > * {
            min-width: 0;
        }
    `;
    document.head.appendChild(style);
}

export const Inspector: React.FC = () => {
    const isMobile = useIsMobile();
    useEffect(() => { if (isMobile) ensureInspectorMobileStyle(); }, [isMobile]);
    const haptic = useHaptic();
    const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [rayConfig, setrayConfig] = useAtom(rayConfigAtom);
    const [, setVisualizationMode] = useAtom(setVisualizationModeAtom);
    const [, setImageFormationTrigger] = useAtom(solver3RenderTriggerAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [animator] = useAtom(animatorAtom);
    const [, setAnimPlaying] = useAtom(animationPlayingAtom);
    const [animPlaying] = useAtom(animationPlayingAtom);
    const [animSpeed, setAnimSpeed] = useAtom(animationSpeedAtom);
    const [selectedRodRef, setSelectedRodRef] = useAtom(selectedRodAtom);
    const [rodPaths] = useAtom(rodPathsAtom);
    // Bumped on channel add/remove to force re-render of galvo scan UI
    const [_channelVersion, setChannelVersion] = useState(0);
    // Remembers the last-used galvo settings per component, persists across stop/start
    const [galvoAngles, setGalvoAngles] = useState<Map<string, { halfDeg: number; periodMs: number; axis: string; halfDegY?: number; periodMsY?: number }>>(new Map());
    // Remembers the last-used piezo settings per sample component
    const [piezoSettings, setPiezoSettings] = useState<Map<string, { halfMm: number; periodMs: number; axis: string }>>(new Map());

    // Resolve the selected rod pointer → (path, rod). Rebuilds whenever the
    // atom or the published rod paths (via generation bump) change.
    const resolvedRodSelection = useMemo(() => {
        if (!selectedRodRef) return null;
        const arr = selectedRodRef.source === 'forward' ? rodPaths.forward : rodPaths.imageFormation;
        const path = arr[selectedRodRef.pathIndex];
        if (!path) return null;
        const rod = path[selectedRodRef.segmentIndex];
        if (!rod) return null;
        return { path, rod, segmentIndex: selectedRodRef.segmentIndex };
    }, [selectedRodRef, rodPaths]);

    // A cone selection takes precedence over a component selection.
    const selectedComponent = !resolvedRodSelection && selection.length === 1
        ? components.find(c => c.id === selection[0])
        : undefined;

    // Close mobile properties panel when selection changes
    useEffect(() => { setMobilePropsOpen(false); }, [selection[0]]);

    const [localX, setLocalX] = useState<string>('0');
    const [localY, setLocalY] = useState<string>('0');
    const [localZ, setLocalZ] = useState<string>('0');
    const [localRotX, setLocalRotX] = useState<string>('0');  // pan (U)
    const [localRotY, setLocalRotY] = useState<string>('0');  // tilt (V)
    const [localRotZ, setLocalRotZ] = useState<string>('0');  // roll (W)


    const [localWidth, setLocalWidth] = useState<string>('0');
    const [localHeight, setLocalHeight] = useState<string>('0');
    const [localOpaque, setLocalOpaque] = useState<boolean>(false);


    const [localMirrorDiameter, setLocalMirrorDiameter] = useState<string>('25');
    const [localMirrorThickness, setLocalMirrorThickness] = useState<string>('2');
    // Beam splitter shared geometry; splitRatio is only meaningful for the
    // non-polarizing BeamSplitter (PBS is determined by polarization).
    const [localBsDiameter, setLocalBsDiameter] = useState<string>('25');
    const [localBsThickness, setLocalBsThickness] = useState<string>('2');
    const [localBsSplit, setLocalBsSplit] = useState<string>('50');


    const [localBlockerDiameter, setLocalBlockerDiameter] = useState<string>('20');
    const [localBlockerThickness, setLocalBlockerThickness] = useState<string>('5');
    const [localRadius, setLocalRadius] = useState<string>('0');
    const [localFocal, setLocalFocal] = useState<string>('0');
    const [localR1, setLocalR1] = useState<string>('0');
    const [localR2, setLocalR2] = useState<string>('0');
    const [localThickness, setLocalThickness] = useState<string>('0');
    const [localIor, setLocalIor] = useState<string>('1.5');
    const [localLensType, setLocalLensType] = useState<string>('biconvex');

    const [localAsphPreset, setLocalAsphPreset] = useState<string>('plano-asphere-collimator');
    const [localAsphR1, setLocalAsphR1] = useState<string>('13');
    const [localAsphR2, setLocalAsphR2] = useState<string>('Infinity');
    const [localAsphK1, setLocalAsphK1] = useState<string>('-0.7');
    const [localAsphK2, setLocalAsphK2] = useState<string>('0');
    const [localAsphA1, setLocalAsphA1] = useState<string[]>([]);
    const [localAsphA2, setLocalAsphA2] = useState<string[]>([]);
    const [localAsphAperture, setLocalAsphAperture] = useState<string>('12.7');
    const [localAsphThickness, setLocalAsphThickness] = useState<string>('4');
    const [localAsphIor, setLocalAsphIor] = useState<string>('1.5168');


    const [localIdealFocal, setLocalIdealFocal] = useState<string>('50');
    const [localIdealAperture, setLocalIdealAperture] = useState<string>('15');


    const [localObjNA, setLocalObjNA] = useState<string>('0.25');
    const [localObjMag, setLocalObjMag] = useState<string>('10');
    const [localObjImmersion, setLocalObjImmersion] = useState<string>('1.0');
    const [localObjImmersionKind, setLocalObjImmersionKind] = useState<'air' | 'water' | 'oil' | 'silicone' | 'custom'>('air');
    const [localObjWD, setLocalObjWD] = useState<string>('10');
    const [localObjDiameter, setLocalObjDiameter] = useState<string>('20');
    const [localObjTubeLensFocal, setLocalObjTubeLensFocal] = useState<string>('200');
    const [localObjCoverslipThickness, setLocalObjCoverslipThickness] = useState<string>('0.17');
    const [localObjFieldNumber, setLocalObjFieldNumber] = useState<string>('0');
    const [localObjPupilRefNm, setLocalObjPupilRefNm] = useState<string>('550');
    const [localObjDefocus, setLocalObjDefocus] = useState<string>('0');
    const [localObjAstig45, setLocalObjAstig45] = useState<string>('0');
    const [localObjAstig0, setLocalObjAstig0] = useState<string>('0');
    const [localObjComaY, setLocalObjComaY] = useState<string>('0');
    const [localObjComaX, setLocalObjComaX] = useState<string>('0');
    const [localObjSpherical, setLocalObjSpherical] = useState<string>('0');
    const [localCameraResX, setLocalCameraResX] = useState<string>('32');
    const [localCameraResY, setLocalCameraResY] = useState<string>('32');
    const [localCameraSensorNA, setLocalCameraSensorNA] = useState<string>('0');
    const [localCameraLaunchModel, setLocalCameraLaunchModel] = useState<'stochastic' | 'packet'>('stochastic');

    const [localPolyFaces, setLocalPolyFaces] = useState<string>('6');
    const [localPolyRadius, setLocalPolyRadius] = useState<string>('10');
    const [localPolyHeight, setLocalPolyHeight] = useState<string>('10');
    const [localPolyScanAngle, setLocalPolyScanAngle] = useState<string>('0');
    const [localPolyIor, setLocalPolyIor] = useState<string>('1.5168');
    const [localPolyMode, setLocalPolyMode] = useState<'refractive' | 'reflective'>('refractive');

    // Achromatic Doublet
    const [localDoubletR1, setLocalDoubletR1] = useState<string>('77.4');
    const [localDoubletR2, setLocalDoubletR2] = useState<string>('-87.6');
    const [localDoubletR3, setLocalDoubletR3] = useState<string>('291.1');
    const [localDoubletT1, setLocalDoubletT1] = useState<string>('4.0');
    const [localDoubletT2, setLocalDoubletT2] = useState<string>('2.5');
    const [localDoubletAperture, setLocalDoubletAperture] = useState<string>('25.4');
    const [localDoubletIor1, setLocalDoubletIor1] = useState<string>('1.658');
    const [localDoubletIor2, setLocalDoubletIor2] = useState<string>('1.750');

    const [localWavelength, setLocalWavelength] = useState<number>(532);
    const [localBeamRadius, setLocalBeamRadius] = useState<string>('2');
    const [localLaserPower, setLocalLaserPower] = useState<string>('0.1');
    const [localLampPower, setLocalLampPower] = useState<string>('1');
    const [localSourcePointCount, setLocalSourcePointCount] = useState<string>('5');
    const [localEmitterRadius, setLocalEmitterRadius] = useState<string>('0.9');

    // Diffuser state
    const [localDiffuserDiameter, setLocalDiffuserDiameter] = useState<string>('25.4');
    const [localDiffuserConeAngle, setLocalDiffuserConeAngle] = useState<string>('60');

    // Double slit state
    const [localDoubleSlitWidth, setLocalDoubleSlitWidth] = useState<string>('0.5');
    const [localDoubleSlitSep, setLocalDoubleSlitSep] = useState<string>('2');

    // Point / Cone / Wedge / Structured source state
    const [localHalfAngle, setLocalHalfAngle] = useState<string>('30');
    const [localSubtendedAngle, setLocalSubtendedAngle] = useState<string>('60');
    const [localAsciiChar, setLocalAsciiChar] = useState<string>('A');

    // Faraday Isolator
    const [localInsertionLoss, setLocalInsertionLoss] = useState<string>('0.95');
    const [localExtinctionDB, setLocalExtinctionDB] = useState<string>('35');

    // QPD
    const [localQPDDiameter, setLocalQPDDiameter] = useState<string>('5');

    // AOD
    const [localDeflectionAngle, setLocalDeflectionAngle] = useState<string>('0');
    const [localAODEfficiency, setLocalAODEfficiency] = useState<string>('0.85');
    const [localAODMaxAngle, setLocalAODMaxAngle] = useState<string>('50');

    // Cylindrical Lens
    const [localCylR1, setLocalCylR1] = useState<string>('40');
    const [localCylR2, setLocalCylR2] = useState<string>('1e9');
    const [localCylAperture, setLocalCylAperture] = useState<string>('12');
    const [localCylWidth, setLocalCylWidth] = useState<string>('24');
    const [localCylThickness, setLocalCylThickness] = useState<string>('3');
    const [localCylIor, setLocalCylIor] = useState<string>('1.5168');

    // Curved Mirror
    const [localCurvedMirrorDiameter, setLocalCurvedMirrorDiameter] = useState<string>('25');
    const [localCurvedMirrorRoC, setLocalCurvedMirrorRoC] = useState<string>('100');
    const [localCurvedMirrorThickness, setLocalCurvedMirrorThickness] = useState<string>('3');


    // Old prism local state removed — unified under localPoly* above


    const [localApertureDiameter, setLocalApertureDiameter] = useState<string>('10');
    const [localApertureThickness, setLocalApertureThickness] = useState<string>('1');
    const [localSlitWidth, setLocalSlitWidth] = useState<string>('5');
    const [localSlitRotation, setLocalSlitRotation] = useState<string>('0');




    const [localSpectralPreset, setLocalSpectralPreset] = useState<ProfilePreset>('bandpass');
    const [localSpectralCutoff, setLocalSpectralCutoff] = useState<string>('500');
    const [localSpectralCenter, setLocalSpectralCenter] = useState<string>('525');
    const [localSpectralWidth, setLocalSpectralWidth] = useState<string>('50');
    const [localSpectralSteepness, setLocalSpectralSteepness] = useState<string>('15');
    const [localBands, setLocalBands] = useState<{ center: string; width: string }[]>([{ center: '525', width: '50' }]);

    // Sample fluorescence spectral state — peaks list
    const [localExBands, setLocalExBands] = useState<{ center: string; width: string }[]>([{ center: '488', width: '30' }]);
    const [localEmBands, setLocalEmBands] = useState<{ center: string; width: string }[]>([{ center: '520', width: '40' }]);
    const [localFluorEff, setLocalFluorEff] = useState<string>('0.0001');
    const [localAbsorption, setLocalAbsorption] = useState<string>('3');
    const [localRefractiveIndexDelta, setLocalRefractiveIndexDelta] = useState<string>('0');
    const [localChamberFillMediumIndex, setLocalChamberFillMediumIndex] = useState<string>('1.33');
    const [localPupilMaskRadius, setLocalPupilMaskRadius] = useState<string>('4');
    const [localPupilMaskInner, setLocalPupilMaskInner] = useState<string>('0.55');
    const [localPupilMaskOuter, setLocalPupilMaskOuter] = useState<string>('0.8');
    const [localPupilMaskRingTransmission, setLocalPupilMaskRingTransmission] = useState<string>('1');
    const [localPupilMaskRingPhase, setLocalPupilMaskRingPhase] = useState<string>('1.5708');
    const [localPupilMaskBackgroundTransmission, setLocalPupilMaskBackgroundTransmission] = useState<string>('1');
    const [localPupilMaskBackgroundPhase, setLocalPupilMaskBackgroundPhase] = useState<string>('0');
    const [localPupilMaskResolution, setLocalPupilMaskResolution] = useState<string>('64');
    const [localPupilMaskMode, setLocalPupilMaskMode] = useState<'uniform' | 'annulus' | 'phaseRing'>('phaseRing');
    const [localMediumWidth, setLocalMediumWidth] = useState<string>('10');
    const [localMediumHeight, setLocalMediumHeight] = useState<string>('10');
    const [localMediumDepth, setLocalMediumDepth] = useState<string>('10');
    const [localMediumIndex, setLocalMediumIndex] = useState<string>('1.33');
    const [localMediumExteriorIndex, setLocalMediumExteriorIndex] = useState<string>('1');

    // Specimen orientation (Euler degrees) and offset (mm, ±5)
    const [localSpecRotX, setLocalSpecRotX] = useState<string>('0');
    const [localSpecRotY, setLocalSpecRotY] = useState<string>('0');
    const [localSpecRotZ, setLocalSpecRotZ] = useState<string>('0');
    const [localSpecOffX, setLocalSpecOffX] = useState<string>('0');
    const [localSpecOffY, setLocalSpecOffY] = useState<string>('0');
    const [localSpecOffZ, setLocalSpecOffZ] = useState<string>('0');

    // Piezo scan UI state
    const [localPiezoHalfMm, setLocalPiezoHalfMm] = useState<string>('1');
    const [localPiezoHz, setLocalPiezoHz] = useState<string>('0.5');

    const buildObjectivePupilFromEditor = (
        overrides: Partial<{
            refNm: string;
            defocus: string;
            astig45: string;
            astig0: string;
            comaY: string;
            comaX: string;
            spherical: string;
        }> = {},
    ) => {
        const refNm = parseFloat(overrides.refNm ?? localObjPupilRefNm);
        const coefficients = [
            { index: 4, raw: overrides.defocus ?? localObjDefocus },
            { index: 5, raw: overrides.astig45 ?? localObjAstig45 },
            { index: 6, raw: overrides.astig0 ?? localObjAstig0 },
            { index: 7, raw: overrides.comaY ?? localObjComaY },
            { index: 8, raw: overrides.comaX ?? localObjComaX },
            { index: 11, raw: overrides.spherical ?? localObjSpherical },
        ]
            .map(entry => ({ index: entry.index, coefficient: parseFloat(entry.raw) }))
            .filter(entry => Number.isFinite(entry.coefficient) && Math.abs(entry.coefficient) > 1e-9);

        if (coefficients.length === 0) {
            return null;
        }

        return {
            aberrations: {
                coefficients,
                referenceWavelengthNm: Number.isFinite(refNm) && refNm > 0 ? refNm : 550,
            },
            apodization: null,
        };
    };

    const applyObjectivePupilEditor = (
        overrides: Parameters<typeof buildObjectivePupilFromEditor>[0] = {},
    ) => {
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Objective) {
                c.pupil = buildObjectivePupilFromEditor(overrides);
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };


    useEffect(() => {
        if (selectedComponent) {
            try {
                setLocalX(String(Math.round(selectedComponent.position.x * 100) / 100));
                setLocalY(String(Math.round(selectedComponent.position.y * 100) / 100));
                setLocalZ(String(Math.round(selectedComponent.position.z * 100) / 100));

                // Pan = rotation in XY table plane = rotation around Z axis.
                // Tilt = tip out of table plane = rotation around a horizontal axis.
                // Pan = rotation in XY table plane (around W/Z axis)
                // Tilt = tip out of table plane
                setLocalRotX(String(Math.round(selectedComponent.panAngle * 180 / Math.PI)));
                setLocalRotY(String(Math.round(selectedComponent.tiltAngle * 180 / Math.PI)));
                setLocalRotZ(String(Math.round(selectedComponent.rollAngle * 180 / Math.PI)));


                if (selectedComponent instanceof Card) {
                    const c = selectedComponent;
                    setLocalWidth(String(c.width));
                    setLocalHeight(String(c.height));
                    setLocalOpaque(Boolean(c.opaque));
                }
                if (selectedComponent instanceof Mirror) {
                    setLocalMirrorDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalMirrorThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                }
                if (selectedComponent instanceof BeamSplitter) {
                    setLocalBsDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalBsThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                    setLocalBsSplit(String(Math.round(selectedComponent.splitRatio * 100)));
                }
                if (selectedComponent instanceof PolarizingBeamSplitter) {
                    setLocalBsDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalBsThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                }
                if (selectedComponent instanceof Blocker) {
                    setLocalBlockerDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalBlockerThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                }
                if (selectedComponent instanceof SphericalLens) {
                    setLocalRadius(String(selectedComponent.apertureRadius));
                    const f = selectedComponent.curvature !== 0 ? 1 / selectedComponent.curvature : 0;
                    setLocalFocal(String(Math.round(f * 100) / 100));
                    setLocalThickness(String(selectedComponent.thickness));
                    setLocalIor(String(selectedComponent.ior));


                    if (typeof selectedComponent.getLensType === 'function') {
                        setLocalLensType(selectedComponent.getLensType());
                    }


                    if (typeof selectedComponent.getRadii === 'function') {
                        const radii = selectedComponent.getRadii();
                        setLocalR1(Math.abs(radii.R1) >= 1e6 ? "Infinity" : String(Math.round(radii.R1 * 100) / 100));
                        setLocalR2(Math.abs(radii.R2) >= 1e6 ? "Infinity" : String(Math.round(radii.R2 * 100) / 100));
                    } else {
                        const R = f !== 0 ? (2 * (selectedComponent.ior - 1)) * f : 1e9;
                        setLocalR1(String(Math.round(R * 100) / 100));
                        setLocalR2(String(Math.round(-R * 100) / 100));
                    }
                }
                if (selectedComponent instanceof AsphericLens) {
                    const a = selectedComponent;
                    setLocalAsphR1(Math.abs(a.r1) >= 1e6 ? 'Infinity' : String(Math.round(a.r1 * 100) / 100));
                    setLocalAsphR2(Math.abs(a.r2) >= 1e6 ? 'Infinity' : String(Math.round(a.r2 * 100) / 100));
                    setLocalAsphK1(String(a.k1));
                    setLocalAsphK2(String(a.k2));
                    setLocalAsphA1(a.A1.map(x => x.toExponential(3)));
                    setLocalAsphA2(a.A2.map(x => x.toExponential(3)));
                    setLocalAsphAperture(String(a.apertureRadius));
                    setLocalAsphThickness(String(a.thickness));
                    setLocalAsphIor(String(a.ior));
                }
                if (selectedComponent instanceof IdealLens) {
                    setLocalIdealFocal(String(Math.round(selectedComponent.focalLength * 100) / 100));
                    setLocalIdealAperture(String(Math.round(selectedComponent.apertureRadius * 100) / 100));
                }
                if (selectedComponent instanceof Objective) {
                    setLocalObjNA(String(selectedComponent.NA));
                    setLocalObjMag(String(selectedComponent.magnification));
                    setLocalObjImmersion(String(selectedComponent.immersionIndex));
                    setLocalObjImmersionKind(selectedComponent.immersionMediumKind);
                    setLocalObjWD(String(Math.round(selectedComponent.workingDistance * 100) / 100));
                    setLocalObjDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalObjTubeLensFocal(String(Math.round(selectedComponent.tubeLensFocal * 100) / 100));
                    setLocalObjCoverslipThickness(String(Math.round(selectedComponent.coverslipThickness * 1000) / 1000));
                    setLocalObjFieldNumber(String(Math.round(selectedComponent.fieldNumber * 100) / 100));
                    const coeffs = new Map<number, number>(
                        selectedComponent.pupil?.aberrations?.coefficients.map(entry => [entry.index, entry.coefficient]) ?? [],
                    );
                    setLocalObjPupilRefNm(String(selectedComponent.pupil?.aberrations?.referenceWavelengthNm ?? 550));
                    setLocalObjDefocus(String(coeffs.get(4) ?? 0));
                    setLocalObjAstig45(String(coeffs.get(5) ?? 0));
                    setLocalObjAstig0(String(coeffs.get(6) ?? 0));
                    setLocalObjComaY(String(coeffs.get(7) ?? 0));
                    setLocalObjComaX(String(coeffs.get(8) ?? 0));
                    setLocalObjSpherical(String(coeffs.get(11) ?? 0));
                }
                if (selectedComponent instanceof Camera) {
                    setLocalCameraResX(String(selectedComponent.sensorResX));
                    setLocalCameraResY(String(selectedComponent.sensorResY));
                    setLocalCameraSensorNA(String(selectedComponent.sensorNA));
                    setLocalCameraLaunchModel(selectedComponent.detectorLaunchModel);
                }
                if (selectedComponent instanceof AchromatDoublet) {
                    setLocalDoubletR1(String(Math.round(selectedComponent.r1 * 100) / 100));
                    setLocalDoubletR2(String(Math.round(selectedComponent.r2 * 100) / 100));
                    setLocalDoubletR3(String(Math.round(selectedComponent.r3 * 100) / 100));
                    setLocalDoubletT1(String(Math.round(selectedComponent.t1 * 100) / 100));
                    setLocalDoubletT2(String(Math.round(selectedComponent.t2 * 100) / 100));
                    setLocalDoubletAperture(String(Math.round(selectedComponent.apertureRadius * 100) / 100));
                    setLocalDoubletIor1(String(selectedComponent.ior1));
                    setLocalDoubletIor2(String(selectedComponent.ior2));
                }
                if (selectedComponent instanceof AbstractPolygonOptic) {
                    setLocalPolyFaces(String(selectedComponent.numFaces));
                    setLocalPolyRadius(String(Math.round(selectedComponent.inscribedRadius * 100) / 100));
                    setLocalPolyHeight(String(Math.round(selectedComponent.width * 100) / 100));
                    setLocalPolyScanAngle(String(Math.round(selectedComponent.scanAngle * 180 / Math.PI * 100) / 100));
                    setLocalPolyIor(String(selectedComponent.ior));
                    setLocalPolyMode(selectedComponent.faceModes.some(m => m === 'refractive') ? 'refractive' : 'reflective');
                }
                if (selectedComponent instanceof Laser) {
                    setLocalWavelength(selectedComponent.wavelength);
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                    setLocalLaserPower(String(selectedComponent.power));
                }
                if (selectedComponent instanceof Lamp) {
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                    setLocalLampPower(String(selectedComponent.power));
                    setLocalSourcePointCount(String(selectedComponent.sourcePointCount));
                    setLocalEmitterRadius(String(selectedComponent.emitterRadius));
                }
                if (selectedComponent instanceof PointSourceBase) {
                    setLocalWavelength(selectedComponent.wavelength);
                    setLocalLaserPower(String(selectedComponent.power));
                }
                if (selectedComponent instanceof ConeSource3D) {
                    setLocalHalfAngle(String(Math.round(selectedComponent.halfAngle * 180 / Math.PI * 100) / 100));
                }
                if (selectedComponent instanceof WedgeSource2D) {
                    setLocalSubtendedAngle(String(Math.round(selectedComponent.subtendedAngle * 180 / Math.PI * 100) / 100));
                }
                if (selectedComponent instanceof StructuredSource) {
                    setLocalWavelength(selectedComponent.wavelength);
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                    setLocalLaserPower(String(selectedComponent.power));
                    setLocalAsciiChar(selectedComponent.asciiChar);
                }
                if (selectedComponent instanceof FaradayIsolator) {
                    setLocalInsertionLoss(String(selectedComponent.insertionLoss));
                    setLocalExtinctionDB(String(selectedComponent.extinctionDB));
                }
                if (selectedComponent instanceof QPD) {
                    setLocalQPDDiameter(String(selectedComponent.activeDiameter));
                }
                if (selectedComponent instanceof AOD) {
                    setLocalDeflectionAngle(String(Math.round(selectedComponent.deflectionAngle * 1000 * 100) / 100));
                    setLocalAODEfficiency(String(selectedComponent.efficiency));
                    setLocalAODMaxAngle(String(Math.round(selectedComponent.maxAngle * 1000 * 100) / 100));
                }
                if (selectedComponent instanceof CylindricalLens) {
                    setLocalCylR1(Math.abs(selectedComponent.r1) >= 1e6 ? 'Infinity' : String(Math.round(selectedComponent.r1 * 100) / 100));
                    setLocalCylR2(Math.abs(selectedComponent.r2) >= 1e6 ? 'Infinity' : String(Math.round(selectedComponent.r2 * 100) / 100));
                    setLocalCylAperture(String(Math.round(selectedComponent.apertureRadius * 100) / 100));
                    setLocalCylWidth(String(Math.round(selectedComponent.width * 100) / 100));
                    setLocalCylThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                    setLocalCylIor(String(selectedComponent.ior));
                }
                if (selectedComponent instanceof CurvedMirror) {
                    setLocalCurvedMirrorDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalCurvedMirrorRoC(Math.abs(selectedComponent.radiusOfCurvature) >= 1e6 ? 'Infinity' : String(Math.round(selectedComponent.radiusOfCurvature * 100) / 100));
                    setLocalCurvedMirrorThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                }
                // PrismLens sync removed — unified under AbstractPolygonOptic above
                if (selectedComponent instanceof Aperture) {
                    setLocalApertureDiameter(String(Math.round(selectedComponent.openingDiameter * 100) / 100));
                    setLocalApertureThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                }
                if (selectedComponent instanceof SlitAperture) {
                    setLocalSlitWidth(String(Math.round(selectedComponent.slitWidth * 100) / 100));
                    // Read the roll angle (rotation around the slit's optical axis).
                    setLocalSlitRotation(String(Math.round(selectedComponent.rollAngle * 180 / Math.PI * 100) / 100));
                }
                if (selectedComponent instanceof PupilMaskElement) {
                    setLocalPupilMaskRadius(String(selectedComponent.radius));
                    setLocalPupilMaskInner(String(selectedComponent.innerRadius));
                    setLocalPupilMaskOuter(String(selectedComponent.outerRadius));
                    setLocalPupilMaskRingTransmission(String(selectedComponent.ringTransmission));
                    setLocalPupilMaskRingPhase(String(selectedComponent.ringPhaseShift));
                    setLocalPupilMaskBackgroundTransmission(String(selectedComponent.backgroundTransmission));
                    setLocalPupilMaskBackgroundPhase(String(selectedComponent.backgroundPhaseShift));
                    setLocalPupilMaskResolution(String(selectedComponent.resolution));
                    setLocalPupilMaskMode(selectedComponent.mode);
                }
                if (selectedComponent instanceof MediumVolume) {
                    setLocalMediumWidth(String(selectedComponent.width));
                    setLocalMediumHeight(String(selectedComponent.height));
                    setLocalMediumDepth(String(selectedComponent.depth));
                    setLocalMediumIndex(String(selectedComponent.refractiveIndex));
                    setLocalMediumExteriorIndex(String(selectedComponent.exteriorRefractiveIndex));
                }

                if (selectedComponent instanceof Diffuser) {
                    setLocalDiffuserDiameter(String(selectedComponent.diameter));
                    setLocalDiffuserConeAngle(String(Math.round(selectedComponent.coneHalfAngle * 180 / Math.PI)));
                }

                if (selectedComponent instanceof DoubleSlit) {
                    setLocalDoubleSlitWidth(String(selectedComponent.slitWidth));
                    setLocalDoubleSlitSep(String(selectedComponent.slitSeparation));
                }

                if (selectedComponent instanceof Filter) {
                    setLocalMirrorDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalMirrorThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
                    const sp = selectedComponent.spectralProfile;
                    setLocalSpectralPreset(sp.preset);
                    setLocalSpectralCutoff(String(sp.cutoffNm));
                    setLocalSpectralSteepness(String(sp.edgeSteepness));
                    if (sp.bands.length > 0) {
                        setLocalSpectralCenter(String(sp.bands[0].center));
                        setLocalSpectralWidth(String(sp.bands[0].width));
                    }
                    setLocalBands(sp.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                }
                if (selectedComponent instanceof DichroicMirror) {
                    const sp = selectedComponent.spectralProfile;
                    setLocalSpectralPreset(sp.preset);
                    setLocalSpectralCutoff(String(sp.cutoffNm));
                    setLocalSpectralSteepness(String(sp.edgeSteepness));
                    if (sp.bands.length > 0) {
                        setLocalSpectralCenter(String(sp.bands[0].center));
                        setLocalSpectralWidth(String(sp.bands[0].width));
                    }
                    setLocalBands(sp.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                }
                if (selectedComponent instanceof Sample || selectedComponent instanceof SampleChamber) {
                    const comp = selectedComponent as (Sample | SampleChamber);
                    setLocalExBands(comp.excitationSpectrum.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                    setLocalEmBands(comp.emissionSpectrum.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                    setLocalFluorEff(comp.fluorescenceEfficiency.toPrecision(3));
                    setLocalAbsorption(String(comp.absorption));
                    setLocalRefractiveIndexDelta(String(comp.refractiveIndexDelta));
                    // Specimen rotation (radians → degrees)
                    setLocalSpecRotX(String(Math.round(comp.specimenRotation.x * 180 / Math.PI * 100) / 100));
                    setLocalSpecRotY(String(Math.round(comp.specimenRotation.y * 180 / Math.PI * 100) / 100));
                    setLocalSpecRotZ(String(Math.round(comp.specimenRotation.z * 180 / Math.PI * 100) / 100));
                    // Specimen offset (mm)
                    setLocalSpecOffX(String(Math.round(comp.specimenOffset.x * 1000) / 1000));
                    setLocalSpecOffY(String(Math.round(comp.specimenOffset.y * 1000) / 1000));
                    setLocalSpecOffZ(String(Math.round(comp.specimenOffset.z * 1000) / 1000));

                    const savedPiezo = piezoSettings.get(comp.id);
                    if (savedPiezo) {
                        setLocalPiezoHalfMm(String(savedPiezo.halfMm));
                        setLocalPiezoHz(String(Math.round(1000 / savedPiezo.periodMs * 10) / 10));
                    }
                }
                if (selectedComponent instanceof SampleChamber) {
                    setLocalChamberFillMediumIndex(String(selectedComponent.fillMediumIndex));
                }
            } catch (err) {
                console.error("Inspector Update Error:", err);
            }
        }
    }, [selectedComponent, selection, components]);


    const commitPosition = (axis: 'x' | 'y' | 'z', valueStr: string) => {
        if (!selectedComponent) return;
        const val = parseFloat(valueStr);
        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0]) {
                const newPos = c.position.clone();
                newPos[axis] = val;
                c.setPosition(newPos.x, newPos.y, newPos.z);
                return c;
            }
            return c;
        });
        setComponents(newComponents);
    };


    const commitRotation = (axis: 'x' | 'y' | 'z', valueStr: string) => {
        if (!selectedComponent) return;
        const val = parseFloat(valueStr);
        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0]) {
                if (axis === 'x') c.panAngle = val * Math.PI / 180;
                if (axis === 'y') c.tiltAngle = val * Math.PI / 180;
                if (axis === 'z') c.rollAngle = val * Math.PI / 180;
                c.recomputeRotation();
                return c;
            }
            return c;
        });
        setComponents(newComponents);
    };

    const commitGeometry = (param: 'width' | 'height' | 'radius' | 'focal' | 'r1' | 'r2' | 'thickness' | 'ior', valueStr: string) => {
        if (!selectedComponent) return;


        let val: number;
        if (valueStr.toLowerCase() === 'infinity') {
            val = 1e9;
        } else {
            val = parseFloat(valueStr);
        }

        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0]) {

                if (param === 'width' && 'width' in c) (c as any).width = val;
                if (param === 'height' && 'height' in c) (c as any).height = val;
                if (param === 'radius' && c instanceof SphericalLens) c.apertureRadius = val;
                if (param === 'focal' && c instanceof SphericalLens) {
                    if (Math.abs(val) > 0.001) c.curvature = 1 / val;
                    else c.curvature = 0;
                    // Reset r1/r2 to undefined so focal length takes precedence/recalculates
                    c.r1 = undefined;
                    c.r2 = undefined;
                }
                if (param === 'thickness' && c instanceof SphericalLens) {
                    c.thickness = Math.max(0.1, val);
                }
                if (param === 'ior' && c instanceof SphericalLens) {
                    c.ior = Math.max(1.0, Math.min(3.0, val));
                }
                if (param === 'r1' && c instanceof SphericalLens) {
                    const minR = c.apertureRadius * 1.05;
                    c.r1 = Math.abs(val) < minR ? Math.sign(val) * minR : val;
                    if (c.r2 === undefined) {
                        const old = c.getRadii();
                        c.r2 = old.R2;
                    }
                }
                if (param === 'r2' && c instanceof SphericalLens) {
                    const minR = c.apertureRadius * 1.05;
                    c.r2 = Math.abs(val) < minR ? Math.sign(val) * minR : val;
                    if (c.r1 === undefined) {
                        const old = c.getRadii();
                        c.r1 = old.R1;
                    }
                }
                // Invalidate cached physics mesh so it rebuilds with new parameters
                if (c instanceof SphericalLens) {
                    c.invalidateMesh();
                }
                return c; // Mutable update inside map, but we trigger re-render via setComponents
            }
            return c;
        });

        setComponents([...newComponents]);
    };

    const commitOpaque = (val: boolean) => {
        if (!selectedComponent) return;
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Card) {
                c.opaque = val;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const handleKeyDown = (e: React.KeyboardEvent, commitFn: () => void) => {
        if (e.key === 'Enter') {
            commitFn();
            (e.target as HTMLInputElement).blur();
        }
    };

    const [localName, setLocalName] = useState(selectedComponent?.name ?? '');
    useEffect(() => { setLocalName(selectedComponent?.name ?? ''); }, [selectedComponent?.id]);

    const objectiveScanReadout = useMemo(() => {
        if (!(selectedComponent instanceof Objective)) return null;

        const scanHead = components.find(component => component instanceof DualGalvoScanHead) as DualGalvoScanHead | undefined;
        const sample = components.find(component => component instanceof Sample || component instanceof SampleChamber) as (Sample | SampleChamber | undefined);
        const laser = components.find(component => component instanceof Laser) as Laser | undefined;
        if (!scanHead || !sample || !laser) return null;

        try {
            const measurement = measureChiefRayForScan(components, scanHead.scanX, scanHead.scanY);
            if (!measurement.pupilCoordinates) return null;

            const maxHalfAngleDeg = findMaxUnclippedScanHalfAngleDeg(components, 5, 18);
            const currentBeamRadiusMm = measurement.pupilCoordinates.radius;
            const objectiveOpeningRadiusMm = selectedComponent.pupilRadius;
            const usedPercent = objectiveOpeningRadiusMm > 1e-9
                ? (currentBeamRadiusMm / objectiveOpeningRadiusMm) * 100
                : 0;
            const edgeMarginPercent = Math.max(0, 100 - usedPercent);

            const targetHalfFieldMm = 0.5;
            const sampleAngle = Math.atan2(targetHalfFieldMm, selectedComponent.focalLength);
            const requiredPupilShiftMm = selectedComponent.immersionIndex * selectedComponent.focalLength * Math.sin(sampleAngle);

            const sampleOffset = measurement.sampleWorldHit
                ? measurement.sampleWorldHit.clone().sub(sample.position)
                : null;

            return {
                currentBeamRadiusMm,
                objectiveOpeningRadiusMm,
                usedPercent,
                edgeMarginPercent,
                maxHalfAngleDeg,
                requiredPupilShiftMm,
                sampleOffsetXmm: sampleOffset?.x ?? null,
                sampleOffsetZmm: sampleOffset?.z ?? null,
            };
        } catch {
            return null;
        }
    }, [components, selectedComponent]);

    // If a cone is selected, render the rod properties panel instead of
    // the component properties panel. The solver panel stays visible so the
    // user can still switch viewer modes and adjust rod count.
    if (resolvedRodSelection && selectedRodRef) {
        const { path, rod, segmentIndex } = resolvedRodSelection;
        // Resolve source component from the path's first segment
        const sourceRod = path[0];
        const sourceComponent = sourceRod?.sourceId
            ? components.find(c => c.id === sourceRod.sourceId || c.name === sourceRod.sourceId)
            : undefined;
        // Per-segment interaction component names (what each segment hit)
        const interactionNames = path.map(seg => {
            if (!seg.interactionComponentId) return undefined;
            const c = components.find(cc => cc.id === seg.interactionComponentId);
            return c?.name;
        });
        return (
            <>
                {isMobile && <SolverPanel rayConfig={rayConfig} setrayConfig={setrayConfig} setVisualizationMode={setVisualizationMode} isRendering={isRendering} setImageFormationTrigger={setImageFormationTrigger} animator={animator} animPlaying={animPlaying} setAnimPlaying={setAnimPlaying} />}
                <RodPropertiesPanel
                    rod={rod}
                    path={path}
                    segmentIndex={segmentIndex}
                    sourceComponentName={sourceComponent?.name}
                    interactionComponentNames={interactionNames}
                    onClose={() => setSelectedRodRef(null)}
                    onSelectSegment={(i: number) => setSelectedRodRef({
                        pathIndex: selectedRodRef.pathIndex,
                        segmentIndex: i,
                        source: selectedRodRef.source,
                    })}
                />
            </>
        );
    }

    if (!selectedComponent) {
        return (
            <>
                <SolverPanel rayConfig={rayConfig} setrayConfig={setrayConfig} setVisualizationMode={setVisualizationMode} isRendering={isRendering} setImageFormationTrigger={setImageFormationTrigger} animator={animator} animPlaying={animPlaying} setAnimPlaying={setAnimPlaying} />
            </>
        );
    }

    // The toggle button and solver panel are now rendered unconditionally at the bottom
    // so the properties panel can animate naturally

    const {
        isCard,
        isMirror,
        isBlocker,
        isLens,
        isAsphericLens,
        isIdealLens,
        isObjective,
        isLaser,
        isLamp,
        isPolygonOptic,
        isWaveplate,
        isAperture,
        isSlitAperture,
        isDichroic,
        isCylindrical,
        isCurvedMirror,
        isBeamSplitter,
        isPolarizingBeamSplitter,
        isSample,
        isScanHead,
        isDualGalvo,
        isGalvoOrScanHead,
        isPMT,
        isCamera,
        isAchromatDoublet,
        isPupilMask,
        isMediumVolume,
        isPointSource2D,
        isPointSource3D,
        isConeSource3D,
        isWedgeSource2D,
        isStructuredSource,
        isFaradayIsolator,
        isQPD,
        isAOD,
        isDiffuser,
        isDoubleSlit,
        isAnnotation,
        hasSpectralProfile,
    } = getComponentCapabilities(selectedComponent);

    const commitLaserParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof Laser)) return;
        const radius = parseFloat(localBeamRadius);
        const power = parseFloat(localLaserPower);
        if (isNaN(radius)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Laser) {
                c.wavelength = localWavelength;
                c.beamRadius = radius;
                if (!isNaN(power) && power > 0) c.power = power;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitLampParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof Lamp)) return;
        const radius = parseFloat(localBeamRadius);
        const power = parseFloat(localLampPower);
        const sourcePoints = parseInt(localSourcePointCount);
        const emitterR = parseFloat(localEmitterRadius);
        if (!Number.isFinite(radius) || radius < 0) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Lamp) {
                c.beamRadius = radius;
                if (Number.isFinite(power) && power >= 0) c.power = power;
                if (Number.isFinite(sourcePoints) && sourcePoints >= 1) {
                    c.sourcePointCount = Math.min(32, Math.round(sourcePoints));
                }
                if (Number.isFinite(emitterR) && emitterR >= 0) c.emitterRadius = emitterR;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitPointSourceParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof PointSourceBase)) return;
        const power = parseFloat(localLaserPower);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof PointSourceBase) {
                c.wavelength = localWavelength;
                if (!isNaN(power) && power > 0) c.power = power;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitConeSourceParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof ConeSource3D)) return;
        const power = parseFloat(localLaserPower);
        const halfAngleDeg = parseFloat(localHalfAngle);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof ConeSource3D) {
                c.wavelength = localWavelength;
                if (!isNaN(power) && power > 0) c.power = power;
                if (!isNaN(halfAngleDeg) && halfAngleDeg > 0 && halfAngleDeg <= 90) {
                    c.halfAngle = halfAngleDeg * Math.PI / 180;
                }
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitWedgeSourceParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof WedgeSource2D)) return;
        const power = parseFloat(localLaserPower);
        const subtendedDeg = parseFloat(localSubtendedAngle);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof WedgeSource2D) {
                c.wavelength = localWavelength;
                if (!isNaN(power) && power > 0) c.power = power;
                if (!isNaN(subtendedDeg) && subtendedDeg > 0 && subtendedDeg <= 360) {
                    c.subtendedAngle = subtendedDeg * Math.PI / 180;
                }
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitStructuredSourceParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof StructuredSource)) return;
        const radius = parseFloat(localBeamRadius);
        const power = parseFloat(localLaserPower);
        if (isNaN(radius)) return;
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof StructuredSource) {
                c.wavelength = localWavelength;
                c.beamRadius = radius;
                c.diameter = radius * 2;
                if (!isNaN(power) && power > 0) c.power = power;
                if (localAsciiChar.length > 0) c.asciiChar = localAsciiChar.charAt(0);
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitFaradayParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof FaradayIsolator)) return;
        const loss = parseFloat(localInsertionLoss);
        const ext = parseFloat(localExtinctionDB);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof FaradayIsolator) {
                if (!isNaN(loss) && loss >= 0 && loss <= 1) c.insertionLoss = loss;
                if (!isNaN(ext) && ext > 0) c.extinctionDB = ext;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitQPDParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof QPD)) return;
        const diam = parseFloat(localQPDDiameter);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof QPD) {
                if (!isNaN(diam) && diam > 0) c.activeDiameter = diam;
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitAODParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof AOD)) return;
        const deflMrad = parseFloat(localDeflectionAngle);
        const eff = parseFloat(localAODEfficiency);
        const maxMrad = parseFloat(localAODMaxAngle);
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof AOD) {
                if (!isNaN(deflMrad)) c.deflectionAngle = deflMrad / 1000; // mrad → rad
                if (!isNaN(eff) && eff >= 0 && eff <= 1) c.efficiency = eff;
                if (!isNaN(maxMrad) && maxMrad > 0) c.maxAngle = maxMrad / 1000; // mrad → rad
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const updateSelectedCamera = (mutate: (camera: Camera) => void) => {
        if (!selectedComponent || !(selectedComponent instanceof Camera)) return;
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Camera) {
                mutate(c);
                c.markSolver3Stale();
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    const commitName = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) { setLocalName(selectedComponent.name); return; }
        const newComponents = components.map(c => {
            if (c.id === selection[0]) { c.name = trimmed; return c; }
            return c;
        });
        setComponents([...newComponents]);
    };

    return (
        <>
        {isMobile && <SolverPanel rayConfig={rayConfig} setrayConfig={setrayConfig} setVisualizationMode={setVisualizationMode} isRendering={isRendering} setImageFormationTrigger={setImageFormationTrigger} animator={animator} animPlaying={animPlaying} setAnimPlaying={setAnimPlaying} />}
        {isMobile && (
            <button
                onClick={() => setMobilePropsOpen(!mobilePropsOpen)}
                style={{
                    position: 'fixed',
                    top: 60,
                    right: 10,
                    zIndex: 20,
                    width: 44,
                    height: 44,
                    borderRadius: '8px',
                    border: '1px solid #444',
                    backgroundColor: '#1a1a1a',
                    color: '#aaa',
                    fontSize: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    transition: 'all 0.3s ease',
                    opacity: mobilePropsOpen ? 0 : 1,
                    pointerEvents: mobilePropsOpen ? 'none' : 'auto'
                }}
                title="Open properties"
            >
                &#9776;
            </button>
        )}

        {/* Mobile backdrop */}
        {isMobile && mobilePropsOpen && (
            <div
                onClick={() => setMobilePropsOpen(false)}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: 'var(--app-height, 100dvh)',
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    zIndex: 14,
                    transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
            />
        )}
        <div style={{
            position: 'fixed',
            top: isMobile ? undefined : 20,
            bottom: isMobile ? 0 : undefined,
            left: isMobile ? 0 : undefined,
            right: isMobile ? 0 : 20,
            width: isMobile ? '100vw' : 'min(280px, calc(100% - 40px))',
            maxWidth: isMobile ? '100vw' : 'calc(100% - 40px)',
            // Mobile inspector spans the full screen width and ~2/3 of the
            // height; combined with the multi-column inner layout (see below),
            // this gives the property fields enough room that the user
            // doesn't run off the bottom of the panel.
            maxHeight: isMobile ? 'calc(var(--app-height, 100dvh) * 0.7)' : 'calc(100% - 40px)',
            borderBottomLeftRadius: isMobile ? 0 : 16,
            borderBottomRightRadius: isMobile ? 0 : 16,
            borderTopLeftRadius: isMobile ? 24 : 16,
            borderTopRightRadius: isMobile ? 24 : 16,
            backgroundColor: 'rgba(10, 12, 16, 0.65)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            color: '#eee',
            padding: 16,
            // iOS Safari hides ~30-50px under its bottom URL bar / home
            // indicator. Without this padding the last property row gets
            // hidden, which is the user-reported "cut off at the bottom".
            paddingBottom: isMobile ? 'max(env(safe-area-inset-bottom, 16px), 24px)' : 16,
            border: '1px solid rgba(255,255,255,0.06)',
            fontFamily: 'var(--ui-font)',
            boxShadow: '0 12px 60px rgba(0,0,0,0.8)',
            overflowY: 'auto',
            zIndex: isMobile ? 15 : undefined,
            transform: isMobile ? (mobilePropsOpen ? 'translateY(0)' : 'translateY(110%)') : undefined,
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isMobile && !mobilePropsOpen ? 'none' : 'auto'
        }}>
            {/* iOS Style Notch for Mobile */}
            {isMobile && (
                <div 
                    onClick={() => setMobilePropsOpen(false)}
                    style={{
                        width: '100%', 
                        display: 'flex', 
                        justifyContent: 'center', 
                        paddingBottom: '12px',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{ width: '40px', height: '4px', backgroundColor: '#555', borderRadius: '2px' }} />
                </div>
            )}

            {/* Editable name + delete trash icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, borderBottom: '1px solid #555', paddingBottom: 8 }}>
                <input
                    type="text"
                    value={localName}
                    onChange={e => setLocalName(e.target.value)}
                    onBlur={() => commitName(localName)}
                    onKeyDown={e => { if (e.key === 'Enter') { commitName(localName); (e.target as HTMLInputElement).blur(); } }}
                    style={{
                        flex: 1,
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: 4,
                        color: '#fff',
                        fontSize: '14px',
                        fontWeight: 700,
                        padding: '2px 4px',
                        outline: 'none',
                        transition: 'border-color 0.15s',
                        minWidth: 0,
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#555'; }}
                    onBlurCapture={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                />
                <button
                    onClick={() => {
                        pushUndo();  // snapshot before delete
                        const deletedId = selection[0];
                        setComponents(components.filter(c =>
                            c.id !== deletedId &&
                            !(c instanceof TrappedBead && c.parentSampleId === deletedId)
                        ));
                        setSelection([]);
                    }}
                    className="cyber-btn danger"
                    title="Delete component"
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                        color: '#888',
                        flexShrink: 0,
                    }}
                    onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseOut={e => { e.currentTarget.style.color = '#888'; }}
                >
                    <Trash2 size={15} />
                </button>
            </div>

            <div
                className={isMobile ? 'inspector-multicol-mobile' : undefined}
                style={isMobile
                    // Mobile: row-major CSS Grid (defined in
                    // ensureInspectorMobileStyle).  Property blocks become
                    // grid cells flowing left → right, then to the next row,
                    // so the panel actually uses the screen width instead of
                    // stacking everything into one tall column.
                    ? {}
                    : { display: 'flex', flexDirection: 'column', gap: 10 }
                }>
                {/* Position — X / Y / Z */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    {(['x', 'y', 'z'] as const).map((axis, i) => {
                        const locked = selectedComponent?.axisLock?.[axis] ?? (axis === 'z');
                        const values = [localX, localY, localZ];
                        const setters = [setLocalX, setLocalY, setLocalZ];
                        return (
                            <div key={axis} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
                                    <label style={{ fontSize: '10px', color: '#888' }}>{axis.toUpperCase()} (mm)</label>
                                    <button
                                        onClick={() => {
                                            if (!selectedComponent) return;
                                            pushUndo();
                                            selectedComponent.axisLock[axis] = !locked;
                                            selectedComponent.version++;
                                            // Tactile confirmation that the lock flipped — matters
                                            // most for Z, since toggling it changes whether dragging
                                            // can move the component between table layers.
                                            haptic.confirm();
                                            setComponents(prev => [...prev]);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            cursor: 'pointer',
                                            fontSize: '10px',
                                            lineHeight: 1,
                                            opacity: locked ? 1 : 0.4,
                                            transition: 'opacity 0.2s',
                                        }}
                                        title={locked ? `Unlock ${axis.toUpperCase()} axis` : `Lock ${axis.toUpperCase()} axis`}
                                    >
                                        {locked ? '🔒' : '🔓'}
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={values[i]}
                                    onChange={(e) => setters[i](e.target.value)}
                                    onBlur={() => commitPosition(axis, values[i])}
                                    onKeyDown={(e) => handleKeyDown(e, () => commitPosition(axis, values[i]))}
                                    style={inputStyle}
                                />
                            </div>
                        );
                    })}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <ScrubInput
                        label="U"
                        suffix="°"
                        value={localRotX}
                        onChange={setLocalRotX}
                        onCommit={(v: string) => commitRotation('x', v)}
                        speed={1}
                        step={1}
                    />
                    <ScrubInput
                        label="V"
                        suffix="°"
                        value={localRotY}
                        onChange={setLocalRotY}
                        onCommit={(v: string) => commitRotation('y', v)}
                        speed={1}
                        step={1}
                    />
                    <ScrubInput
                        label="W"
                        suffix="°"
                        value={localRotZ}
                        onChange={setLocalRotZ}
                        onCommit={(v: string) => commitRotation('z', v)}
                        speed={1}
                        step={1}
                    />
                </div>

                {/* Dynamic Properties */}
                {isCard && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Width (mm)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={localWidth}
                                onChange={(e) => setLocalWidth(e.target.value)}
                                onBlur={() => commitGeometry('width', localWidth)}
                                onKeyDown={(e) => handleKeyDown(e, () => commitGeometry('width', localWidth))}
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Height (mm)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={localHeight}
                                onChange={(e) => setLocalHeight(e.target.value)}
                                onBlur={() => commitGeometry('height', localHeight)}
                                onKeyDown={(e) => handleKeyDown(e, () => commitGeometry('height', localHeight))}
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <input
                                type="checkbox"
                                id={`card-opaque-${selectedComponent.id}`}
                                checked={localOpaque}
                                onChange={(e) => {
                                    setLocalOpaque(e.target.checked);
                                    commitOpaque(e.target.checked);
                                }}
                                style={{ margin: 0, cursor: 'pointer' }}
                            />
                            <label htmlFor={`card-opaque-${selectedComponent.id}`} style={{ fontSize: '11px', color: '#ccc', cursor: 'pointer', userSelect: 'none' }}>
                                Opaque (Stop Light)
                            </label>
                        </div>
                    </div>
                )}

                {isBlocker && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Blocker Geometry</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Diameter"
                                suffix="mm"
                                value={localBlockerDiameter}
                                onChange={setLocalBlockerDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Blocker) {
                                            c.diameter = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localBlockerThickness}
                                onChange={setLocalBlockerThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Blocker) {
                                            c.thickness = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.2}
                                min={0.5}
                                max={50}
                            />
                        </div>
                    </div>
                )}

                {isMirror && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Mirror Geometry</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Diameter"
                                suffix="mm"
                                value={localMirrorDiameter}
                                onChange={setLocalMirrorDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Mirror) {
                                            c.diameter = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localMirrorThickness}
                                onChange={setLocalMirrorThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Mirror) {
                                            c.thickness = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.1}
                                min={0.5}
                                max={20}
                            />
                        </div>
                    </div>
                )}

                {(isBeamSplitter || isPolarizingBeamSplitter) && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                            {isPolarizingBeamSplitter ? 'Polarizing Beam Splitter' : 'Beam Splitter'}
                        </label>
                        <div style={{ fontSize: '10px', color: '#888', marginBottom: 8 }}>
                            {isPolarizingBeamSplitter
                                ? 'S-pol → reflected, P-pol → transmitted (incidence-plane decomposition).'
                                : 'Non-polarizing; split fraction is independent of polarization.'}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: isPolarizingBeamSplitter ? '1fr 1fr' : '1fr 1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Aperture"
                                suffix="mm"
                                value={localBsDiameter}
                                onChange={setLocalBsDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && (c instanceof BeamSplitter || c instanceof PolarizingBeamSplitter)) {
                                            c.diameter = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localBsThickness}
                                onChange={setLocalBsThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && (c instanceof BeamSplitter || c instanceof PolarizingBeamSplitter)) {
                                            c.thickness = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.1}
                                min={0.5}
                                max={20}
                            />
                            {isBeamSplitter && (
                                <ScrubInput
                                    label="Reflect %"
                                    suffix="%"
                                    value={localBsSplit}
                                    onChange={setLocalBsSplit}
                                    onCommit={(v: string) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val < 0 || val > 100) return;
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof BeamSplitter) {
                                                c.splitRatio = val / 100;
                                                c.version++;
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    speed={1}
                                    min={0}
                                    max={100}
                                />
                            )}
                        </div>
                    </div>
                )}

                {isCurvedMirror && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Curved Mirror</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Diameter"
                                suffix="mm"
                                value={localCurvedMirrorDiameter}
                                onChange={setLocalCurvedMirrorDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CurvedMirror) {
                                            c.diameter = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="Radius of Curv."
                                suffix="mm"
                                value={localCurvedMirrorRoC}
                                onChange={setLocalCurvedMirrorRoC}
                                onCommit={(v: string) => {
                                    let val: number;
                                    if (v.toLowerCase() === 'infinity') val = 1e9;
                                    else val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CurvedMirror) {
                                            // Clamp |R| >= diameter/2 so sphere covers full aperture
                                            const minR = c.diameter / 2 * 1.05;
                                            if (Math.abs(val) < 1e6) {
                                                val = Math.abs(val) < minR ? Math.sign(val || 1) * minR : val;
                                            }
                                            c.radiusOfCurvature = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                allowInfinity
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localCurvedMirrorThickness}
                                onChange={setLocalCurvedMirrorThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CurvedMirror) {
                                            c.thickness = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.1}
                                min={0.5}
                                max={20}
                            />
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: 6 }}>
                            f = {Math.abs((selectedComponent as CurvedMirror).radiusOfCurvature) >= 1e6 ? '∞' : String(Math.round((selectedComponent as CurvedMirror).focalLength * 100) / 100)} mm
                            {' · '}
                            {(selectedComponent as CurvedMirror).radiusOfCurvature > 0 ? 'Concave' : (selectedComponent as CurvedMirror).radiusOfCurvature < 0 ? 'Convex' : 'Flat'}
                        </div>
                    </div>
                )}

                {/* Galvo Scan — for Mirror, CurvedMirror, and ScanHeads */}
                {isGalvoOrScanHead && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Galvo Scan</label>
                        {(() => {
                            // For DualGalvo: find BOTH channels; for single: find one
                            const channelX = animator.channels.find(ch => ch.targetId === selectedComponent.id && (ch.property === 'scanX' || ch.property === 'panAngle'));
                            const channelY = animator.channels.find(ch => ch.targetId === selectedComponent.id && (ch.property === 'scanY' || ch.property === 'tiltAngle'));
                            const activeChannel = channelX || channelY;
                            const isScanning = isDualGalvo ? !!(channelX || channelY) : !!activeChannel;
                            const savedSettings = galvoAngles.get(selectedComponent.id);

                            if (isDualGalvo) {
                                return (
                                    <DualGalvoControls
                                        component={selectedComponent as DualGalvoScanHead}
                                        channelX={channelX}
                                        channelY={channelY}
                                        savedSettings={savedSettings}
                                        animator={animator}
                                        animPlaying={animPlaying}
                                        setGalvoAngles={setGalvoAngles}
                                        setAnimPlaying={setAnimPlaying}
                                        setChannelVersion={setChannelVersion}
                                    />
                                );
                            }

                            // ── Single-axis galvo (Mirror, CurvedMirror, GalvoScanHead) ──
                            const currentAxis = activeChannel
                                ? (activeChannel.property === 'tiltAngle' || activeChannel.property === 'scanY' ? 'U' : 'V')
                                : (savedSettings?.axis ?? 'V');
                            const currentHalfDeg = isScanning
                                ? Math.round((activeChannel!.to - activeChannel!.from) * 90 / Math.PI * 10) / 10
                                : (savedSettings?.halfDeg ?? 1);

                            // Compute center from restoreValue or midpoint — NOT live rotation (which animation mutates)
                            const channelCenter = activeChannel ? (activeChannel.restoreValue ?? (activeChannel.from + activeChannel.to) / 2) : 0;
                            return (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '10px', color: '#888', minWidth: '30px' }}>Axis</span>
                                        <select
                                            id={'galvo-axis-' + selectedComponent.id}
                                            value={currentAxis}
                                            key={`galvo-axis-${selectedComponent.id}-${activeChannel?.id ?? 'idle'}`}
                                            onChange={e => {
                                                const newAxisLabel = e.target.value;
                                                const newAxisProp = isScanHead
                                                    ? (newAxisLabel === 'U' ? 'scanY' : 'scanX')
                                                    : (newAxisLabel === 'U' ? 'tiltAngle' : 'panAngle');
                                                if (isScanning) {
                                                    const oldPeriodMs = activeChannel!.periodMs;
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    const newCenter = isScanHead
                                                        ? ((selectedComponent as GalvoScanHead)[newAxisProp === 'scanY' ? 'scanY' : 'scanX'])
                                                        : (newAxisProp === 'tiltAngle' ? selectedComponent.tiltAngle : selectedComponent.panAngle);
                                                    const rangeEl = document.getElementById('galvo-range-' + selectedComponent.id) as HTMLInputElement;
                                                    const halfAngleDeg = parseFloat(rangeEl?.value || String(currentHalfDeg));
                                                    const halfAngleRad = halfAngleDeg * Math.PI / 180;
                                                    animator.addChannel({
                                                        id: generateChannelId(),
                                                        targetId: selectedComponent.id,
                                                        property: newAxisProp,
                                                        from: newCenter - halfAngleRad,
                                                        to: newCenter + halfAngleRad,
                                                        easing: 'sinusoidal',
                                                        periodMs: oldPeriodMs,
                                                        repeat: true,
                                                        restoreValue: newCenter,
                                                    });
                                                    setAnimPlaying(true);
                                                    setChannelVersion(v => v + 1);
                                                } else {
                                                    setGalvoAngles(prev => {
                                                        const old = prev.get(selectedComponent.id);
                                                        const next = new Map(prev);
                                                        next.set(selectedComponent.id, {
                                                            halfDeg: old?.halfDeg ?? currentHalfDeg,
                                                            periodMs: old?.periodMs ?? 2000,
                                                            axis: newAxisLabel,
                                                        });
                                                        return next;
                                                    });
                                                }
                                            }}
                                            style={{
                                                background: '#222',
                                                color: '#ccc',
                                                border: '1px solid #555',
                                                borderRadius: '3px',
                                                fontSize: '10px',
                                                padding: '2px 4px',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <option value="U">U (tilt)</option>
                                            <option value="V">V (pan)</option>
                                        </select>
                                        <span style={{ fontSize: '10px', color: '#888', marginLeft: '6px', minWidth: '24px' }}>±</span>
                                        <input
                                            type="number"
                                            defaultValue={currentHalfDeg}
                                            key={`galvo-range-${selectedComponent.id}`}
                                            min={0.1}
                                            max={45}
                                            step={0.5}
                                            onChange={e => {
                                                const halfAngleDeg = parseFloat(e.target.value);
                                                if (isNaN(halfAngleDeg) || halfAngleDeg <= 0) return;
                                                setGalvoAngles(prev => {
                                                    const old = prev.get(selectedComponent.id);
                                                    const next = new Map(prev);
                                                    next.set(selectedComponent.id, {
                                                        halfDeg: halfAngleDeg,
                                                        periodMs: old?.periodMs ?? 2000,
                                                        axis: old?.axis ?? currentAxis,
                                                    });
                                                    return next;
                                                });
                                                if (isScanning && activeChannel) {
                                                    const halfAngleRad = halfAngleDeg * Math.PI / 180;
                                                    const center = activeChannel.restoreValue ?? (activeChannel.from + activeChannel.to) / 2;
                                                    activeChannel.from = center - halfAngleRad;
                                                    activeChannel.to = center + halfAngleRad;
                                                }
                                            }}
                                            style={{
                                                width: '40px',
                                                background: '#222',
                                                color: '#ccc',
                                                border: '1px solid #555',
                                                borderRadius: '3px',
                                                fontSize: '10px',
                                                padding: '2px 4px',
                                                textAlign: 'center',
                                            }}
                                        />
                                        <span style={{ fontSize: '10px', color: '#888' }}>°</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <button
                                            onClick={() => {
                                                if (isScanning) {
                                                    // galvoAngles is already up-to-date from onChange handlers
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    if (animator.channels.length === 0) setAnimPlaying(false);
                                                    setChannelVersion(v => v + 1);
                                                } else {
                                                    // Read from galvoAngles (always current)
                                                    const axis = isScanHead
                                                        ? (currentAxis === 'U' ? 'scanY' : 'scanX')
                                                        : (currentAxis === 'U' ? 'tiltAngle' : 'panAngle');
                                                    const halfAngleRad = (savedSettings?.halfDeg ?? currentHalfDeg) * Math.PI / 180;
                                                    const periodMs = savedSettings?.periodMs ?? 2000;
                                                    const currentRotVal = isScanHead
                                                        ? ((selectedComponent as GalvoScanHead)[axis === 'scanY' ? 'scanY' : 'scanX'])
                                                        : (axis === 'tiltAngle' ? selectedComponent.tiltAngle : selectedComponent.panAngle);
                                                    const center = channelCenter || currentRotVal;
                                                    const ch: AnimationChannel = {
                                                        id: generateChannelId(),
                                                        targetId: selectedComponent.id,
                                                        property: axis,
                                                        from: center - halfAngleRad,
                                                        to: center + halfAngleRad,
                                                        easing: 'sinusoidal',
                                                        periodMs,
                                                        repeat: true,
                                                        restoreValue: center,
                                                    };
                                                    animator.addChannel(ch);
                                                    setAnimPlaying(true);
                                                    setChannelVersion(v => v + 1);
                                                }
                                            }}
                                            style={{
                                                flex: 1,
                                                padding: '6px 0',
                                                background: isScanning ? '#3a1a1a' : '#1a2a3a',
                                                border: `1px solid ${isScanning ? '#8a3a3a' : '#3a6a8a'}`,
                                                borderRadius: '5px',
                                                color: isScanning ? '#ff7b7b' : '#74b9ff',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                letterSpacing: '0.3px',
                                                transition: 'all 0.15s',
                                            }}
                                            onMouseOver={e => {
                                                e.currentTarget.style.background = isScanning ? '#4a2a2a' : '#253a4a';
                                                e.currentTarget.style.borderColor = isScanning ? '#f44' : '#64b5f6';
                                            }}
                                            onMouseOut={e => {
                                                e.currentTarget.style.background = isScanning ? '#3a1a1a' : '#1a2a3a';
                                                e.currentTarget.style.borderColor = isScanning ? '#8a3a3a' : '#3a6a8a';
                                            }}
                                        >
                                            {isScanning ? `⏹ Stop (${currentAxis})` : '⏵ Scan Galvo'}
                                        </button>
                                        <span style={{ fontSize: '10px', color: '#888', marginLeft: 6 }}>Hz</span>
                                        <input
                                            type="number"
                                            defaultValue={isScanning ? Math.round(1000 / activeChannel!.periodMs * 10) / 10 : Math.round(1000 / (savedSettings?.periodMs ?? 2000) * 10) / 10}
                                            key={`galvo-hz-${selectedComponent.id}`}
                                            min={0.1}
                                            max={10000}
                                            step={0.1}
                                            onChange={e => {
                                                const hz = parseFloat(e.target.value);
                                                if (isNaN(hz) || hz <= 0) return;
                                                setGalvoAngles(prev => {
                                                    const old = prev.get(selectedComponent.id);
                                                    const next = new Map(prev);
                                                    next.set(selectedComponent.id, {
                                                        halfDeg: old?.halfDeg ?? currentHalfDeg,
                                                        periodMs: 1000 / hz,
                                                        axis: old?.axis ?? currentAxis,
                                                    });
                                                    return next;
                                                });
                                                if (activeChannel) activeChannel.periodMs = 1000 / hz;
                                            }}
                                            style={{
                                                width: '48px',
                                                background: '#222',
                                                color: '#ccc',
                                                border: '1px solid #555',
                                                borderRadius: '3px',
                                                fontSize: '10px',
                                                padding: '2px 4px',
                                                textAlign: 'center',
                                            }}
                                        />
                                    </div>
                                    {isScanning && (
                                        <div style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                                            {Math.round((activeChannel!.to - activeChannel!.from) * 90 / Math.PI)}° sweep · {currentAxis === 'U' ? 'tilt' : 'pan'} · {Math.round(1000 / activeChannel!.periodMs * 10) / 10} Hz
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}

                {isPolygonOptic && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Polygon Optic</label>
                        {/* Surface mode toggle */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                            {(['refractive', 'reflective'] as const).map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => {
                                        setLocalPolyMode(mode);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                                c.faceModes = c.faceModes.map(() => mode);
                                                c.invalidateMesh();
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '4px 8px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        background: localPolyMode === mode ? (mode === 'refractive' ? '#1a2a3a' : '#2a2a3a') : '#222',
                                        border: `1px solid ${localPolyMode === mode ? (mode === 'refractive' ? '#3a6a8a' : '#6a5a8a') : '#444'}`,
                                        borderRadius: '4px',
                                        color: localPolyMode === mode ? (mode === 'refractive' ? '#74b9ff' : '#b9a0ff') : '#666',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {mode === 'refractive' ? 'Glass' : 'Mirror'}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Sides"
                                suffix=""
                                value={localPolyFaces}
                                onChange={setLocalPolyFaces}
                                onCommit={(v: string) => {
                                    const val = Math.max(3, Math.round(parseFloat(v)));
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                            c.setRegularPolygon(val, c.inscribedRadius);
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.2}
                                min={3}
                                max={12}
                            />
                            <ScrubInput
                                label="Radius"
                                suffix="mm"
                                value={localPolyRadius}
                                onChange={setLocalPolyRadius}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                            c.setRegularPolygon(c.numFaces, val);
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={50}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: localPolyMode === 'refractive' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput
                                label="Width"
                                suffix="mm"
                                value={localPolyHeight}
                                onChange={setLocalPolyHeight}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                            c.width = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={100}
                            />
                            <ScrubInput
                                label="Scan ∠"
                                suffix="°"
                                value={localPolyScanAngle}
                                onChange={setLocalPolyScanAngle}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                            c.applyScanAngle(val * Math.PI / 180);
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                min={0}
                                max={360}
                            />
                            {localPolyMode === 'refractive' && (
                                <ScrubInput
                                    label="IoR"
                                    value={localPolyIor}
                                    onChange={setLocalPolyIor}
                                    onCommit={(v: string) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val < 1.0 || val > 3.0) return;
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof AbstractPolygonOptic) {
                                                c.ior = val;
                                                c.invalidateMesh();
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    speed={0.005}
                                    min={1.0}
                                    max={3.0}
                                    step={0.001}
                                    title="Index of Refraction"
                                />
                            )}
                        </div>
                        <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                            {selectedComponent instanceof AbstractPolygonOptic && (
                                <>
                                    Scan/facet = {Math.round(4 * 180 / selectedComponent.numFaces * 100) / 100}°
                                    {' · '}
                                    R = {Math.round(selectedComponent.inscribedRadius / Math.cos(Math.PI / selectedComponent.numFaces) * 100) / 100} mm
                                </>
                            )}
                        </div>
                        {/* Animate Scan button + speed */}
                        {(() => {
                            const activeChannel = animator.channels.find(ch => ch.targetId === selectedComponent.id && ch.property === 'scanAngle');
                            const isAnimating = !!activeChannel;
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                                    <button
                                        onClick={() => {
                                            if (isAnimating) {
                                                animator.removeChannel(activeChannel!.id);
                                                if (animator.channels.length === 0) setAnimPlaying(false);
                                            } else {
                                                const ch: AnimationChannel = {
                                                    id: generateChannelId(),
                                                    targetId: selectedComponent.id,
                                                    property: 'scanAngle',
                                                    from: 0,
                                                    to: 2 * Math.PI,
                                                    easing: 'linear',
                                                    periodMs: 2000,
                                                    repeat: true,
                                                };
                                                animator.addChannel(ch);
                                                setAnimPlaying(true);
                                            }
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '6px 0',
                                            background: isAnimating ? '#3a1a1a' : '#1a2a3a',
                                            border: `1px solid ${isAnimating ? '#8a3a3a' : '#3a6a8a'}`,
                                            borderRadius: '5px',
                                            color: isAnimating ? '#ff7b7b' : '#74b9ff',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            letterSpacing: '0.3px',
                                            transition: 'all 0.15s',
                                        }}
                                        onMouseOver={e => {
                                            e.currentTarget.style.background = isAnimating ? '#4a2a2a' : '#253a4a';
                                            e.currentTarget.style.borderColor = isAnimating ? '#f44' : '#64b5f6';
                                        }}
                                        onMouseOut={e => {
                                            e.currentTarget.style.background = isAnimating ? '#3a1a1a' : '#1a2a3a';
                                            e.currentTarget.style.borderColor = isAnimating ? '#8a3a3a' : '#3a6a8a';
                                        }}
                                    >
                                        {isAnimating ? '⏹ Stop Scan' : '⏵ Animate Scan'}
                                    </button>
                                    {isAnimating && (
                                        <>
                                            <input
                                                type="range"
                                                min={-1}
                                                max={1}
                                                step={0.01}
                                                value={Math.log10(animSpeed)}
                                                onChange={e => setAnimSpeed(Math.pow(10, parseFloat(e.target.value)))}
                                                style={{ width: '50px', accentColor: '#74b9ff' }}
                                                title={`Speed: ${animSpeed.toFixed(1)}×`}
                                            />
                                            <span style={{ fontSize: '9px', color: '#74b9ff', minWidth: '22px' }}>{animSpeed.toFixed(1)}×</span>
                                        </>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {isCylindrical && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Cylindrical Lens</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="R1"
                                suffix="mm"
                                value={localCylR1}
                                onChange={setLocalCylR1}
                                onCommit={(v: string) => {
                                    let val: number;
                                    if (v.toLowerCase() === 'infinity') val = 1e9;
                                    else val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            // Clamp |R1| >= apertureRadius
                                            const minR = c.apertureRadius * 1.05;
                                            if (Math.abs(val) < 1e6) {
                                                val = Math.abs(val) < minR ? Math.sign(val || 1) * minR : val;
                                            }
                                            c.r1 = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                allowInfinity
                            />
                            <ScrubInput
                                label="R2"
                                suffix="mm"
                                value={localCylR2}
                                onChange={setLocalCylR2}
                                onCommit={(v: string) => {
                                    let val: number;
                                    if (v.toLowerCase() === 'infinity') val = 1e9;
                                    else val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            const minR = c.apertureRadius * 1.05;
                                            if (Math.abs(val) < 1e6) {
                                                val = Math.abs(val) < minR ? Math.sign(val || 1) * minR : val;
                                            }
                                            c.r2 = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                allowInfinity
                            />
                            <ScrubInput
                                label="Aperture"
                                suffix="mm"
                                value={localCylAperture}
                                onChange={setLocalCylAperture}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            // Clamp aperture so it can't exceed the curvature radii
                                            let maxAperture = 100;
                                            if (Math.abs(c.r1) < 1e6) maxAperture = Math.min(maxAperture, Math.abs(c.r1) * 0.95);
                                            if (Math.abs(c.r2) < 1e6) maxAperture = Math.min(maxAperture, Math.abs(c.r2) * 0.95);
                                            // Also clamp so total sag doesn't exceed thickness
                                            const sagAt = (R: number, r: number) => {
                                                if (Math.abs(R) >= 1e6) return 0;
                                                const v = R * R - r * r;
                                                return v > 0 ? Math.abs(R) - Math.sqrt(v) : Math.abs(R);
                                            };
                                            while (maxAperture > 1 && sagAt(c.r1, maxAperture) + sagAt(c.r2, maxAperture) > c.thickness * 0.95) {
                                                maxAperture *= 0.95;
                                            }
                                            c.apertureRadius = Math.min(val, maxAperture);
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={100}
                            />
                            <ScrubInput
                                label="Width"
                                suffix="mm"
                                value={localCylWidth}
                                onChange={setLocalCylWidth}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            c.width = val;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={100}
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localCylThickness}
                                onChange={setLocalCylThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            c.thickness = Math.max(0.1, val);
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.1}
                                min={0.1}
                                max={30}
                            />
                            <ScrubInput
                                label="IoR"
                                value={localCylIor}
                                onChange={setLocalCylIor}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            c.ior = Math.max(1.0, Math.min(3.0, val));
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.01}
                                min={1.0}
                                max={3.0}
                                step={0.001}
                            />
                        </div>
                    </div>
                )}

                {isAchromatDoublet && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Achromatic Doublet</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            <ScrubInput label="R1" suffix="mm" value={localDoubletR1} onChange={setLocalDoubletR1}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.r1 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={1} title="Surface 1 radius (front)" />
                            <ScrubInput label="R2" suffix="mm" value={localDoubletR2} onChange={setLocalDoubletR2}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.r2 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={1} title="Surface 2 radius (cemented interface)" />
                            <ScrubInput label="R3" suffix="mm" value={localDoubletR3} onChange={setLocalDoubletR3}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.r3 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={1} title="Surface 3 radius (back)" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="t₁" suffix="mm" value={localDoubletT1} onChange={setLocalDoubletT1}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.t1 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={0.2} min={0.1} max={50} title="Element 1 thickness (crown)" />
                            <ScrubInput label="t₂" suffix="mm" value={localDoubletT2} onChange={setLocalDoubletT2}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.t2 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={0.2} min={0.1} max={50} title="Element 2 thickness (flint)" />
                            <ScrubInput label="Aperture" suffix="mm" value={localDoubletAperture} onChange={setLocalDoubletAperture}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.apertureRadius = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={0.5} min={1} max={100} title="Clear aperture radius" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="n₁ (crown)" suffix="" value={localDoubletIor1} onChange={setLocalDoubletIor1}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1 || val > 3) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.ior1 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={0.005} min={1.0} max={3.0} step={0.001} title="Element 1 refractive index" />
                            <ScrubInput label="n₂ (flint)" suffix="" value={localDoubletIor2} onChange={setLocalDoubletIor2}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1 || val > 3) return;
                                    const newC = components.map(c => {
                                        if (c.id === selection[0] && c instanceof AchromatDoublet) { c.ior2 = val; c.invalidateMesh(); return c; }
                                        return c;
                                    });
                                    setComponents([...newC]);
                                }} speed={0.005} min={1.0} max={3.0} step={0.001} title="Element 2 refractive index" />
                        </div>
                    </div>
                )}

                {isLens && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        {/* Lens Type Selector */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Lens Type</label>
                            <select
                                value={localLensType}
                                onChange={(e) => {
                                    const type = e.target.value;
                                    setLocalLensType(type);
                                    if (selectedComponent instanceof SphericalLens) {
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof SphericalLens) {
                                                c.setFromLensType(type);
                                                c.invalidateMesh();
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }
                                }}
                                style={{ ...inputStyle, cursor: 'pointer' }}
                            >
                                <option value="biconvex">Biconvex</option>
                                <option value="plano-convex">Plano-Convex</option>
                                <option value="convex-plano">Convex-Plano</option>
                                <option value="meniscus-pos">Meniscus (+)</option>
                                <option value="plano-concave">Plano-Concave</option>
                                <option value="concave-plano">Concave-Plano</option>
                                <option value="biconcave">Biconcave</option>
                                <option value="meniscus-neg">Meniscus (−)</option>
                            </select>
                        </div>

                        {/* Primary Controls — all scrubbable */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
                            <ScrubInput
                                label="Focal Len"
                                suffix="mm"
                                value={localFocal}
                                onChange={setLocalFocal}
                                onCommit={(v) => commitGeometry('focal', v)}
                                speed={1.0}
                            />
                            <ScrubInput
                                label="Aperture"
                                suffix="mm"
                                value={localRadius}
                                onChange={setLocalRadius}
                                onCommit={(v) => commitGeometry('radius', v)}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localThickness}
                                onChange={setLocalThickness}
                                onCommit={(v) => commitGeometry('thickness', v)}
                                speed={0.2}
                                min={0.1}
                                max={100}
                            />
                            <ScrubInput
                                label="IoR"
                                value={localIor}
                                onChange={setLocalIor}
                                onCommit={(v) => commitGeometry('ior', v)}
                                speed={0.005}
                                min={1.0}
                                max={3.0}
                                step={0.001}
                                title="Index of Refraction (1.0 = air, 1.5 = BK7, 1.7 = Lanthanum Crown)"
                            />
                        </div>

                        {/* Surface Radii — scrubbable */}
                        <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
                            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 6 }}>Surface Radii (drag labels ↔ to scrub)</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <ScrubInput
                                    label="R1 (Front)"
                                    suffix="mm"
                                    value={localR1}
                                    onChange={setLocalR1}
                                    onCommit={(v) => commitGeometry('r1', v)}
                                    speed={2.0}
                                    allowInfinity
                                    title="+ = Convex, − = Concave, 'Infinity' = Flat"
                                />
                                <ScrubInput
                                    label="R2 (Back)"
                                    suffix="mm"
                                    value={localR2}
                                    onChange={setLocalR2}
                                    onCommit={(v) => commitGeometry('r2', v)}
                                    speed={2.0}
                                    allowInfinity
                                    title="− = Convex, + = Concave, 'Infinity' = Flat"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Old PrismLens panel removed — unified under isPolygonOptic above */}

                {isAsphericLens && (() => {
                    const updateAsph = (mutate: (a: AsphericLens) => void) => {
                        const newC = components.map(c => {
                            if (c.id === selection[0] && c instanceof AsphericLens) {
                                mutate(c);
                                c.invalidateMesh();
                                return c;
                            }
                            return c;
                        });
                        setComponents([...newC]);
                    };
                    const parseR = (s: string): number => {
                        if (s.toLowerCase() === 'infinity') return 1e9;
                        if (s.toLowerCase() === '-infinity') return -1e9;
                        return parseFloat(s);
                    };
                    const parseFiniteFloat = (s: string): number | null => {
                        const v = parseFloat(s);
                        return isNaN(v) ? null : v;
                    };
                    const commitR = (side: 1 | 2, s: string) => {
                        const v = parseR(s);
                        if (isNaN(v)) return;
                        updateAsph(a => {
                            const minR = a.apertureRadius * 1.05;
                            const clamped = Math.abs(v) < minR && Math.abs(v) < 1e8
                                ? Math.sign(v || 1) * minR : v;
                            if (side === 1) a.r1 = clamped; else a.r2 = clamped;
                        });
                    };
                    const commitK = (side: 1 | 2, s: string) => {
                        const v = parseFiniteFloat(s);
                        if (v === null) return;
                        updateAsph(a => { if (side === 1) a.k1 = v; else a.k2 = v; });
                    };
                    const commitA = (side: 1 | 2, idx: number, s: string) => {
                        const v = parseFiniteFloat(s);
                        if (v === null) return;
                        updateAsph(a => {
                            const arr = side === 1 ? a.A1 : a.A2;
                            while (arr.length <= idx) arr.push(0);
                            arr[idx] = v;
                        });
                    };
                    const addTerm = (side: 1 | 2) => {
                        updateAsph(a => {
                            const arr = side === 1 ? a.A1 : a.A2;
                            if (arr.length < ASPHERE_MAX_TERMS) arr.push(0);
                        });
                        if (side === 1) setLocalAsphA1(prev => [...prev, '0.000e+0']);
                        else setLocalAsphA2(prev => [...prev, '0.000e+0']);
                    };
                    const removeTerm = (side: 1 | 2, idx: number) => {
                        updateAsph(a => {
                            const arr = side === 1 ? a.A1 : a.A2;
                            arr.splice(idx, 1);
                        });
                        if (side === 1) setLocalAsphA1(prev => prev.filter((_, i) => i !== idx));
                        else setLocalAsphA2(prev => prev.filter((_, i) => i !== idx));
                    };
                    const ASPH_LABELS = ['A₄', 'A₆', 'A₈', 'A₁₀', 'A₁₂', 'A₁₄'];
                    const ASPH_UNITS = ['mm⁻³', 'mm⁻⁵', 'mm⁻⁷', 'mm⁻⁹', 'mm⁻¹¹', 'mm⁻¹³'];

                    const SurfaceBlock = ({
                        side, label, R, k, terms,
                        setR, setK,
                    }: {
                        side: 1 | 2; label: string;
                        R: string; k: string; terms: string[];
                        setR: (s: string) => void;
                        setK: (s: string) => void;
                    }) => (
                        <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginTop: 10 }}>
                            <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: 8, fontWeight: 500 }}>
                                {label}
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                                <ScrubInput
                                    label={side === 1 ? 'R₁' : 'R₂'}
                                    suffix="mm"
                                    value={R}
                                    onChange={setR}
                                    onCommit={(v) => commitR(side, v)}
                                    speed={2.0}
                                    allowInfinity
                                    title={side === 1
                                        ? '+ = Convex, − = Concave, Infinity = Flat'
                                        : '− = Convex, + = Concave, Infinity = Flat'}
                                />
                                <ScrubInput
                                    label={side === 1 ? 'k₁ (conic)' : 'k₂ (conic)'}
                                    value={k}
                                    onChange={setK}
                                    onCommit={(v) => commitK(side, v)}
                                    speed={0.005}
                                    step={0.001}
                                    title="0 = sphere, −1 = parabola, < −1 hyperbola, (−1, 0) prolate, > 0 oblate"
                                />
                            </div>
                            {terms.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                                    {terms.map((val, i) => (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'end', gap: 6 }}>
                                            <span style={{ fontSize: '11px', color: '#888', minWidth: 26, paddingBottom: 8 }}>{ASPH_LABELS[i]}</span>
                                            <ScrubInput
                                                label={ASPH_UNITS[i]}
                                                value={val}
                                                onChange={(s) => {
                                                    if (side === 1) setLocalAsphA1(prev => prev.map((p, j) => j === i ? s : p));
                                                    else setLocalAsphA2(prev => prev.map((p, j) => j === i ? s : p));
                                                }}
                                                onCommit={(s) => commitA(side, i, s)}
                                                speed={1e-8}
                                                step={1e-12}
                                                title={`Coefficient on r^${(i + 1) * 2 + 2}`}
                                            />
                                            <button
                                                onClick={() => removeTerm(side, i)}
                                                title="Remove this aspheric term"
                                                style={{
                                                    background: 'transparent',
                                                    border: '1px solid #444',
                                                    color: '#888',
                                                    width: 22, height: 22,
                                                    borderRadius: 4,
                                                    cursor: 'pointer',
                                                    fontSize: 12,
                                                    lineHeight: 1,
                                                    marginBottom: 1,
                                                }}
                                            >−</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {terms.length < ASPHERE_MAX_TERMS && (
                                <button
                                    onClick={() => addTerm(side)}
                                    style={{
                                        background: 'transparent',
                                        border: '1px dashed #444',
                                        color: '#888',
                                        padding: '4px 8px',
                                        width: '100%',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        fontSize: 11,
                                    }}
                                >+ Add {ASPH_LABELS[terms.length]}</button>
                            )}
                        </div>
                    );

                    return (
                        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                            <div style={{ marginBottom: 10 }}>
                                <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Preset</label>
                                <select
                                    value={localAsphPreset}
                                    onChange={(e) => {
                                        const preset = e.target.value as AsphericPreset;
                                        setLocalAsphPreset(preset);
                                        updateAsph(a => a.setFromPreset(preset));
                                    }}
                                    style={{ ...inputStyle, cursor: 'pointer' }}
                                >
                                    <option value="plano-asphere-collimator">Plano-Asphere Collimator</option>
                                    <option value="best-form-asphere">Best-Form Asphere</option>
                                    <option value="biconvex-asphere">Biconvex Asphere</option>
                                    <option value="meniscus-asphere">Meniscus Asphere</option>
                                    <option value="schmidt-corrector">Schmidt Corrector Plate</option>
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 4 }}>
                                <ScrubInput
                                    label="Aperture"
                                    suffix="mm"
                                    value={localAsphAperture}
                                    onChange={setLocalAsphAperture}
                                    onCommit={(v) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val <= 0) return;
                                        updateAsph(a => { a.apertureRadius = val; });
                                    }}
                                    speed={0.5}
                                    min={1}
                                    max={200}
                                />
                                <ScrubInput
                                    label="Thickness"
                                    suffix="mm"
                                    value={localAsphThickness}
                                    onChange={setLocalAsphThickness}
                                    onCommit={(v) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val < 0.1) return;
                                        updateAsph(a => { a.thickness = val; });
                                    }}
                                    speed={0.2}
                                    min={0.1}
                                    max={100}
                                />
                                <ScrubInput
                                    label="IoR"
                                    value={localAsphIor}
                                    onChange={setLocalAsphIor}
                                    onCommit={(v) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val < 1 || val > 3) return;
                                        updateAsph(a => { a.ior = val; });
                                    }}
                                    speed={0.005}
                                    min={1.0}
                                    max={3.0}
                                    step={0.001}
                                    title="Index of refraction"
                                />
                            </div>

                            <SurfaceBlock
                                side={1} label="Front Surface (S₁)"
                                R={localAsphR1} k={localAsphK1} terms={localAsphA1}
                                setR={setLocalAsphR1} setK={setLocalAsphK1}
                            />
                            <SurfaceBlock
                                side={2} label="Back Surface (S₂)"
                                R={localAsphR2} k={localAsphK2} terms={localAsphA2}
                                setR={setLocalAsphR2} setK={setLocalAsphK2}
                            />

                            <div style={{ fontSize: '10px', color: '#555', marginTop: 8, lineHeight: 1.4 }}>
                                z(r) = c·r²/(1+√(1−(1+k)c²r²)) + Σ Aᵢ·r^(2i+2). Conic and aspheric terms vanish at r=0, so paraxial focal length depends only on R₁, R₂ and IoR.
                            </div>
                        </div>
                    );
                })()}

                {isIdealLens && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Phase Surface (Thin Lens)</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Focal Len"
                                suffix="mm"
                                value={localIdealFocal}
                                onChange={setLocalIdealFocal}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val === 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof IdealLens) {
                                            c.focalLength = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1.0}
                                title="Positive = converging, Negative = diverging"
                            />
                            <ScrubInput
                                label="Aperture"
                                suffix="mm"
                                value={localIdealAperture}
                                onChange={setLocalIdealAperture}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof IdealLens) {
                                            c.apertureRadius = val;
                                            c.bounds.set(
                                                new Vector3(-val, -val, -0.01),
                                                new Vector3(val, val, 0.01)
                                            );
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                        </div>
                    </div>
                )}

                {isObjective && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Aplanatic Phase Surface</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Mag"
                                suffix="x"
                                value={localObjMag}
                                onChange={setLocalObjMag}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.setMagnificationPreserveSampleSide(val);
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={200}
                            />
                            <ScrubInput
                                label="NA"
                                suffix=""
                                value={localObjNA}
                                onChange={setLocalObjNA}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.NA = val;
                                            c.recalculate();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.05}
                                min={0.01}
                                max={1.7}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <div>
                                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Immersion Medium</label>
                                <select
                                    value={localObjImmersionKind}
                                    onChange={(e) => {
                                        const kind = e.target.value as Objective['immersionMediumKind'];
                                        setLocalObjImmersionKind(kind);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof Objective) {
                                                c.setImmersionMedium(kind);
                                                setLocalObjImmersion(String(c.immersionIndex));
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{
                                        width: '100%',
                                        background: '#333',
                                        color: '#ccc',
                                        border: '1px solid #555',
                                        borderRadius: 4,
                                        padding: '4px 6px',
                                        fontSize: '12px'
                                    }}
                                >
                                    <option value="air">Air</option>
                                    <option value="water">Water</option>
                                    <option value="oil">Oil</option>
                                    <option value="silicone">Silicone</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>
                            <ScrubInput
                                label="n"
                                value={localObjImmersion}
                                onChange={setLocalObjImmersion}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.immersionIndex = val;
                                            c.immersionMediumKind = 'custom';
                                            c.recalculate();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setLocalObjImmersionKind('custom');
                                    setComponents([...newComponents]);
                                }}
                                speed={0.005}
                                min={1}
                                max={2}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput
                                label="WD"
                                suffix="mm"
                                value={localObjWD}
                                onChange={setLocalObjWD}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.workingDistance = val;
                                            c.recalculate();
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={0.1}
                                max={50}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput
                                label="Barrel ∅"
                                suffix="mm"
                                value={localObjDiameter}
                                onChange={setLocalObjDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.diameter = val;
                                            c.recalculate();
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={50}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput
                                label="Tube Lens"
                                suffix="mm"
                                value={localObjTubeLensFocal}
                                onChange={setLocalObjTubeLensFocal}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.tubeLensFocal = val;
                                            c.recalculate();
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                min={50}
                                max={300}
                            />
                            <ScrubInput
                                label="Coverslip"
                                suffix="mm"
                                value={localObjCoverslipThickness}
                                onChange={setLocalObjCoverslipThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.coverslipThickness = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.01}
                                min={0}
                                max={1}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput
                                label="Field #"
                                suffix="mm"
                                value={localObjFieldNumber}
                                onChange={setLocalObjFieldNumber}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Objective) {
                                            c.fieldNumber = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={0}
                                max={50}
                                title="0 = unlimited usable image circle"
                            />
                            <div style={{
                                border: '1px solid #333',
                                borderRadius: 4,
                                padding: '6px 8px',
                                background: '#1a1a1a',
                                alignSelf: 'end',
                            }}>
                                <div style={{ fontSize: '10px', color: '#666', marginBottom: 2 }}>Pupil</div>
                                <div style={{ fontSize: '11px', color: '#aaa' }}>
                                    {selectedComponent instanceof Objective
                                        ? (selectedComponent.pupil ? 'custom aberration' : 'diffraction-limited')
                                        : '—'}
                                </div>
                            </div>
                        </div>
                        <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
                            <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 8 }}>
                                Pupil Aberration (waves)
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <ScrubInput
                                    label="Ref λ"
                                    suffix="nm"
                                    value={localObjPupilRefNm}
                                    onChange={setLocalObjPupilRefNm}
                                    onCommit={(v: string) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val <= 0) return;
                                        applyObjectivePupilEditor({ refNm: v });
                                    }}
                                    speed={5}
                                    min={350}
                                    max={800}
                                />
                                <ScrubInput
                                    label="Defocus"
                                    suffix=""
                                    value={localObjDefocus}
                                    onChange={setLocalObjDefocus}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ defocus: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                                <ScrubInput
                                    label="Astig 45"
                                    suffix=""
                                    value={localObjAstig45}
                                    onChange={setLocalObjAstig45}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ astig45: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                                <ScrubInput
                                    label="Astig 0"
                                    suffix=""
                                    value={localObjAstig0}
                                    onChange={setLocalObjAstig0}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ astig0: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                                <ScrubInput
                                    label="Coma Y"
                                    suffix=""
                                    value={localObjComaY}
                                    onChange={setLocalObjComaY}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ comaY: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                                <ScrubInput
                                    label="Coma X"
                                    suffix=""
                                    value={localObjComaX}
                                    onChange={setLocalObjComaX}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ comaX: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                                <ScrubInput
                                    label="Spherical"
                                    suffix=""
                                    value={localObjSpherical}
                                    onChange={setLocalObjSpherical}
                                    onCommit={(v: string) => applyObjectivePupilEditor({ spherical: v })}
                                    speed={0.01}
                                    min={-2}
                                    max={2}
                                />
                                <button
                                    onClick={() => {
                                        setLocalObjPupilRefNm('550');
                                        setLocalObjDefocus('0');
                                        setLocalObjAstig45('0');
                                        setLocalObjAstig0('0');
                                        setLocalObjComaY('0');
                                        setLocalObjComaX('0');
                                        setLocalObjSpherical('0');
                                        applyObjectivePupilEditor({
                                            refNm: '550',
                                            defocus: '0',
                                            astig45: '0',
                                            astig0: '0',
                                            comaY: '0',
                                            comaX: '0',
                                            spherical: '0',
                                        });
                                    }}
                                    style={{
                                        background: '#222',
                                        color: '#bbb',
                                        border: '1px solid #444',
                                        borderRadius: 4,
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        padding: '4px 6px',
                                        alignSelf: 'end',
                                    }}
                                    title="Reset objective pupil aberrations to diffraction-limited"
                                >
                                    Clear Pupil
                                </button>
                            </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                            f = {selectedComponent instanceof Objective ? Math.round(selectedComponent.focalLength * 100) / 100 : '—'} mm
                            {' · '}
                            optical ∅ = {selectedComponent instanceof Objective ? Math.round(selectedComponent.apertureRadius * 2 * 100) / 100 : '—'} mm
                            {' · '}
                            pupil R = {selectedComponent instanceof Objective ? Math.round(selectedComponent.pupilRadius * 100) / 100 : '—'} mm
                        </div>
                        <div style={{ marginTop: 4, fontSize: '10px', color: '#555' }}>
                            coverslip = {selectedComponent instanceof Objective ? Math.round(selectedComponent.coverslipThickness * 1000) / 1000 : '—'} mm
                            {' · '}
                            field # = {selectedComponent instanceof Objective
                                ? (selectedComponent.fieldNumber > 0 ? Math.round(selectedComponent.fieldNumber * 100) / 100 : 'unlimited')
                                : '—'}
                        </div>
                        {objectiveScanReadout && (
                            <div style={{
                                marginTop: 10,
                                borderTop: '1px solid #333',
                                paddingTop: 8,
                                display: 'grid',
                                gap: 4,
                            }}>
                                <div style={{ fontSize: '10px', color: '#666' }}>Scan In Objective Opening</div>
                                <div style={{ fontSize: '11px', color: '#bbb' }}>
                                    Beam is {objectiveScanReadout.currentBeamRadiusMm.toFixed(3)} mm from the center of the objective opening.
                                </div>
                                <div style={{ fontSize: '11px', color: '#888' }}>
                                    That uses {objectiveScanReadout.usedPercent.toFixed(1)}% of the opening and leaves {objectiveScanReadout.edgeMarginPercent.toFixed(1)}% margin before clipping.
                                </div>
                                <div style={{ fontSize: '11px', color: '#888' }}>
                                    For a 1.0 mm total scan field at 10×, this relay would need to move the beam about {objectiveScanReadout.requiredPupilShiftMm.toFixed(3)} mm from center.
                                </div>
                                <div style={{ fontSize: '11px', color: '#888' }}>
                                    Largest unclipped scan with the current relay: +/-{objectiveScanReadout.maxHalfAngleDeg.toFixed(3)} deg mechanical per axis.
                                </div>
                                {objectiveScanReadout.sampleOffsetXmm !== null && objectiveScanReadout.sampleOffsetZmm !== null && (
                                    <div style={{ fontSize: '11px', color: '#888' }}>
                                        Current scan spot at sample: x {objectiveScanReadout.sampleOffsetXmm >= 0 ? '+' : ''}{objectiveScanReadout.sampleOffsetXmm.toFixed(3)} mm, z {objectiveScanReadout.sampleOffsetZmm >= 0 ? '+' : ''}{objectiveScanReadout.sampleOffsetZmm.toFixed(3)} mm from sample center.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {isLaser && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        {/* Wavelength Slider */}
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 6 }}>
                                Wavelength: {localWavelength} nm
                                {!isVisibleSpectrum(localWavelength) && <span style={{ color: '#888' }}> (IR/UV)</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="range"
                                    min="300"
                                    max="1400"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof Laser) {
                                                c.wavelength = newWavelength;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    backgroundColor: wavelengthToColor(localWavelength),
                                    border: '1px solid #555'
                                }} />
                            </div>
                        </div>

                        {/* Beam Radius + Power */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Beam Radius"
                                suffix="mm"
                                value={localBeamRadius}
                                onChange={setLocalBeamRadius}
                                onCommit={() => commitLaserParams()}
                                speed={0.5}
                                min={0.1}
                                max={50}
                            />
                            <ScrubInput
                                label="Power"
                                suffix="W"
                                value={localLaserPower}
                                onChange={setLocalLaserPower}
                                onCommit={() => commitLaserParams()}
                                speed={0.1}
                                min={0.01}
                                max={100}
                            />
                        </div>
                    </div>
                )}

                {isLamp && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Lamp Settings (White Light)</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Beam Radius"
                                suffix="mm"
                                value={localBeamRadius}
                                onChange={setLocalBeamRadius}
                                onCommit={() => commitLampParams()}
                                speed={0.5}
                                min={0.1}
                                max={50}
                            />
                            <ScrubInput
                                label="Power"
                                suffix="W"
                                value={localLampPower}
                                onChange={setLocalLampPower}
                                onCommit={() => commitLampParams()}
                                speed={0.1}
                                min={0}
                                max={100}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                            <ScrubInput
                                label="Source Points"
                                suffix=""
                                value={localSourcePointCount}
                                onChange={setLocalSourcePointCount}
                                onCommit={() => commitLampParams()}
                                speed={0.2}
                                min={1}
                                max={32}
                            />
                            <ScrubInput
                                label="Emitter Radius"
                                suffix="mm"
                                value={localEmitterRadius}
                                onChange={setLocalEmitterRadius}
                                onCommit={() => commitLampParams()}
                                speed={0.1}
                                min={0}
                                max={50}
                            />
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: 6 }}>
                            13-band spectrum (340–820 nm)
                        </div>
                    </div>
                )}

                {(isPointSource2D || isPointSource3D) && !isConeSource3D && !isWedgeSource2D && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                            {isPointSource2D ? 'Point Source 2D' : 'Point Source 3D'} Settings
                        </label>

                        {/* Wavelength Slider */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Wavelength: {localWavelength} nm
                                {!isVisibleSpectrum(localWavelength) && <span style={{ color: '#888' }}> (IR/UV)</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="range"
                                    min="300"
                                    max="1400"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof PointSourceBase) {
                                                c.wavelength = newWavelength;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    backgroundColor: wavelengthToColor(localWavelength),
                                    border: '1px solid #555'
                                }} />
                            </div>
                        </div>

                        {/* Power */}
                        <ScrubInput
                            label="Power"
                            suffix="W"
                            value={localLaserPower}
                            onChange={setLocalLaserPower}
                            onCommit={() => commitPointSourceParams()}
                            speed={0.1}
                            min={0.01}
                            max={100}
                        />
                    </div>
                )}

                {isConeSource3D && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Cone Source 3D Settings</label>

                        {/* Wavelength Slider */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Wavelength: {localWavelength} nm
                                {!isVisibleSpectrum(localWavelength) && <span style={{ color: '#888' }}> (IR/UV)</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="range"
                                    min="300"
                                    max="1400"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof ConeSource3D) {
                                                c.wavelength = newWavelength;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    backgroundColor: wavelengthToColor(localWavelength),
                                    border: '1px solid #555'
                                }} />
                            </div>
                        </div>

                        {/* Power + Half Angle */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Power"
                                suffix="W"
                                value={localLaserPower}
                                onChange={setLocalLaserPower}
                                onCommit={() => commitConeSourceParams()}
                                speed={0.1}
                                min={0.01}
                                max={100}
                            />
                            <ScrubInput
                                label="Half Angle"
                                suffix="°"
                                value={localHalfAngle}
                                onChange={setLocalHalfAngle}
                                onCommit={() => commitConeSourceParams()}
                                speed={1}
                                min={1}
                                max={90}
                            />
                        </div>
                    </div>
                )}

                {isWedgeSource2D && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Wedge Source 2D Settings</label>

                        {/* Wavelength Slider */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Wavelength: {localWavelength} nm
                                {!isVisibleSpectrum(localWavelength) && <span style={{ color: '#888' }}> (IR/UV)</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="range"
                                    min="300"
                                    max="1400"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof WedgeSource2D) {
                                                c.wavelength = newWavelength;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    backgroundColor: wavelengthToColor(localWavelength),
                                    border: '1px solid #555'
                                }} />
                            </div>
                        </div>

                        {/* Power + Subtended Angle */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Power"
                                suffix="W"
                                value={localLaserPower}
                                onChange={setLocalLaserPower}
                                onCommit={() => commitWedgeSourceParams()}
                                speed={0.1}
                                min={0.01}
                                max={100}
                            />
                            <ScrubInput
                                label="Subtended Angle"
                                suffix="°"
                                value={localSubtendedAngle}
                                onChange={setLocalSubtendedAngle}
                                onCommit={() => commitWedgeSourceParams()}
                                speed={1}
                                min={1}
                                max={360}
                            />
                        </div>
                    </div>
                )}

                {isStructuredSource && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Structured Source Settings</label>

                        {/* Wavelength Slider */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Wavelength: {localWavelength} nm
                                {!isVisibleSpectrum(localWavelength) && <span style={{ color: '#888' }}> (IR/UV)</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="range"
                                    min="300"
                                    max="1400"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof StructuredSource) {
                                                c.wavelength = newWavelength;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    backgroundColor: wavelengthToColor(localWavelength),
                                    border: '1px solid #555'
                                }} />
                            </div>
                        </div>

                        {/* Beam Radius + Power */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                            <ScrubInput
                                label="Beam Radius"
                                suffix="mm"
                                value={localBeamRadius}
                                onChange={setLocalBeamRadius}
                                onCommit={() => commitStructuredSourceParams()}
                                speed={0.5}
                                min={0.1}
                                max={50}
                            />
                            <ScrubInput
                                label="Power"
                                suffix="W"
                                value={localLaserPower}
                                onChange={setLocalLaserPower}
                                onCommit={() => commitStructuredSourceParams()}
                                speed={0.1}
                                min={0.01}
                                max={100}
                            />
                        </div>

                        {/* ASCII Character */}
                        <div>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                ASCII Character
                            </label>
                            <input
                                type="text"
                                maxLength={1}
                                value={localAsciiChar}
                                onChange={(e) => {
                                    setLocalAsciiChar(e.target.value);
                                }}
                                onBlur={() => commitStructuredSourceParams()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitStructuredSourceParams();
                                }}
                                style={{
                                    width: 40,
                                    textAlign: 'center',
                                    fontSize: '18px',
                                    fontFamily: 'monospace',
                                    background: '#333',
                                    color: '#fff',
                                    border: '1px solid #555',
                                    borderRadius: 4,
                                    padding: '4px',
                                }}
                            />
                        </div>
                    </div>
                )}

                {isFaradayIsolator && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Faraday Isolator Settings</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Insertion Loss"
                                suffix=""
                                value={localInsertionLoss}
                                onChange={setLocalInsertionLoss}
                                onCommit={() => commitFaradayParams()}
                                speed={0.01}
                                min={0}
                                max={1}
                            />
                            <ScrubInput
                                label="Extinction"
                                suffix="dB"
                                value={localExtinctionDB}
                                onChange={setLocalExtinctionDB}
                                onCommit={() => commitFaradayParams()}
                                speed={1}
                                min={10}
                                max={60}
                            />
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: 6 }}>
                            Forward: {(parseFloat(localInsertionLoss) * 100).toFixed(0)}% transmission · Reverse: {parseFloat(localExtinctionDB)}dB isolation
                        </div>
                    </div>
                )}

                {isQPD && (() => {
                    const qpd = selectedComponent as QPD;
                    const qpdPanelStyle: React.CSSProperties = isMobile
                        ? {
                            gridColumn: '1 / -1',
                            marginTop: 0,
                            borderTop: '1px solid #444',
                            paddingTop: 10,
                        }
                        : { marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 };
                    const qpdContentStyle: React.CSSProperties | undefined = isMobile
                        ? {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                            gap: '10px 14px',
                            alignItems: 'start',
                        }
                        : undefined;
                    return (
                        <div style={qpdPanelStyle}>
                            <div style={qpdContentStyle}>
                                <div style={{ minWidth: 0 }}>
                                    <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>QPD Settings</label>
                                    <ScrubInput
                                        label="Active Diameter"
                                        suffix="mm"
                                        value={localQPDDiameter}
                                        onChange={setLocalQPDDiameter}
                                        onCommit={() => commitQPDParams()}
                                        speed={0.5}
                                        min={0.5}
                                        max={25}
                                    />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: isMobile ? 0 : 10, marginBottom: 4 }}>
                                        <span style={{ fontSize: '11px', color: '#aaa' }}>QPD Readout</span>
                                        {!isMobile && (
                                            <button
                                                onClick={() => {
                                                    const next = new Set(pinnedIds);
                                                    if (pinnedIds.has(qpd.id)) next.delete(qpd.id);
                                                    else next.add(qpd.id);
                                                    setPinnedIds(next);
                                                }}
                                                title={pinnedIds.has(qpd.id) ? 'Unpin viewer' : 'Pin viewer'}
                                                style={{
                                                    background: pinnedIds.has(qpd.id) ? '#333' : 'none',
                                                    border: pinnedIds.has(qpd.id) ? '1px solid #555' : '1px solid #444',
                                                    borderRadius: '3px',
                                                    color: pinnedIds.has(qpd.id) ? '#fff' : '#888',
                                                    cursor: 'pointer',
                                                    fontSize: '11px',
                                                    padding: '1px 5px',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                📌
                                            </button>
                                        )}
                                    </div>
                                    <QPDViewer qpd={qpd} compact={isMobile} />
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {isAOD && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>AOD Settings</label>

                        {/* Deflection angle slider — primary control */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Deflection: {localDeflectionAngle} mrad
                            </label>
                            <input
                                type="range"
                                min={-parseFloat(localAODMaxAngle)}
                                max={parseFloat(localAODMaxAngle)}
                                step="0.1"
                                value={parseFloat(localDeflectionAngle) || 0}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setLocalDeflectionAngle(val);
                                    const mrad = parseFloat(val);
                                    if (!isNaN(mrad)) {
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof AOD) {
                                                c.deflectionAngle = mrad / 1000;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Efficiency"
                                suffix=""
                                value={localAODEfficiency}
                                onChange={setLocalAODEfficiency}
                                onCommit={() => commitAODParams()}
                                speed={0.01}
                                min={0}
                                max={1}
                            />
                            <ScrubInput
                                label="Max Angle"
                                suffix="mrad"
                                value={localAODMaxAngle}
                                onChange={setLocalAODMaxAngle}
                                onCommit={() => commitAODParams()}
                                speed={1}
                                min={1}
                                max={200}
                            />
                        </div>
                    </div>
                )}

                {isWaveplate && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Waveplate Settings</label>
                        <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>
                                Mode: {(selectedComponent as Waveplate).waveplateMode === 'half' ? 'λ/2 Plate' :
                                    (selectedComponent as Waveplate).waveplateMode === 'quarter' ? 'λ/4 Plate' : 'Linear Polarizer'}
                            </label>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 6 }}>
                                Fast Axis: {Math.round((selectedComponent as Waveplate).fastAxisAngle * 180 / Math.PI)}°
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="180"
                                step="1"
                                value={Math.round((selectedComponent as Waveplate).fastAxisAngle * 180 / Math.PI)}
                                onChange={(e) => {
                                    const newAngle = parseInt(e.target.value) * Math.PI / 180;
                                    if (selectedComponent instanceof Waveplate) {
                                        selectedComponent.fastAxisAngle = newAngle;
                                        selectedComponent.version++;
                                        setComponents([...components]);
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                )}

                {isPupilMask && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Pupil Mask</label>
                        <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Mode</label>
                            <select
                                value={localPupilMaskMode}
                                onChange={(e) => {
                                    const mode = e.target.value as 'uniform' | 'annulus' | 'phaseRing';
                                    setLocalPupilMaskMode(mode);
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.mode = mode;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                style={{ ...inputStyle, cursor: 'pointer' }}
                            >
                                <option value="uniform">Uniform</option>
                                <option value="annulus">Annulus</option>
                                <option value="phaseRing">Phase Ring</option>
                            </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput label="Radius" suffix="mm" value={localPupilMaskRadius} onChange={setLocalPupilMaskRadius}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.radius = val;
                                            c.updateBounds();
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.2} min={0.1} max={100} />
                            <ScrubInput label="Res" suffix="" value={localPupilMaskResolution} onChange={setLocalPupilMaskResolution}
                                onCommit={(v: string) => {
                                    const val = Math.round(parseFloat(v));
                                    if (!Number.isFinite(val) || val < 8) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.resolution = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={1} min={8} max={256} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="Inner ρ" suffix="" value={localPupilMaskInner} onChange={setLocalPupilMaskInner}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0 || val > 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.innerRadius = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.01} min={0} max={1} />
                            <ScrubInput label="Outer ρ" suffix="" value={localPupilMaskOuter} onChange={setLocalPupilMaskOuter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0 || val > 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.outerRadius = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.01} min={0} max={1} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="Ring T" suffix="" value={localPupilMaskRingTransmission} onChange={setLocalPupilMaskRingTransmission}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0 || val > 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.ringTransmission = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.01} min={0} max={1} />
                            <ScrubInput label="Ring φ" suffix="rad" value={localPupilMaskRingPhase} onChange={setLocalPupilMaskRingPhase}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.ringPhaseShift = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.05} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="Bg T" suffix="" value={localPupilMaskBackgroundTransmission} onChange={setLocalPupilMaskBackgroundTransmission}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0 || val > 1) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.backgroundTransmission = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.01} min={0} max={1} />
                            <ScrubInput label="Bg φ" suffix="rad" value={localPupilMaskBackgroundPhase} onChange={setLocalPupilMaskBackgroundPhase}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PupilMaskElement) {
                                            c.backgroundPhaseShift = val;
                                            c.rebuildMask();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.05} />
                        </div>
                    </div>
                )}

                {isMediumVolume && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Medium Volume</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            <ScrubInput label="W" suffix="mm" value={localMediumWidth} onChange={setLocalMediumWidth}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof MediumVolume) {
                                            c.width = val;
                                            c.updateBounds();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.5} min={0.1} max={200} />
                            <ScrubInput label="H" suffix="mm" value={localMediumHeight} onChange={setLocalMediumHeight}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof MediumVolume) {
                                            c.height = val;
                                            c.updateBounds();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.5} min={0.1} max={200} />
                            <ScrubInput label="D" suffix="mm" value={localMediumDepth} onChange={setLocalMediumDepth}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof MediumVolume) {
                                            c.depth = val;
                                            c.updateBounds();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.5} min={0.1} max={200} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <ScrubInput label="n inside" suffix="" value={localMediumIndex} onChange={setLocalMediumIndex}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1 || val > 3) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof MediumVolume) {
                                            c.refractiveIndex = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.005} min={1} max={3} step={0.001} />
                            <ScrubInput label="n outside" suffix="" value={localMediumExteriorIndex} onChange={setLocalMediumExteriorIndex}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1 || val > 3) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof MediumVolume) {
                                            c.exteriorRefractiveIndex = val;
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }} speed={0.005} min={1} max={3} step={0.001} />
                        </div>
                    </div>
                )}

                {isAperture && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Aperture / Iris</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Opening ∅"
                                suffix="mm"
                                value={localApertureDiameter}
                                onChange={setLocalApertureDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Aperture) {
                                            c.openingDiameter = Math.max(0, Math.min(val, c.housingDiameter - 1));
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={0}
                                max={24}
                                title="Opening diameter of the iris aperture"
                            />
                            <ScrubInput
                                label="Thickness"
                                suffix="mm"
                                value={localApertureThickness}
                                onChange={setLocalApertureThickness}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Aperture) {
                                            c.thickness = Math.max(0.1, Math.min(val, 100));
                                            c.updateBounds();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={0.1}
                                max={100}
                                title="Body length along the optical axis. Larger values make a tube stop."
                            />
                        </div>
                    </div>
                )}

                {isSlitAperture && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Slit Aperture</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Slit Width"
                                suffix="mm"
                                value={localSlitWidth}
                                onChange={setLocalSlitWidth}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof SlitAperture) {
                                            c.slitWidth = Math.max(0, Math.min(val, c.housingDiameter - 1));
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.3}
                                min={0}
                                max={24}
                                title="Width of the slit opening"
                            />
                            <ScrubInput
                                label="Rotation"
                                suffix="°"
                                value={localSlitRotation}
                                onChange={setLocalSlitRotation}
                                onCommit={(v: string) => {
                                    const deg = parseFloat(v);
                                    if (isNaN(deg)) return;
                                    const rad = deg * Math.PI / 180;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof SlitAperture) {
                                            // Rotate around the slit's optical axis = roll about local +Z.
                                            // Using rollAngle keeps the scalar (pan, tilt, roll) state in
                                            // sync with the quaternion so subsequent edits in the general
                                            // rotation panel don't silently discard the slit orientation.
                                            c.rollAngle = rad;
                                            c.recomputeRotation();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                title="Rotation of the slit around the optical axis"
                            />
                        </div>
                    </div>
                )}



                {isAnnotation && selectedComponent instanceof Annotation && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Annotation</label>
                        <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: 4 }}>Text</label>
                            <input
                                type="text"
                                value={selectedComponent.text}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Annotation) {
                                            c.text = value;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #444',
                                    borderRadius: 4,
                                    color: '#ddd',
                                    fontSize: 12,
                                }}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                            {selectedComponent.kind !== 'text' && (
                                <div>
                                    <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: 4 }}>Length (mm)</label>
                                    <input
                                        type="number"
                                        value={selectedComponent.length}
                                        min={5}
                                        max={500}
                                        step={1}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            if (!Number.isFinite(v) || v <= 0) return;
                                            const newComponents = components.map(c => {
                                                if (c.id === selection[0] && c instanceof Annotation) {
                                                    c.length = v;
                                                    c.version++;
                                                }
                                                return c;
                                            });
                                            setComponents([...newComponents]);
                                        }}
                                        style={{
                                            width: '100%', padding: '6px 8px', backgroundColor: '#1a1a1a',
                                            border: '1px solid #444', borderRadius: 4, color: '#ddd', fontSize: 12,
                                        }}
                                    />
                                </div>
                            )}
                            <div>
                                <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: 4 }}>Font Size (px)</label>
                                <input
                                    type="number"
                                    value={selectedComponent.fontSize}
                                    min={2}
                                    max={80}
                                    step={1}
                                    onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        if (!Number.isFinite(v) || v <= 0) return;
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof Annotation) {
                                                c.fontSize = v;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{
                                        width: '100%', padding: '6px 8px', backgroundColor: '#1a1a1a',
                                        border: '1px solid #444', borderRadius: 4, color: '#ddd', fontSize: 12,
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: 4 }}>Color</label>
                                <input
                                    type="color"
                                    value={selectedComponent.color}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof Annotation) {
                                                c.color = value;
                                                c.version++;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{
                                        width: '100%', height: 28, padding: 0, backgroundColor: '#1a1a1a',
                                        border: '1px solid #444', borderRadius: 4, cursor: 'pointer',
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {isDoubleSlit && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Double Slit Settings</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Slit Width"
                                suffix="mm"
                                value={localDoubleSlitWidth}
                                onChange={setLocalDoubleSlitWidth}
                                onCommit={() => {
                                    const w = parseFloat(localDoubleSlitWidth);
                                    if (isNaN(w) || w <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof DoubleSlit) {
                                            c.slitWidth = w;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.05}
                                min={0.01}
                                max={10}
                            />
                            <ScrubInput
                                label="Separation"
                                suffix="mm"
                                value={localDoubleSlitSep}
                                onChange={setLocalDoubleSlitSep}
                                onCommit={() => {
                                    const s = parseFloat(localDoubleSlitSep);
                                    if (isNaN(s) || s <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof DoubleSlit) {
                                            c.slitSeparation = s;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.1}
                                min={0.1}
                                max={20}
                            />
                        </div>
                    </div>
                )}

                {isDiffuser && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Diffuser Settings</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Diameter"
                                suffix="mm"
                                value={localDiffuserDiameter}
                                onChange={setLocalDiffuserDiameter}
                                onCommit={() => {
                                    const diameter = parseFloat(localDiffuserDiameter);
                                    if (isNaN(diameter) || diameter <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Diffuser) {
                                            c.diameter = diameter;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={100}
                            />
                            <ScrubInput
                                label="Cone Angle"
                                suffix="°"
                                value={localDiffuserConeAngle}
                                onChange={setLocalDiffuserConeAngle}
                                onCommit={() => {
                                    const angleDeg = parseFloat(localDiffuserConeAngle);
                                    if (isNaN(angleDeg) || angleDeg <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Diffuser) {
                                            c.coneHalfAngle = angleDeg * Math.PI / 180;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                min={1}
                                max={90}
                            />
                        </div>
                    </div>
                )}

                {hasSpectralProfile && (() => {
                    const comp = selectedComponent as (Filter | DichroicMirror);
                    const profile = comp.spectralProfile;

                    const commitSpectral = (overrideBands?: { center: string; width: string }[]) => {
                        const cutoff = parseFloat(localSpectralCutoff) || 500;
                        const center = parseFloat(localSpectralCenter) || 525;
                        const width = parseFloat(localSpectralWidth) || 50;
                        const steep = parseFloat(localSpectralSteepness) || 15;

                        let bands: { center: number; width: number }[];
                        if (localSpectralPreset === 'multiband') {
                            const src = overrideBands || localBands;
                            bands = src.map(b => ({
                                center: parseFloat(b.center) || 525,
                                width: parseFloat(b.width) || 50
                            }));
                        } else if (localSpectralPreset === 'bandpass') {
                            bands = [{ center, width }];
                        } else {
                            bands = profile.bands;
                        }

                        const newProfile = new SpectralProfile(
                            localSpectralPreset,
                            cutoff,
                            bands,
                            steep
                        );
                        const newComponents = components.map(c => {
                            if (c.id === selection[0]) {
                                if (c instanceof Filter) { c.spectralProfile = newProfile; c.version++; }
                                if (c instanceof DichroicMirror) { c.spectralProfile = newProfile; c.version++; }
                                return c;
                            }
                            return c;
                        });
                        setComponents([...newComponents]);
                    };

                    return (
                        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                                <ScrubInput
                                    label="Diameter"
                                    suffix="mm"
                                    value={localMirrorDiameter}
                                    onChange={setLocalMirrorDiameter}
                                    onCommit={(v: string) => {
                                        const val = parseFloat(v);
                                        if (isNaN(val) || val <= 0) return;
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0]) {
                                                if (c instanceof Filter || c instanceof DichroicMirror) {
                                                    c.diameter = val;
                                                    c.version++;
                                                }
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    speed={0.5}
                                    min={5}
                                    max={200}
                                />
                            </div>

                            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                                {isDichroic ? 'Dichroic Spectrum' : 'Filter Spectrum'}: {profile.getLabel()}
                            </label>

                            {/* Chroma-style Transmission Chart — canvas-based for smooth scrubbing */}
                            <div style={{ marginBottom: 10 }}>
                                <SpectrumChart profile={profile} width={250} height={100} />
                            </div>

                            {/* Preset Selector */}
                            <div style={{ marginBottom: 8 }}>
                                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Type</label>
                                <select
                                    value={localSpectralPreset}
                                    onChange={(e) => {
                                        const preset = e.target.value as ProfilePreset;
                                        setLocalSpectralPreset(preset);
                                        const cutoff = parseFloat(localSpectralCutoff) || 500;
                                        const center = parseFloat(localSpectralCenter) || 525;
                                        const width = parseFloat(localSpectralWidth) || 50;
                                        const steep = parseFloat(localSpectralSteepness) || 15;
                                        const currentBands = localBands.map(b => ({
                                            center: parseFloat(b.center) || 525,
                                            width: parseFloat(b.width) || 50
                                        }));
                                        const newProfile = new SpectralProfile(
                                            preset, cutoff,
                                            preset === 'bandpass' ? [{ center, width }] :
                                            preset === 'multiband' ? (currentBands.length > 0 ? currentBands : [{ center, width }]) :
                                            profile.bands,
                                            steep
                                        );
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0]) {
                                                if (c instanceof Filter) { c.spectralProfile = newProfile; c.version++; }
                                                if (c instanceof DichroicMirror) { c.spectralProfile = newProfile; c.version++; }
                                                return c;
                                            }
                                            return c;
                                        });
                                        setComponents([...newComponents]);
                                    }}
                                    style={{
                                        width: '100%', background: '#333', color: '#ccc',
                                        border: '1px solid #555', borderRadius: 4,
                                        padding: '4px 6px', fontSize: '12px'
                                    }}
                                >
                                    <option value="longpass">Longpass</option>
                                    <option value="shortpass">Shortpass</option>
                                    <option value="bandpass">Bandpass</option>
                                    <option value="multiband">Multiband</option>
                                </select>
                            </div>

                            {/* Conditional inputs */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                {(localSpectralPreset === 'longpass' || localSpectralPreset === 'shortpass') && (
                                    <ScrubInput
                                        label="Cutoff"
                                        suffix="nm"
                                        value={localSpectralCutoff}
                                        onChange={setLocalSpectralCutoff}
                                        onCommit={() => commitSpectral()}
                                        speed={2}
                                        min={350}
                                        max={850}
                                    />
                                )}
                                {localSpectralPreset === 'bandpass' && (
                                    <>
                                        <ScrubInput
                                            label="Center"
                                            suffix="nm"
                                            value={localSpectralCenter}
                                            onChange={setLocalSpectralCenter}
                                            onCommit={() => commitSpectral()}
                                            speed={2}
                                            min={350}
                                            max={850}
                                        />
                                        <ScrubInput
                                            label="Width"
                                            suffix="nm"
                                            value={localSpectralWidth}
                                            onChange={setLocalSpectralWidth}
                                            onCommit={() => commitSpectral()}
                                            speed={1}
                                            min={5}
                                            max={300}
                                        />
                                    </>
                                )}
                            </div>
                            {/* Multiband: per-band editors */}
                            {localSpectralPreset === 'multiband' && (
                                <div style={{ marginTop: 8 }}>
                                    {localBands.map((band, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            marginBottom: 6, padding: '4px 6px',
                                            background: '#2a2a2a', borderRadius: 4, border: '1px solid #444'
                                        }}>
                                            <span style={{ fontSize: '10px', color: '#888', minWidth: 12 }}>#{idx + 1}</span>
                                            <ScrubInput
                                                label="λ"
                                                suffix="nm"
                                                value={band.center}
                                                onChange={(v: string) => {
                                                    const updated = [...localBands];
                                                    updated[idx] = { ...updated[idx], center: v };
                                                    setLocalBands(updated);
                                                }}
                                                onCommit={(v: string) => {
                                                    const updated = [...localBands];
                                                    updated[idx] = { ...updated[idx], center: v };
                                                    setLocalBands(updated);
                                                    commitSpectral(updated);
                                                }}
                                                speed={2}
                                                min={350}
                                                max={850}
                                            />
                                            <ScrubInput
                                                label="W"
                                                suffix="nm"
                                                value={band.width}
                                                onChange={(v: string) => {
                                                    const updated = [...localBands];
                                                    updated[idx] = { ...updated[idx], width: v };
                                                    setLocalBands(updated);
                                                }}
                                                onCommit={(v: string) => {
                                                    const updated = [...localBands];
                                                    updated[idx] = { ...updated[idx], width: v };
                                                    setLocalBands(updated);
                                                    commitSpectral(updated);
                                                }}
                                                speed={1}
                                                min={5}
                                                max={300}
                                            />
                                            {localBands.length > 1 && (
                                                <button
                                                    onClick={() => {
                                                        const updated = localBands.filter((_, i) => i !== idx);
                                                        setLocalBands(updated);
                                                        commitSpectral(updated);
                                                    }}
                                                    style={{
                                                        background: 'none', border: 'none', color: '#f55',
                                                        cursor: 'pointer', fontSize: '14px', padding: '0 2px',
                                                        lineHeight: 1
                                                    }}
                                                    title="Remove band"
                                                >×</button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => {
                                            const updated = [...localBands, { center: '600', width: '40' }];
                                            setLocalBands(updated);
                                            commitSpectral(updated);
                                        }}
                                        style={{
                                            width: '100%', padding: '4px 8px', marginTop: 2,
                                            background: '#2a3a2a', border: '1px solid #4a6a4a',
                                            borderRadius: 4, color: '#8c8', cursor: 'pointer',
                                            fontSize: '11px'
                                        }}
                                    >+ Add Band</button>
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: localSpectralPreset === 'multiband' ? 8 : 0 }}>
                                <ScrubInput
                                    label="Edge"
                                    suffix="nm"
                                    value={localSpectralSteepness}
                                    onChange={setLocalSpectralSteepness}
                                    onCommit={() => commitSpectral()}
                                    speed={0.5}
                                    min={1}
                                    max={50}
                                    title="Edge steepness — smaller = sharper transition"
                                />
                            </div>
                        </div>
                    );
                })()}

                {/* ── Zoom Viewer pin (works for Sample + SampleChamber) ── */}
                {isSample && selectedComponent && (() => {
                    const id = selectedComponent.id;
                    const isPinned = pinnedIds.has(id);
                    return (
                        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '11px', color: '#aaa' }}>Zoom Viewer</span>
                            <button
                                onClick={() => {
                                    const next = new Set(pinnedIds);
                                    if (isPinned) next.delete(id);
                                    else next.add(id);
                                    setPinnedIds(next);
                                }}
                                title={isPinned ? 'Unpin sample zoom viewer' : 'Pin a 3D zoom viewer that shows rays hitting and exiting the sample in real time'}
                                style={{
                                    background: isPinned ? '#333' : 'none',
                                    border: isPinned ? '1px solid #555' : '1px solid #444',
                                    borderRadius: 3,
                                    color: isPinned ? '#fff' : '#888',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    padding: '1px 6px',
                                    lineHeight: 1.2,
                                }}
                            >
                                📌 {isPinned ? 'Pinned' : 'Pin'}
                            </button>
                        </div>
                    );
                })()}

                {/* ── Specimen Orientation & Offset ── */}
                {isSample && (() => {
                    const commitSpecimenRotation = (axis: 'x' | 'y' | 'z', v: string) => {
                        const deg = parseFloat(v);
                        if (isNaN(deg)) return;
                        const rad = deg * Math.PI / 180;
                        const newComponents = components.map(c => {
                            if (c.id === selection[0] && c instanceof Sample) {
                                c.specimenRotation[axis] = rad;
                                c.version++;
                                return c;
                            }
                            return c;
                        });
                        setComponents([...newComponents]);
                    };
                    const commitSpecimenOffset = (axis: 'x' | 'y' | 'z', v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val)) return;
                        const clamped = Math.max(-5, Math.min(5, val));
                        const newComponents = components.map(c => {
                            if (c.id === selection[0] && c instanceof Sample) {
                                c.specimenOffset[axis] = clamped;
                                c.version++;
                                return c;
                            }
                            return c;
                        });
                        setComponents([...newComponents]);
                    };
                    return (
                        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Specimen Orientation</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                <ScrubInput label="Rx" suffix="°" value={localSpecRotX} onChange={setLocalSpecRotX} onCommit={(v: string) => commitSpecimenRotation('x', v)} speed={1} step={1} />
                                <ScrubInput label="Ry" suffix="°" value={localSpecRotY} onChange={setLocalSpecRotY} onCommit={(v: string) => commitSpecimenRotation('y', v)} speed={1} step={1} />
                                <ScrubInput label="Rz" suffix="°" value={localSpecRotZ} onChange={setLocalSpecRotZ} onCommit={(v: string) => commitSpecimenRotation('z', v)} speed={1} step={1} />
                            </div>
                            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8, marginTop: 10 }}>Specimen Offset</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                <ScrubInput label="dX" suffix="mm" value={localSpecOffX} onChange={setLocalSpecOffX} onCommit={(v: string) => commitSpecimenOffset('x', v)} speed={0.05} step={0.01} min={-5} max={5} />
                                <ScrubInput label="dY" suffix="mm" value={localSpecOffY} onChange={setLocalSpecOffY} onCommit={(v: string) => commitSpecimenOffset('y', v)} speed={0.05} step={0.01} min={-5} max={5} />
                                <ScrubInput label="dZ" suffix="mm" value={localSpecOffZ} onChange={setLocalSpecOffZ} onCommit={(v: string) => commitSpecimenOffset('z', v)} speed={0.05} step={0.01} min={-5} max={5} />
                            </div>
                        </div>
                    );
                })()}

                {selectedComponent instanceof SampleChamber && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>
                            Holder Cavity Medium
                        </label>
                        <div style={{ marginBottom: 6 }}>
                            <ScrubInput
                                label="n"
                                value={localChamberFillMediumIndex}
                                onChange={setLocalChamberFillMediumIndex}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val)) return;
                                    const clamped = clampValue(val, 1, 2);
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof SampleChamber) {
                                            c.fillMediumIndex = clamped;
                                            c.version++;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.005}
                                min={1}
                                max={2}
                                title="Refractive index of the medium filling the sample-holder cavity"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {MEDIUM_INDEX_PRESETS.map((preset) => {
                                const active = Math.abs(selectedComponent.fillMediumIndex - preset.value) < 5e-4;
                                return (
                                    <button
                                        key={preset.label}
                                        onClick={() => {
                                            setLocalChamberFillMediumIndex(String(preset.value));
                                            const newComponents = components.map(c => {
                                                if (c.id === selection[0] && c instanceof SampleChamber) {
                                                    c.fillMediumIndex = preset.value;
                                                    c.version++;
                                                }
                                                return c;
                                            });
                                            setComponents([...newComponents]);
                                        }}
                                        style={{
                                            padding: '2px 8px',
                                            background: active ? '#24415c' : '#1a1a1a',
                                            border: active ? '1px solid #4af' : '1px solid #444',
                                            borderRadius: '999px',
                                            color: active ? '#d7ecff' : '#888',
                                            cursor: 'pointer',
                                            fontSize: '10px',
                                            transition: 'all 0.2s',
                                        }}
                                        title={`Set chamber cavity medium to n=${preset.value}`}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Piezo Scan — for Sample and SampleChamber ── */}
                {isSample && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Piezo Scan</label>
                        {(() => {
                            const piezoProps = ['specimenOffset.x', 'specimenOffset.y', 'specimenOffset.z'];
                            const activeChannel = animator.channels.find(ch => ch.targetId === selectedComponent.id && piezoProps.includes(ch.property));
                            const isScanning = !!activeChannel;
                            const saved = piezoSettings.get(selectedComponent.id);
                            const axisLabels: Record<string, string> = { 'specimenOffset.x': 'dX', 'specimenOffset.y': 'dY', 'specimenOffset.z': 'dZ' };
                            const currentProp = activeChannel?.property ?? (saved?.axis === 'dY' ? 'specimenOffset.y' : saved?.axis === 'dZ' ? 'specimenOffset.z' : 'specimenOffset.x');
                            const currentAxisLabel = axisLabels[currentProp] ?? 'dX';
                            const currentHalfMm = isScanning
                                ? Math.round((activeChannel!.to - activeChannel!.from) / 2 * 1000) / 1000
                                : (saved?.halfMm ?? 1);

                            return (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '10px', color: '#888', minWidth: '30px' }}>Axis</span>
                                        <select
                                            value={currentAxisLabel}
                                            onChange={e => {
                                                const label = e.target.value;
                                                const prop = label === 'dY' ? 'specimenOffset.y' : label === 'dZ' ? 'specimenOffset.z' : 'specimenOffset.x';
                                                if (isScanning) {
                                                    const oldPeriodMs = activeChannel!.periodMs;
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    const comp = selectedComponent as Sample;
                                                    const axis = prop.split('.')[1] as 'x' | 'y' | 'z';
                                                    const center = comp.specimenOffset[axis];
                                                    const halfMm = currentHalfMm;
                                                    animator.addChannel({
                                                        id: generateChannelId(),
                                                        targetId: selectedComponent.id,
                                                        property: prop,
                                                        from: center - halfMm,
                                                        to: center + halfMm,
                                                        easing: 'sinusoidal',
                                                        periodMs: oldPeriodMs,
                                                        repeat: true,
                                                        restoreValue: center,
                                                    });
                                                    setAnimPlaying(true);
                                                    setChannelVersion(v => v + 1);
                                                } else {
                                                    setPiezoSettings(prev => {
                                                        const next = new Map(prev);
                                                        next.set(selectedComponent.id, {
                                                            halfMm: saved?.halfMm ?? currentHalfMm,
                                                            periodMs: saved?.periodMs ?? 2000,
                                                            axis: label,
                                                        });
                                                        return next;
                                                    });
                                                }
                                            }}
                                            style={{
                                                background: '#222', color: '#ccc', border: '1px solid #555',
                                                borderRadius: '3px', fontSize: '10px', padding: '2px 4px', cursor: 'pointer',
                                            }}
                                        >
                                            <option value="dX">dX (left–right)</option>
                                            <option value="dY">dY (up–down)</option>
                                            <option value="dZ">dZ (in–out)</option>
                                        </select>
                                        <span style={{ fontSize: '10px', color: '#888', marginLeft: '6px', minWidth: '18px' }}>±</span>
                                        <input
                                            type="number"
                                            value={localPiezoHalfMm}
                                            key={activeChannel?.id ?? `piezo-idle-${selectedComponent.id}`}
                                            min={0.01}
                                            max={5}
                                            step={0.1}
                                            onChange={e => {
                                                setLocalPiezoHalfMm(e.target.value);
                                                if (isScanning) {
                                                    const halfMm = parseFloat(e.target.value);
                                                    if (isNaN(halfMm) || halfMm <= 0) return;
                                                    const center = activeChannel!.restoreValue ?? (activeChannel!.from + activeChannel!.to) / 2;
                                                    activeChannel!.from = center - halfMm;
                                                    activeChannel!.to = center + halfMm;
                                                }
                                            }}
                                            style={{
                                                width: '48px', background: '#222', color: '#ccc', border: '1px solid #555',
                                                borderRadius: '3px', fontSize: '10px', padding: '2px 4px', textAlign: 'center',
                                            }}
                                        />
                                        <span style={{ fontSize: '10px', color: '#888' }}>mm</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <button
                                            onClick={() => {
                                                if (isScanning) {
                                                    const halfMm = Math.round((activeChannel!.to - activeChannel!.from) / 2 * 1000) / 1000;
                                                    const periodMs = activeChannel!.periodMs;
                                                    setPiezoSettings(prev => new Map(prev).set(selectedComponent.id, { halfMm, periodMs, axis: currentAxisLabel }));
                                                    setLocalPiezoHalfMm(String(halfMm));
                                                    setLocalPiezoHz(String(Math.round(1000 / periodMs * 10) / 10));
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    if (animator.channels.length === 0) setAnimPlaying(false);
                                                    setChannelVersion(v => v + 1);
                                                } else {
                                                    const comp = selectedComponent as (Sample | SampleChamber);
                                                    const axis = currentProp.split('.')[1] as 'x' | 'y' | 'z';
                                                    const center = comp.specimenOffset[axis];
                                                    const halfMm = parseFloat(localPiezoHalfMm) || 1;
                                                    const hz = parseFloat(localPiezoHz) || 0.5;
                                                    const periodMs = 1000 / hz;
                                                    const ch: AnimationChannel = {
                                                        id: generateChannelId(),
                                                        targetId: selectedComponent.id,
                                                        property: currentProp,
                                                        from: center - halfMm,
                                                        to: center + halfMm,
                                                        easing: 'sinusoidal',
                                                        periodMs: periodMs,
                                                        repeat: true,
                                                        restoreValue: center,
                                                    };
                                                    animator.addChannel(ch);
                                                    setAnimPlaying(true);
                                                    setChannelVersion(v => v + 1);
                                                    // Sync back to saved settings so they persist if we stop
                                                    setPiezoSettings(prev => new Map(prev).set(selectedComponent.id, { halfMm, periodMs, axis: currentAxisLabel }));
                                                }
                                            }}
                                            style={{
                                                flex: 1, padding: '6px 0',
                                                background: isScanning ? '#3a1a1a' : '#1a2a3a',
                                                border: `1px solid ${isScanning ? '#8a3a3a' : '#3a6a8a'}`,
                                                borderRadius: '5px',
                                                color: isScanning ? '#ff7b7b' : '#74b9ff',
                                                cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                                                letterSpacing: '0.3px', transition: 'all 0.15s',
                                            }}
                                            onMouseOver={e => {
                                                e.currentTarget.style.background = isScanning ? '#4a2a2a' : '#253a4a';
                                                e.currentTarget.style.borderColor = isScanning ? '#f44' : '#64b5f6';
                                            }}
                                            onMouseOut={e => {
                                                e.currentTarget.style.background = isScanning ? '#3a1a1a' : '#1a2a3a';
                                                e.currentTarget.style.borderColor = isScanning ? '#8a3a3a' : '#3a6a8a';
                                            }}
                                        >
                                            {isScanning ? `⏹ Stop (${currentAxisLabel})` : '⏵ Scan Piezo'}
                                        </button>
                                        <span style={{ fontSize: '10px', color: '#888', marginLeft: 6 }}>Hz</span>
                                        <input
                                            type="number"
                                            value={isScanning ? Math.round(1000 / activeChannel!.periodMs * 10) / 10 : localPiezoHz}
                                            key={activeChannel?.id ?? `piezo-hz-idle-${selectedComponent.id}`}
                                            min={0.1}
                                            max={100}
                                            step={0.1}
                                            onChange={e => {
                                                setLocalPiezoHz(e.target.value);
                                                if (isScanning) {
                                                    const hz = parseFloat(e.target.value);
                                                    if (isNaN(hz) || hz <= 0) return;
                                                    activeChannel!.periodMs = 1000 / hz;
                                                }
                                            }}
                                            style={{
                                                width: '48px', background: '#222', color: '#ccc', border: '1px solid #555',
                                                borderRadius: '3px', fontSize: '10px', padding: '2px 4px', textAlign: 'center',
                                            }}
                                        />
                                    </div>
                                    {isScanning && (
                                        <div style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                                            ±{Math.round((activeChannel!.to - activeChannel!.from) / 2 * 1000) / 1000}mm sweep · {currentAxisLabel} · {Math.round(1000 / activeChannel!.periodMs * 10) / 10} Hz
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* ── Sample Fluorescence Spectral Profiles ── */}
                {isSample && (() => {
                    const comp = selectedComponent as Sample;
                    const exCurve = comp.excitationSpectrum.getSampleCurve(180);
                    const emCurve = comp.emissionSpectrum.getSampleCurve(180);
                    const chartW = 250;
                    const chartH = 100;

                    const buildPath = (curve: { nm: number; t: number }[]) =>
                        curve.map((pt, i) => {
                            const x = (i / (curve.length - 1)) * chartW;
                            const y = chartH - pt.t * chartH;
                            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                        }).join(' ');

                    const exPath = buildPath(exCurve);
                    const emPath = buildPath(emCurve.map(pt => ({ nm: pt.nm, t: pt.t * comp.fluorescenceEfficiency })));

                    const spectrumStops = [
                        { nm: 350, color: '#1a0020' }, { nm: 380, color: '#2a0040' },
                        { nm: 420, color: '#4400aa' }, { nm: 450, color: '#0000ff' },
                        { nm: 480, color: '#0066ff' }, { nm: 500, color: '#00cccc' },
                        { nm: 520, color: '#00ff00' }, { nm: 560, color: '#aaff00' },
                        { nm: 580, color: '#ffff00' }, { nm: 600, color: '#ff8800' },
                        { nm: 640, color: '#ff0000' }, { nm: 700, color: '#aa0000' },
                        { nm: 780, color: '#400000' }, { nm: 850, color: '#1a0000' },
                    ];

                    /** Commit bands → SpectralProfile on the Sample component */
                    const commitBands = (which: 'excitation' | 'emission', updatedBands: { center: string; width: string }[]) => {
                        const bands = updatedBands.map(b => ({
                            center: parseFloat(b.center) || 500,
                            width: parseFloat(b.width) || 40,
                        }));
                        const preset = bands.length > 1 ? 'multiband' : 'bandpass';
                        const newProfile = new SpectralProfile(preset as ProfilePreset, bands[0]?.center ?? 500, bands);
                        const newComponents = components.map(c => {
                            if (c.id === selection[0] && c instanceof Sample) {
                                if (which === 'excitation') c.excitationSpectrum = newProfile;
                                else c.emissionSpectrum = newProfile;
                                c.version++;
                            }
                            return c;
                        });
                        setComponents([...newComponents]);
                    };

                    /** Render a peak list with add/delete */
                    const renderPeakList = (which: 'excitation' | 'emission') => {
                        const isEx = which === 'excitation';
                        const bands = isEx ? localExBands : localEmBands;
                        const setBands = isEx ? setLocalExBands : setLocalEmBands;
                        const color = isEx ? '#66aaff' : '#66ff88';
                        const dimColor = isEx ? '#3366aa' : '#338855';

                        return (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <label style={{ fontSize: '10px', color, fontWeight: 600 }}>
                                        {isEx ? '⬇ Excitation' : '⬆ Emission'} ({bands.length})
                                    </label>
                                    <button
                                        onClick={() => {
                                            const newBands = [...bands, { center: isEx ? '488' : '520', width: isEx ? '30' : '40' }];
                                            setBands(newBands);
                                            commitBands(which, newBands);
                                        }}
                                        style={{
                                            background: 'none', border: `1px solid ${dimColor}`, borderRadius: 3,
                                            color, cursor: 'pointer', fontSize: '10px', padding: '1px 6px',
                                            lineHeight: '14px',
                                        }}
                                        title={`Add ${which} peak`}
                                    >+ Peak</button>
                                </div>
                                {bands.map((band, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        marginBottom: 4, padding: '3px 5px',
                                        background: '#222', borderRadius: 4, border: `1px solid ${dimColor}33`,
                                    }}>
                                        <ScrubInput
                                            label="λ"
                                            suffix="nm"
                                            value={band.center}
                                            onChange={(v: string) => {
                                                const updated = [...bands];
                                                updated[idx] = { ...updated[idx], center: v };
                                                setBands(updated);
                                            }}
                                            onCommit={(v: string) => {
                                                const updated = [...bands];
                                                updated[idx] = { ...updated[idx], center: v };
                                                setBands(updated);
                                                commitBands(which, updated);
                                            }}
                                            speed={2}
                                            min={350}
                                            max={850}
                                        />
                                        <ScrubInput
                                            label="W"
                                            suffix="nm"
                                            value={band.width}
                                            onChange={(v: string) => {
                                                const updated = [...bands];
                                                updated[idx] = { ...updated[idx], width: v };
                                                setBands(updated);
                                            }}
                                            onCommit={(v: string) => {
                                                const updated = [...bands];
                                                updated[idx] = { ...updated[idx], width: v };
                                                setBands(updated);
                                                commitBands(which, updated);
                                            }}
                                            speed={1}
                                            min={5}
                                            max={300}
                                        />
                                        {bands.length > 1 && (
                                            <button
                                                onClick={() => {
                                                    const updated = bands.filter((_, i) => i !== idx);
                                                    setBands(updated);
                                                    commitBands(which, updated);
                                                }}
                                                style={{
                                                    background: 'none', border: 'none', color: '#f55',
                                                    cursor: 'pointer', fontSize: '13px', padding: '0 2px',
                                                    lineHeight: 1, flexShrink: 0,
                                                }}
                                                title="Remove peak"
                                            >🗑</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    };

                    return (
                        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                            <label style={{ fontSize: '11px', color: '#999', display: 'block', marginBottom: 8, letterSpacing: '0.5px' }}>
                                Fluorescence Spectra
                            </label>

                            {/* Dual-curve chart */}
                            <div style={{ marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
                                <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
                                    <defs>
                                        <linearGradient id="sampleSpecGrad" x1="0" x2="1" y1="0" y2="0">
                                            {spectrumStops.map((s, i) => (
                                                <stop key={i} offset={`${((s.nm - 350) / 500) * 100}%`} stopColor={s.color} />
                                            ))}
                                        </linearGradient>
                                    </defs>
                                    <rect x="0" y="0" width={chartW} height={chartH} fill="url(#sampleSpecGrad)" opacity="0.3" />
                                    {[0.25, 0.5, 0.75].map(t => (
                                        <line key={t} x1={0} x2={chartW} y1={chartH - t * chartH} y2={chartH - t * chartH} stroke="#555" strokeWidth="0.5" strokeDasharray="2,2" />
                                    ))}
                                    <path d={`${exPath} L${chartW},${chartH} L0,${chartH} Z`} fill="#4488ff" fillOpacity="0.15" />
                                    <path d={exPath} fill="none" stroke="#66aaff" strokeWidth="2" />
                                    <path d={`${emPath} L${chartW},${chartH} L0,${chartH} Z`} fill="#44ff88" fillOpacity="0.15" />
                                    <path d={emPath} fill="none" stroke="#66ff88" strokeWidth="2" />
                                    <text x={2} y={chartH - 2} fill="#888" fontSize="8">350</text>
                                    <text x={chartW - 28} y={chartH - 2} fill="#888" fontSize="8">850nm</text>
                                    <text x={2} y={10} fill="#888" fontSize="8">100%</text>
                                    <rect x={chartW - 80} y={4} width={8} height={3} fill="#66aaff" />
                                    <text x={chartW - 69} y={9} fill="#99bbff" fontSize="7">Excitation</text>
                                    <rect x={chartW - 80} y={12} width={8} height={3} fill="#66ff88" />
                                    <text x={chartW - 69} y={17} fill="#88ffaa" fontSize="7">Emission</text>
                                </svg>
                            </div>

                            {/* Peak lists */}
                            {renderPeakList('excitation')}
                            {renderPeakList('emission')}

                            {/* Fluorescence, absorption, and sample phase response */}
                            <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <ScrubInput
                                        label="Efficiency"
                                        value={localFluorEff}
                                        onChange={setLocalFluorEff}
                                        onCommit={(v: string) => {
                                            const val = parseFloat(v);
                                            if (isNaN(val)) return;
                                            const newComponents = components.map(c => {
                                                if (c.id === selection[0] && (c instanceof Sample || c instanceof SampleChamber)) {
                                                    c.fluorescenceEfficiency = val;
                                                    c.version++;
                                                }
                                                return c;
                                            });
                                            setComponents([...newComponents]);
                                        }}
                                        speed={0.001}
                                        min={0}
                                        max={1}
                                        title="Fluorescence quantum efficiency"
                                    />
                                    <ScrubInput
                                        label="Absorption"
                                        suffix="/mm"
                                        value={localAbsorption}
                                        onChange={setLocalAbsorption}
                                        onCommit={(v: string) => {
                                            const val = parseFloat(v);
                                            if (isNaN(val)) return;
                                            const newComponents = components.map(c => {
                                                if (c.id === selection[0] && (c instanceof Sample || c instanceof SampleChamber)) {
                                                    c.absorption = val;
                                                    c.version++;
                                                }
                                                return c;
                                            });
                                            setComponents([...newComponents]);
                                        }}
                                        speed={0.1}
                                        min={0}
                                        max={50}
                                        title="Beer-Lambert absorption coefficient (mm⁻¹)"
                                    />
                                    <ScrubInput
                                        label="Phase dN"
                                        value={localRefractiveIndexDelta}
                                        onChange={setLocalRefractiveIndexDelta}
                                        onCommit={(v: string) => {
                                            const val = parseFloat(v);
                                            if (isNaN(val)) return;
                                            const newComponents = components.map(c => {
                                                if (c.id === selection[0] && (c instanceof Sample || c instanceof SampleChamber)) {
                                                    c.refractiveIndexDelta = val;
                                                    c.version++;
                                                }
                                                return c;
                                            });
                                            setComponents([...newComponents]);
                                        }}
                                        speed={0.001}
                                        min={-0.2}
                                        max={0.2}
                                        title="Uniform specimen refractive-index delta used by forward PPS phase propagation"
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })()}


                {/* Card Viewer: beam cross-section + polarization */}
                {supportsLensProfileEditor(selectedComponent) && (
                    <LensProfileEditor component={selectedComponent} />
                )}

                {isCard && (
                    <CardViewerWithPin
                        card={selectedComponent as Card}
                        pinnedIds={pinnedIds}
                        setPinnedIds={setPinnedIds}
                    />
                )}

                {isCamera && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Detector Sampling</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Res X"
                                suffix="px"
                                value={localCameraResX}
                                onChange={setLocalCameraResX}
                                onCommit={(v: string) => {
                                    const val = Math.min(2048, Math.max(1, Math.round(parseFloat(v))));
                                    if (!Number.isFinite(val)) return;
                                    updateSelectedCamera(camera => { camera.sensorResX = val; });
                                }}
                                speed={1}
                                min={1}
                                max={2048}
                            />
                            <ScrubInput
                                label="Res Y"
                                suffix="px"
                                value={localCameraResY}
                                onChange={setLocalCameraResY}
                                onCommit={(v: string) => {
                                    const val = Math.min(2048, Math.max(1, Math.round(parseFloat(v))));
                                    if (!Number.isFinite(val)) return;
                                    updateSelectedCamera(camera => { camera.sensorResY = val; });
                                }}
                                speed={1}
                                min={1}
                                max={2048}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <div>
                                <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: 4 }}>Launch</label>
                                <select
                                    value={localCameraLaunchModel}
                                    onChange={(e) => {
                                        const value = e.target.value === 'packet' ? 'packet' : 'stochastic';
                                        setLocalCameraLaunchModel(value);
                                        updateSelectedCamera(camera => { camera.detectorLaunchModel = value; });
                                    }}
                                    style={{
                                        width: '100%',
                                        background: '#111',
                                        color: '#ddd',
                                        border: '1px solid #444',
                                        borderRadius: 4,
                                        padding: '4px 6px',
                                        fontSize: '11px',
                                    }}
                                >
                                    <option value="stochastic">stochastic</option>
                                    <option value="packet">packet</option>
                                </select>
                            </div>
                            <ScrubInput
                                label="Sensor NA"
                                value={localCameraSensorNA}
                                onChange={setLocalCameraSensorNA}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (!Number.isFinite(val) || val < 0) return;
                                    updateSelectedCamera(camera => { camera.sensorNA = val; });
                                }}
                                speed={0.01}
                                min={0}
                                max={1}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px', color: '#777' }}>
                                Uses global Reverse/Px
                            </div>
                        </div>
                    </div>
                )}

                {/* Camera Viewer: Image Formation render output */}
                {isCamera && (
                    <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontSize: '11px', color: '#aaa' }}>Camera Image</span>
                            <button
                                onClick={() => {
                                    const next = new Set(pinnedIds);
                                    if (pinnedIds.has(selectedComponent.id)) next.delete(selectedComponent.id);
                                    else next.add(selectedComponent.id);
                                    setPinnedIds(next);
                                }}
                                title={pinnedIds.has(selectedComponent.id) ? 'Unpin viewer' : 'Pin viewer'}
                                style={{
                                    background: pinnedIds.has(selectedComponent.id) ? '#333' : 'none',
                                    border: pinnedIds.has(selectedComponent.id) ? '1px solid #555' : '1px solid #444',
                                    borderRadius: '3px',
                                    color: pinnedIds.has(selectedComponent.id) ? '#fff' : '#888',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    padding: '1px 5px',
                                    lineHeight: 1.2,
                                }}
                            >
                                📌
                            </button>
                        </div>
                        <CameraViewer
                            camera={selectedComponent as Camera}
                            isRendering={isRendering}
                            onRefresh={() => {
                                if (isRendering) return;
                                setImageFormationTrigger(n => n + 1);
                            }}
                        />
                    </div>
                )}

                {/* PMT Detector: axis binding + raster scan */}
                {isPMT && (() => {
                    const pmt = selectedComponent as PMT;
                    // Find all components with active galvo/piezo animation channels
                    const galvoOptions: { compId: string; compName: string; property: string; label: string }[] = [];
                    for (const ch of animator.channels) {
                        if (ch.property === 'tiltAngle' || ch.property === 'panAngle' || ch.property === 'scanX' || ch.property === 'scanY') {
                            const comp = components.find(c => c.id === ch.targetId);
                            if (comp) {
                                const axisLabel = (ch.property === 'tiltAngle' || ch.property === 'scanY') ? 'U' : 'V';
                                galvoOptions.push({
                                    compId: comp.id,
                                    compName: comp.name,
                                    property: ch.property,
                                    label: `${comp.name} · ${axisLabel}`,
                                });
                            }
                        } else if (ch.property.startsWith('specimenOffset.')) {
                            const comp = components.find(c => c.id === ch.targetId);
                            if (comp) {
                                const axisLabel = 'd' + ch.property.split('.')[1].toUpperCase();
                                galvoOptions.push({
                                    compId: comp.id,
                                    compName: comp.name,
                                    property: ch.property,
                                    label: `${comp.name} · ${axisLabel}`,
                                });
                            }
                        }
                    }
                    const xKey = pmt.xAxisComponentId && pmt.xAxisProperty ? `${pmt.xAxisComponentId}:${pmt.xAxisProperty}` : '';
                    const yKey = pmt.yAxisComponentId && pmt.yAxisProperty ? `${pmt.yAxisComponentId}:${pmt.yAxisProperty}` : '';

                    const updatePMTAxis = (axis: 'x' | 'y', value: string) => {
                        const [compId, prop] = value ? value.split(':') : ['', ''];
                        const newComponents = components.map(c => {
                            if (c.id === pmt.id && c instanceof PMT) {
                                if (axis === 'x') { c.xAxisComponentId = compId || null; c.xAxisProperty = prop || null; }
                                else { c.yAxisComponentId = compId || null; c.yAxisProperty = prop || null; }
                                c.version++;
                            }
                            return c;
                        });
                        setComponents([...newComponents]);
                    };

                    const hasAxes = pmt.hasValidAxes();

                    return (
                        <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <label style={{ fontSize: '11px', color: '#666' }}>PMT Raster Scan</label>
                            </div>

                            {galvoOptions.length === 0 && (
                                <div style={{ fontSize: '10px', color: '#666', marginBottom: 8, fontStyle: 'italic' }}>
                                    No scan channels active. Enable galvo scan on mirrors or piezo scan on samples first.
                                </div>
                            )}

                            {galvoOptions.length > 0 && (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <span style={{ fontSize: '10px', color: '#888', minWidth: 30 }}>X Axis</span>
                                        <select
                                            value={xKey}
                                            onChange={e => updatePMTAxis('x', e.target.value)}
                                            style={{ flex: 1, background: '#222', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: '11px', padding: '3px 4px' }}
                                        >
                                            <option value="">— none —</option>
                                            {galvoOptions.filter(o => `${o.compId}:${o.property}` !== yKey).map(o => (
                                                <option key={`${o.compId}:${o.property}`} value={`${o.compId}:${o.property}`}>{o.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                        <span style={{ fontSize: '10px', color: '#888', minWidth: 30 }}>Y Axis</span>
                                        <select
                                            value={yKey}
                                            onChange={e => updatePMTAxis('y', e.target.value)}
                                            style={{ flex: 1, background: '#222', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: '11px', padding: '3px 4px' }}
                                        >
                                            <option value="">— none —</option>
                                            {galvoOptions.filter(o => `${o.compId}:${o.property}` !== xKey).map(o => (
                                                <option key={`${o.compId}:${o.property}`} value={`${o.compId}:${o.property}`}>{o.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* Hz convenience controls */}
                            {hasAxes && (() => {
                                const xCh = animator.channels.find(ch => ch.targetId === pmt.xAxisComponentId && ch.property === pmt.xAxisProperty);
                                const yCh = animator.channels.find(ch => ch.targetId === pmt.yAxisComponentId && ch.property === pmt.yAxisProperty);
                                const xHz = xCh ? Math.round(1000 / xCh.periodMs * 10) / 10 : 0;
                                const yHz = yCh ? Math.round(1000 / yCh.periodMs * 10) / 10 : 0;
                                const derivedResolution = xHz > 0 && yHz > 0
                                    ? derivePMTScanResolution(pmt.pmtSampleHz, xHz, yHz)
                                    : null;

                                const hzInputStyle: React.CSSProperties = {
                                    width: '45px', background: 'transparent', color: '#fff', fontWeight: 500,
                                    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.2)', borderRadius: '0px',
                                    fontSize: '11px', padding: '2px 4px', textAlign: 'center', outline: 'none',
                                    transition: 'border-color 0.2s',
                                };

                                return (
                                    <div style={{ marginBottom: 8, padding: '6px', background: '#1a1a1a', borderRadius: 4, border: '1px solid #333' }}>
                                        <div style={{ fontSize: '10px', color: '#777', marginBottom: 6, fontWeight: 600 }}>Scan Frequencies</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: '10px', color: '#888', minWidth: 54 }}>X (fast)</span>
                                            <input
                                                type="number"
                                                defaultValue={xHz}
                                                key={`xhz-${xCh?.id ?? 'none'}`}
                                                min={0.1} max={10000} step={0.1}
                                                onBlur={e => {
                                                    const hz = parseFloat(e.target.value);
                                                    if (isNaN(hz) || hz <= 0 || !xCh) return;
                                                    xCh.periodMs = 1000 / hz;
                                                    pmt.markScanStale();
                                                    pmt.version++;
                                                    setComponents([...components]);
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                style={hzInputStyle}
                                            />
                                            <span style={{ fontSize: '9px', color: '#666' }}>Hz</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: '10px', color: '#888', minWidth: 54 }}>Y (slow)</span>
                                            <input
                                                type="number"
                                                defaultValue={yHz}
                                                key={`yhz-${yCh?.id ?? 'none'}`}
                                                min={0.01} max={10000} step={0.01}
                                                onBlur={e => {
                                                    const hz = parseFloat(e.target.value);
                                                    if (isNaN(hz) || hz <= 0 || !yCh) return;
                                                    yCh.periodMs = 1000 / hz;
                                                    pmt.markScanStale();
                                                    pmt.version++;
                                                    setComponents([...components]);
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                style={hzInputStyle}
                                            />
                                            <span style={{ fontSize: '9px', color: '#666' }}>Hz</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: '10px', color: '#888', minWidth: 54 }}>PMT</span>
                                            <input
                                                type="number"
                                                defaultValue={pmt.pmtSampleHz}
                                                key={`pmthz-${pmt.version}`}
                                                min={1} max={100000} step={1}
                                                onBlur={e => {
                                                    const hz = parseFloat(e.target.value);
                                                    if (isNaN(hz) || hz <= 0) return;
                                                    pmt.pmtSampleHz = hz;
                                                    pmt.markScanStale();
                                                    pmt.version++;
                                                    setComponents([...components]);
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                style={hzInputStyle}
                                            />
                                            <span style={{ fontSize: '9px', color: '#666' }}>Hz</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: '10px', color: '#888', minWidth: 54 }}>Sensor NA</span>
                                            <input
                                                type="number"
                                                defaultValue={pmt.sensorNA}
                                                key={`pmtna-${pmt.version}`}
                                                min={0} max={1} step={0.001}
                                                onBlur={e => {
                                                    const na = parseFloat(e.target.value);
                                                    if (isNaN(na) || na < 0) return;
                                                    pmt.sensorNA = Math.max(0, Math.min(1, na));
                                                    pmt.markScanStale();
                                                    pmt.version++;
                                                    setComponents([...components]);
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                style={hzInputStyle}
                                            />
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#666', marginTop: 2 }}>
                                            Reverse/Px: {clampValue(rayConfig.reversePathCount, MIN_REVERSE_PATH_COUNT, MAX_REVERSE_PATH_COUNT)}
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#555', marginTop: 4 }}>
                                            Resolution: {derivedResolution ? `${derivedResolution.resX} × ${derivedResolution.resY}` : '—'} px
                                        </div>
                                    </div>
                                );
                            })()}
                            {hasAxes && (
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '11px', color: '#aaa' }}>Scan Image</span>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button
                                                onClick={() => {
                                                    const next = new Set(pinnedIds);
                                                    if (pinnedIds.has(pmt.id)) next.delete(pmt.id);
                                                    else next.add(pmt.id);
                                                    setPinnedIds(next);
                                                }}
                                                title={pinnedIds.has(pmt.id) ? 'Unpin viewer' : 'Pin viewer'}
                                                style={{
                                                    background: pinnedIds.has(pmt.id) ? '#333' : 'none',
                                                    border: pinnedIds.has(pmt.id) ? '1px solid #555' : '1px solid #444',
                                                    borderRadius: '3px',
                                                    color: pinnedIds.has(pmt.id) ? '#fff' : '#888',
                                                    cursor: 'pointer',
                                                    fontSize: '11px',
                                                    padding: '1px 5px',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                📌
                                            </button>
                                        </div>
                                    </div>
                                    <PMTViewer
                                        pmt={pmt}
                                        isRendering={isRendering}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })()}


            </div>
        </div>
        </>
    );
};

const inputStyle: React.CSSProperties = {
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    fontWeight: 500,
    outline: 'none',
    padding: '4px 6px',
    borderRadius: '0',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    transition: 'border-color 0.2s'
};
