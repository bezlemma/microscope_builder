import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { useIsMobile } from './useIsMobile';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom, pinnedViewersAtom, rayConfigAtom, solver3RenderTriggerAtom, solver3RenderingAtom, pushUndoAtom, animatorAtom, animationPlayingAtom, animationSpeedAtom, scanAccumTriggerAtom, scanAccumProgressAtom } from '../state/store';
import { generateChannelId, AnimationChannel, PropertyAnimator } from '../physics/PropertyAnimator';
import { Euler, Quaternion, Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';

import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { IdealLens } from '../physics/components/IdealLens';
import { Objective } from '../physics/components/Objective';
import { PolygonScanner } from '../physics/components/PolygonScanner';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { Aperture } from '../physics/components/Aperture';
import { SlitAperture } from '../physics/components/SlitAperture';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { Sample } from '../physics/components/Sample';
import { PMT } from '../physics/components/PMT';
import { SpectralProfile, ProfilePreset } from '../physics/SpectralProfile';
import { ScrubInput } from './ScrubInput';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';

// Wavelength to visible spectrum color (approximation)
function wavelengthToColor(wavelength: number): string {
    let r = 0, g = 0, b = 0;

    if (wavelength >= 380 && wavelength < 440) {
        r = -(wavelength - 440) / (440 - 380);
        b = 1.0;
    } else if (wavelength >= 440 && wavelength < 490) {
        g = (wavelength - 440) / (490 - 440);
        b = 1.0;
    } else if (wavelength >= 490 && wavelength < 510) {
        g = 1.0;
        b = -(wavelength - 510) / (510 - 490);
    } else if (wavelength >= 510 && wavelength < 580) {
        r = (wavelength - 510) / (580 - 510);
        g = 1.0;
    } else if (wavelength >= 580 && wavelength < 645) {
        r = 1.0;
        g = -(wavelength - 645) / (645 - 580);
    } else if (wavelength >= 645 && wavelength <= 780) {
        r = 1.0;
    }

    // Apply intensity correction for edge wavelengths
    let factor = 1.0;
    if (wavelength >= 380 && wavelength < 420) {
        factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
    } else if (wavelength >= 645 && wavelength <= 780) {
        factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 645);
    } else if (wavelength < 380 || wavelength > 780) {
        return '#888888'; // Gray for UV/IR
    }

    r = Math.round(255 * Math.pow(r * factor, 0.8));
    g = Math.round(255 * Math.pow(g * factor, 0.8));
    b = Math.round(255 * Math.pow(b * factor, 0.8));

    return `rgb(${r}, ${g}, ${b})`;
}

function isVisibleSpectrum(wavelength: number): boolean {
    return wavelength >= 380 && wavelength <= 780;
}

// ─── CardViewer with pin toggle ─────────────────────────────────────

const CardViewerWithPin: React.FC<{
    card: Card;
    pinnedIds: Set<string>;
    setPinnedIds: (s: Set<string>) => void;
}> = ({ card, pinnedIds, setPinnedIds }) => {
    const isPinned = pinnedIds.has(card.id);
    return (
        <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: '#aaa' }}>Beam Profile</span>
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
            <CardViewer card={card} />
        </div>
    );
};

const SolverPanel: React.FC<{
    rayConfig: any;
    setRayConfig: (v: any) => void;
    isRendering: boolean;
    setSolver3Trigger: (fn: (prev: number) => number) => void;
    animator: PropertyAnimator;
    animPlaying: boolean;
    setAnimPlaying: (v: boolean) => void;
}> = ({ rayConfig, setRayConfig, isRendering, setSolver3Trigger, animator, animPlaying, setAnimPlaying }) => {
    const isMobile = useIsMobile();
    const [mobileOpen, setMobileOpen] = React.useState(false);
    const isVisible = !isMobile || mobileOpen;
    const hasChannels = animator.channels.length > 0;
    const [components] = useAtom(componentsAtom);
    const [scanAccumConfig, setScanAccumConfig] = useAtom(scanAccumTriggerAtom);
    const [scanProgress] = useAtom(scanAccumProgressAtom);

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
                        height: '100vh',
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
                        width: 40,
                        height: 40,
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
                    title="Physics Solvers"
                >
                    ⚙
                </button>
            )}

            {/* Panel */}
            <div style={{
                position: isMobile ? 'fixed' : 'absolute',
                top: 20,
                right: 20,
                width: 280,
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                color: 'white',
                padding: 15,
                borderRadius: 8,
                border: '1px solid #444',
                fontFamily: 'sans-serif',
                fontSize: '12px',
                zIndex: 15,
                transform: isVisible ? 'translateX(0)' : 'translateX(calc(100% + 40px))',
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
                    <span style={{ fontWeight: 'bold', flex: 1 }}>Physics Solvers</span>
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

                    {/* Ray Tracer (always on) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4f4' }}></div>
                        <span>Ray Tracer</span>
                    </div>
                    <div style={{ paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: 4 }}>
                        <input
                            type="range"
                            min="4"
                            max="128"
                            step="1"
                            value={Math.max(4, rayConfig.rayCount)}
                            onChange={(e) => setRayConfig({ ...rayConfig, rayCount: parseInt(e.target.value) })}
                            style={{ width: '80px' }}
                        />
                        <span style={{ minWidth: '20px' }}>{Math.max(4, rayConfig.rayCount)} Rays</span>
                    </div>

                    {/* E&M (toggleable) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 8 }}>
                        <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: rayConfig.solver2Enabled ? '#4af' : '#555',
                            transition: 'background-color 0.2s'
                        }}></div>
                        <input
                            type="checkbox"
                            checked={rayConfig.solver2Enabled}
                            onChange={() => setRayConfig({ ...rayConfig, solver2Enabled: !rayConfig.solver2Enabled, emFieldVisible: !rayConfig.solver2Enabled ? rayConfig.emFieldVisible : false })}
                            style={{ cursor: 'pointer' }}
                        />
                        <span
                            style={{ opacity: rayConfig.solver2Enabled ? 1 : 0.5, cursor: 'pointer' }}
                            onClick={() => setRayConfig({ ...rayConfig, solver2Enabled: !rayConfig.solver2Enabled, emFieldVisible: !rayConfig.solver2Enabled ? rayConfig.emFieldVisible : false })}
                        >E&M</span>

                        {/* E-field visualization toggle */}
                        {rayConfig.solver2Enabled && (
                            <button
                                onClick={() => setRayConfig({ ...rayConfig, emFieldVisible: !rayConfig.emFieldVisible })}
                                title={rayConfig.emFieldVisible ? 'Hide E-field visualization' : 'Show 3D E-field vectors'}
                                style={{
                                    background: rayConfig.emFieldVisible ? '#2a3a5a' : 'none',
                                    border: rayConfig.emFieldVisible ? '1px solid #4af' : '1px solid #444',
                                    borderRadius: '3px',
                                    color: rayConfig.emFieldVisible ? '#4af' : '#666',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    padding: '1px 4px',
                                    lineHeight: 1,
                                    marginLeft: '4px',
                                    transition: 'all 0.2s',
                                }}
                            >
                                👁
                            </button>
                        )}
                    </div>

                    {/* Solver 3: Calculate Emission and Image */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: isRendering ? '#fa4' : '#555',
                                transition: 'background-color 0.2s'
                            }}></div>
                            <button
                                onClick={() => {
                                    if (hasChannels) {
                                        // Animation channels present — auto scan accumulation
                                        setScanAccumConfig({ steps: 16, trigger: scanAccumConfig.trigger + 1 });
                                    } else {
                                        // No animation — single Solver 3 render
                                        setSolver3Trigger((prev: number) => prev + 1);
                                    }
                                }}
                                disabled={isRendering || !rayConfig.solver2Enabled}
                                title={!rayConfig.solver2Enabled ? 'Enable E&M first — imaging requires Gaussian beam data' : hasChannels ? 'Scan accumulation: cycle through animation and render' : 'Backward-trace rays from camera through optics to sample'}
                                style={{
                                    padding: '3px 10px',
                                    background: isRendering || !rayConfig.solver2Enabled ? '#333' : '#1a5a2a',
                                    border: '1px solid #444',
                                    borderRadius: '4px',
                                    color: isRendering || !rayConfig.solver2Enabled ? '#666' : '#8f8',
                                    cursor: isRendering || !rayConfig.solver2Enabled ? 'not-allowed' : 'pointer',
                                    fontSize: '11px',
                                    fontFamily: 'monospace',
                                    transition: 'background 0.2s',
                                }}
                            >
                                {isRendering && scanProgress > 0 && scanProgress < 1
                                    ? `⏳ ${Math.round(scanProgress * 100)}%`
                                    : isRendering ? '⏳ Calculating...' : 'Calculate Emission and Image'}
                            </button>
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
                    </div>
            </div>
        </>
    );
};

export const Inspector: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [rayConfig, setRayConfig] = useAtom(rayConfigAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [animator] = useAtom(animatorAtom);
    const [, setAnimPlaying] = useAtom(animationPlayingAtom);
    const [animPlaying] = useAtom(animationPlayingAtom);
    const [animSpeed, setAnimSpeed] = useAtom(animationSpeedAtom);
    const [scanAccumConfig, setScanAccumConfig] = useAtom(scanAccumTriggerAtom);
    // Bumped on channel add/remove to force re-render of galvo scan UI
    const [_channelVersion, setChannelVersion] = useState(0);
    // Remembers the last-used galvo settings per component, persists across stop/start
    const [galvoAngles, setGalvoAngles] = useState<Map<string, { halfDeg: number; periodMs: number; axis: string }>>(new Map());


    const selectedComponent = selection.length === 1
        ? components.find(c => c.id === selection[0])
        : undefined;


    const [localX, setLocalX] = useState<string>('0');
    const [localY, setLocalY] = useState<string>('0');
    const [localRot, setLocalRot] = useState<string>('0');


    const [localWidth, setLocalWidth] = useState<string>('0');
    const [localHeight, setLocalHeight] = useState<string>('0');


    const [localMirrorDiameter, setLocalMirrorDiameter] = useState<string>('25');
    const [localMirrorThickness, setLocalMirrorThickness] = useState<string>('2');


    const [localBlockerDiameter, setLocalBlockerDiameter] = useState<string>('20');
    const [localBlockerThickness, setLocalBlockerThickness] = useState<string>('5');
    const [localRadius, setLocalRadius] = useState<string>('0');
    const [localFocal, setLocalFocal] = useState<string>('0');
    const [localR1, setLocalR1] = useState<string>('0');
    const [localR2, setLocalR2] = useState<string>('0');
    const [localThickness, setLocalThickness] = useState<string>('0');
    const [localIor, setLocalIor] = useState<string>('1.5');
    const [localLensType, setLocalLensType] = useState<string>('biconvex');


    const [localIdealFocal, setLocalIdealFocal] = useState<string>('50');
    const [localIdealAperture, setLocalIdealAperture] = useState<string>('15');


    const [localObjNA, setLocalObjNA] = useState<string>('0.25');
    const [localObjMag, setLocalObjMag] = useState<string>('10');
    const [localObjImmersion, setLocalObjImmersion] = useState<string>('1.0');
    const [localObjWD, setLocalObjWD] = useState<string>('10');
    const [localObjDiameter, setLocalObjDiameter] = useState<string>('20');

    const [localPolyFaces, setLocalPolyFaces] = useState<string>('6');
    const [localPolyRadius, setLocalPolyRadius] = useState<string>('10');
    const [localPolyHeight, setLocalPolyHeight] = useState<string>('10');
    const [localPolyScanAngle, setLocalPolyScanAngle] = useState<string>('0');


    const [localWavelength, setLocalWavelength] = useState<number>(532);
    const [localBeamRadius, setLocalBeamRadius] = useState<string>('2');
    const [localLaserPower, setLocalLaserPower] = useState<string>('1');
    const [localLampPower, setLocalLampPower] = useState<string>('1');

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


    const [localApexAngle, setLocalApexAngle] = useState<string>('60');
    const [localPrismHeight, setLocalPrismHeight] = useState<string>('20');
    const [localPrismIor, setLocalPrismIor] = useState<string>('1.5168');


    const [localApertureDiameter, setLocalApertureDiameter] = useState<string>('10');
    const [localSlitWidth, setLocalSlitWidth] = useState<string>('5');
    const [localSlitRotation, setLocalSlitRotation] = useState<string>('0');
    const [localCylClocking, setLocalCylClocking] = useState<string>('0');




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


    useEffect(() => {
        if (selectedComponent) {
            try {
                setLocalX(String(Math.round(selectedComponent.position.x * 100) / 100));
                setLocalY(String(Math.round(selectedComponent.position.y * 100) / 100));

                // Rotation around Z (World Up) - extract via ZYX Euler decomposition
                // The Z component in ZYX order IS the world-Z rotation, regardless of
                // the component's base rotation (works for Laser, Mirror, Lens, etc.)
                if (selectedComponent.rotation) {
                    const euler = new Euler().setFromQuaternion(selectedComponent.rotation, 'ZYX');
                    const zDeg = Math.round(euler.z * 180 / Math.PI);
                    setLocalRot(String(zDeg));
                }


                if (selectedComponent instanceof Card) {
                    const c = selectedComponent as any;
                    if (c.width != null) setLocalWidth(String(c.width));
                    if (c.height != null) setLocalHeight(String(c.height));
                }
                if (selectedComponent instanceof Mirror) {
                    setLocalMirrorDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                    setLocalMirrorThickness(String(Math.round(selectedComponent.thickness * 100) / 100));
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
                if (selectedComponent instanceof IdealLens) {
                    setLocalIdealFocal(String(Math.round(selectedComponent.focalLength * 100) / 100));
                    setLocalIdealAperture(String(Math.round(selectedComponent.apertureRadius * 100) / 100));
                }
                if (selectedComponent instanceof Objective) {
                    setLocalObjNA(String(selectedComponent.NA));
                    setLocalObjMag(String(selectedComponent.magnification));
                    setLocalObjImmersion(String(selectedComponent.immersionIndex));
                    setLocalObjWD(String(Math.round(selectedComponent.workingDistance * 100) / 100));
                    setLocalObjDiameter(String(Math.round(selectedComponent.diameter * 100) / 100));
                }
                if (selectedComponent instanceof PolygonScanner) {
                    setLocalPolyFaces(String(selectedComponent.numFaces));
                    setLocalPolyRadius(String(selectedComponent.inscribedRadius));
                    setLocalPolyHeight(String(selectedComponent.faceHeight));
                    setLocalPolyScanAngle(String(Math.round(selectedComponent.scanAngle * 180 / Math.PI * 100) / 100));
                }
                if (selectedComponent instanceof Laser) {
                    setLocalWavelength(selectedComponent.wavelength);
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                    setLocalLaserPower(String(selectedComponent.power));
                }
                if (selectedComponent instanceof Lamp) {
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                    setLocalLampPower(String(selectedComponent.power));
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
                if (selectedComponent instanceof PrismLens) {
                    setLocalApexAngle(String(Math.round(selectedComponent.apexAngle * 180 / Math.PI * 100) / 100));
                    setLocalPrismHeight(String(selectedComponent.height));
                    setLocalPrismIor(String(selectedComponent.ior));
                }
                if (selectedComponent instanceof Aperture) {
                    setLocalApertureDiameter(String(Math.round(selectedComponent.openingDiameter * 100) / 100));
                }
                if (selectedComponent instanceof SlitAperture) {
                    setLocalSlitWidth(String(Math.round(selectedComponent.slitWidth * 100) / 100));
                    // Extract rotation around local X (optical axis) from Euler
                    const euler = new Euler().setFromQuaternion(selectedComponent.rotation);
                    setLocalSlitRotation(String(Math.round(euler.x * 180 / Math.PI * 100) / 100));
                }
                if (selectedComponent instanceof CylindricalLens) {
                    // Extract clocking angle: rotation around local Z (optical axis)
                    const euler = new Euler().setFromQuaternion(selectedComponent.rotation);
                    setLocalCylClocking(String(Math.round(euler.x * 180 / Math.PI * 100) / 100));
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
                if (selectedComponent instanceof Sample) {
                    setLocalExBands(selectedComponent.excitationSpectrum.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                    setLocalEmBands(selectedComponent.emissionSpectrum.bands.map(b => ({ center: String(b.center), width: String(b.width) })));
                    setLocalFluorEff(selectedComponent.fluorescenceEfficiency.toPrecision(3));
                    setLocalAbsorption(String(selectedComponent.absorption));
                }
            } catch (err) {
                console.error("Inspector Update Error:", err);
            }
        }
    }, [selectedComponent, selection, components]);


    const commitPosition = (axis: 'x' | 'y' | 'z', valueStr: string) => { /* ... same ... */
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


    const commitRotation = (valueStr: string) => {
        if (!selectedComponent) return;
        const val = parseFloat(valueStr);
        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0]) {
                // Unified rotation: same approach as Q/E keys and Shift+scroll.
                // Extract current world-Z angle, compute delta to desired, premultiply.
                // This preserves each component's base rotation (Y-axis for lenses,
                // identity for blockers/cards, etc.) regardless of component type.
                const currentEuler = new Euler().setFromQuaternion(c.rotation, 'ZYX');
                const currentZRad = currentEuler.z;
                const desiredZRad = val * Math.PI / 180;
                const deltaZ = desiredZRad - currentZRad;

                const qStep = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deltaZ);
                c.rotation.premultiply(qStep);

                const euler = new Euler().setFromQuaternion(c.rotation);
                c.setRotation(euler.x, euler.y, euler.z);
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


    const handleKeyDown = (e: React.KeyboardEvent, commitFn: () => void) => {
        if (e.key === 'Enter') {
            commitFn();
            (e.target as HTMLInputElement).blur();
        }
    };

    const [localName, setLocalName] = useState(selectedComponent?.name ?? '');
    useEffect(() => { setLocalName(selectedComponent?.name ?? ''); }, [selectedComponent?.id]);

    if (!selectedComponent) {
        return <SolverPanel rayConfig={rayConfig} setRayConfig={setRayConfig} isRendering={isRendering} setSolver3Trigger={setSolver3Trigger} animator={animator} animPlaying={animPlaying} setAnimPlaying={setAnimPlaying} />;
    }

    const isCard = selectedComponent instanceof Card;
    const isMirror = selectedComponent instanceof Mirror;
    const isBlocker = selectedComponent instanceof Blocker;
    const isLens = selectedComponent instanceof SphericalLens;
    const isIdealLens = selectedComponent instanceof IdealLens;
    const isObjective = selectedComponent instanceof Objective;
    const isLaser = selectedComponent instanceof Laser;
    const isLamp = selectedComponent instanceof Lamp;
    const isPrism = selectedComponent instanceof PrismLens;
    const isWaveplate = selectedComponent instanceof Waveplate;
    const isAperture = selectedComponent instanceof Aperture;
    const isSlitAperture = selectedComponent instanceof SlitAperture;
    const isFilter = selectedComponent instanceof Filter;
    const isDichroic = selectedComponent instanceof DichroicMirror;
    const isCylindrical = selectedComponent instanceof CylindricalLens;
    const isCurvedMirror = selectedComponent instanceof CurvedMirror;
    const isFlatMirror = selectedComponent instanceof Mirror && !(selectedComponent instanceof CurvedMirror) && !(selectedComponent instanceof DichroicMirror) && !(selectedComponent instanceof PolygonScanner);
    const isPolygonScanner = selectedComponent instanceof PolygonScanner;
    const isSample = selectedComponent instanceof Sample;
    const isGalvoCapable = isFlatMirror || isCurvedMirror;
    const isPMT = selectedComponent instanceof PMT;

    const hasSpectralProfile = isFilter || isDichroic;

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
        if (isNaN(radius)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Lamp) {
                c.beamRadius = radius;
                if (!isNaN(power) && power > 0) c.power = power;
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
        <div style={{
            position: 'absolute',
            top: 20,
            right: 20,
            width: 280,
            backgroundColor: 'rgba(30, 30, 30, 0.95)',
            color: '#eee',
            padding: 14,
            borderRadius: 8,
            border: '1px solid #444',
            fontFamily: 'Inter, sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
        }}>
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
                        setComponents(components.filter(c => c.id !== selection[0]));
                        setSelection([]);
                    }}
                    title="Delete component"
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                        color: '#888',
                        transition: 'color 0.15s',
                        flexShrink: 0,
                    }}
                    onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; }}
                    onMouseOut={e => { e.currentTarget.style.color = '#888'; }}
                >
                    <Trash2 size={15} />
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* X / Y / Rotation — compact single row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 70px', gap: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '10px', color: '#888', marginBottom: 2 }}>X (mm)</label>
                        <input
                            type="text"
                            value={localX}
                            onChange={(e) => setLocalX(e.target.value)}
                            onBlur={() => commitPosition('x', localX)}
                            onKeyDown={(e) => handleKeyDown(e, () => commitPosition('x', localX))}
                            style={inputStyle}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '10px', color: '#888', marginBottom: 2 }}>Y (mm)</label>
                        <input
                            type="text"
                            value={localY}
                            onChange={(e) => setLocalY(e.target.value)}
                            onBlur={() => commitPosition('y', localY)}
                            onKeyDown={(e) => handleKeyDown(e, () => commitPosition('y', localY))}
                            style={inputStyle}
                        />
                    </div>
                    <ScrubInput
                        label="Rot"
                        suffix="°"
                        value={localRot}
                        onChange={setLocalRot}
                        onCommit={(v: string) => commitRotation(v)}
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
                                value={localHeight}
                                onChange={(e) => setLocalHeight(e.target.value)}
                                onBlur={() => commitGeometry('height', localHeight)}
                                onKeyDown={(e) => handleKeyDown(e, () => commitGeometry('height', localHeight))}
                                style={inputStyle}
                            />
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

                {/* Galvo Scan — for Mirror and CurvedMirror */}
                {isGalvoCapable && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Galvo Scan</label>
                        {(() => {
                            const activeChannel = animator.channels.find(ch => ch.targetId === selectedComponent.id && (ch.property === 'rotation.y' || ch.property === 'rotation.z'));
                            const isScanning = !!activeChannel;
                            const savedSettings = galvoAngles.get(selectedComponent.id);
                            const currentAxis = activeChannel
                                ? (activeChannel.property === 'rotation.y' ? 'U' : 'V')
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
                                                const newAxisProp = newAxisLabel === 'U' ? 'rotation.y' : 'rotation.z';
                                                if (isScanning) {
                                                    // Switching axis while animating: remove old channel, create new on the new axis
                                                    const oldPeriodMs = activeChannel!.periodMs;
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    // Compute center from the NEW axis's current rotation (not the old axis!)
                                                    const euler = new Euler().setFromQuaternion(selectedComponent.rotation);
                                                    const newCenter = newAxisProp === 'rotation.y' ? euler.y : euler.z;
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
                                                    // Not scanning — just remember the new axis for when Scan is clicked
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
                                            id={'galvo-range-' + selectedComponent.id}
                                            type="number"
                                            defaultValue={currentHalfDeg}
                                            key={activeChannel?.id ?? `galvo-idle-${selectedComponent.id}`}
                                            min={0.1}
                                            max={45}
                                            step={0.5}
                                            onChange={e => {
                                                if (isScanning) {
                                                    // Dynamically update the channel range
                                                    const halfAngleDeg = parseFloat(e.target.value);
                                                    if (isNaN(halfAngleDeg) || halfAngleDeg <= 0) return;
                                                    const halfAngleRad = halfAngleDeg * Math.PI / 180;
                                                    const center = activeChannel!.restoreValue ?? (activeChannel!.from + activeChannel!.to) / 2;
                                                    activeChannel!.from = center - halfAngleRad;
                                                    activeChannel!.to = center + halfAngleRad;
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
                                                    // Remember angle, Hz, and axis before removing
                                                    const halfDeg = Math.round((activeChannel!.to - activeChannel!.from) * 90 / Math.PI * 10) / 10;
                                                    const periodMs = activeChannel!.periodMs;
                                                    const axis = currentAxis;
                                                    setGalvoAngles(prev => new Map(prev).set(selectedComponent.id, { halfDeg, periodMs, axis }));
                                                    animator.removeChannel(activeChannel!.id, components);
                                                    if (animator.channels.length === 0) setAnimPlaying(false);
                                                    setChannelVersion(v => v + 1);  // force re-render
                                                } else {
                                                    const axisEl = document.getElementById('galvo-axis-' + selectedComponent.id) as HTMLSelectElement;
                                                    const rangeEl = document.getElementById('galvo-range-' + selectedComponent.id) as HTMLInputElement;
                                                    const axis = axisEl?.value === 'U' ? 'rotation.y' : 'rotation.z';
                                                    const halfAngleDeg = parseFloat(rangeEl?.value || '5');
                                                    const halfAngleRad = halfAngleDeg * Math.PI / 180;
                                                    // Use restoreValue if coming from an existing channel, else current rotation
                                                    const euler = new Euler().setFromQuaternion(selectedComponent.rotation);
                                                    const currentRotVal = axis === 'rotation.y' ? euler.y : euler.z;
                                                    const center = channelCenter || currentRotVal;
                                                    const ch: AnimationChannel = {
                                                        id: generateChannelId(),
                                                        targetId: selectedComponent.id,
                                                        property: axis,
                                                        from: center - halfAngleRad,
                                                        to: center + halfAngleRad,
                                                        easing: 'sinusoidal',
                                                        periodMs: savedSettings?.periodMs ?? 2000,
                                                        repeat: true,
                                                        restoreValue: center,
                                                    };
                                                    animator.addChannel(ch);
                                                    setAnimPlaying(true);
                                                    setChannelVersion(v => v + 1);  // force re-render
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
                                        {isScanning && (
                                            <>
                                                <span style={{ fontSize: '10px', color: '#888', marginLeft: 6 }}>Hz</span>
                                                <input
                                                    type="number"
                                                    defaultValue={Math.round(1000 / activeChannel!.periodMs * 10) / 10}
                                                    key={activeChannel!.id}
                                                    min={0.1}
                                                    max={10000}
                                                    step={0.1}
                                                    onChange={e => {
                                                        const hz = parseFloat(e.target.value);
                                                        if (isNaN(hz) || hz <= 0) return;
                                                        activeChannel!.periodMs = 1000 / hz;
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
                                            </>
                                        )}
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

                {isPolygonScanner && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Polygon Scan Mirror</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <ScrubInput
                                label="Faces"
                                suffix=""
                                value={localPolyFaces}
                                onChange={setLocalPolyFaces}
                                onCommit={(v: string) => {
                                    const val = Math.max(3, Math.round(parseFloat(v)));
                                    if (isNaN(val)) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PolygonScanner) {
                                            c.numFaces = val;
                                            c.recalculate();
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
                                        if (c.id === selection[0] && c instanceof PolygonScanner) {
                                            c.inscribedRadius = val;
                                            c.recalculate();
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
                                label="Height"
                                suffix="mm"
                                value={localPolyHeight}
                                onChange={setLocalPolyHeight}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PolygonScanner) {
                                            c.faceHeight = val;
                                            c.recalculate();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={1}
                                max={30}
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
                                        if (c.id === selection[0] && c instanceof PolygonScanner) {
                                            c.scanAngle = val * Math.PI / 180;
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
                        </div>
                        <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                            Scan per facet = {selectedComponent instanceof PolygonScanner ? Math.round(4 * 180 / selectedComponent.numFaces * 100) / 100 : '—'}°
                            {' · '}
                            R = {selectedComponent instanceof PolygonScanner ? Math.round(selectedComponent.circumRadius * 100) / 100 : '—'} mm
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
                                                // If no channels left, stop playing
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
                        {/* Clocking (rotation around optical axis W) */}
                        <div style={{ borderTop: '1px solid #333', paddingTop: 8, marginTop: 8 }}>
                            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 6 }}>Lens Clocking (W-axis rotation)</label>
                            <ScrubInput
                                label="Clock"
                                suffix="°"
                                value={localCylClocking}
                                onChange={setLocalCylClocking}
                                onCommit={(v: string) => {
                                    const deg = parseFloat(v);
                                    if (isNaN(deg)) return;
                                    const rad = deg * Math.PI / 180;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof CylindricalLens) {
                                            // Get current Euler, modify the X rotation (maps to W/optical axis after π/2 Y rotation)
                                            const euler = new Euler().setFromQuaternion(c.rotation);
                                            euler.x = rad;
                                            c.rotation.setFromEuler(euler);
                                            c.updateMatrices();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1}
                                title="Rotation of the cylindrical axis around the optical axis (W)"
                            />
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
                                suffix="n"
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
                                    value={localR1}
                                    onChange={setLocalR1}
                                    onCommit={(v) => commitGeometry('r1', v)}
                                    speed={2.0}
                                    allowInfinity
                                    title="+ = Convex, − = Concave, 'Infinity' = Flat"
                                />
                                <ScrubInput
                                    label="R2 (Back)"
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

                {isPrism && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Prism Geometry</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
                            <ScrubInput
                                label="Apex Angle"
                                suffix="°"
                                value={localApexAngle}
                                onChange={setLocalApexAngle}
                                onCommit={(v: string) => {
                                    const deg = parseFloat(v);
                                    if (isNaN(deg) || deg <= 0 || deg >= 180) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PrismLens) {
                                            c.apexAngle = deg * Math.PI / 180;
                                            c.invalidateMesh();
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={1.0}
                                min={5}
                                max={170}
                                title="Apex angle of the prism triangle"
                            />
                            <ScrubInput
                                label="IoR"
                                suffix="n"
                                value={localPrismIor}
                                onChange={setLocalPrismIor}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val < 1.0 || val > 3.0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PrismLens) {
                                            c.ior = val;
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
                            <ScrubInput
                                label="Edge Length"
                                suffix="mm"
                                value={localPrismHeight}
                                onChange={setLocalPrismHeight}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PrismLens) {
                                            c.height = val;
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
                        </div>
                    </div>
                )}

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
                                            c.magnification = val;
                                            c.recalculate();
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
                                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Immersion</label>
                                <select
                                    value={localObjImmersion}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setLocalObjImmersion(e.target.value);
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof Objective) {
                                                c.immersionIndex = val;
                                                c.recalculate();
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
                                    <option value="1.0">Air (1.0)</option>
                                    <option value="1.33">Water (1.33)</option>
                                    <option value="1.515">Oil (1.515)</option>
                                </select>
                            </div>
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
                        <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                            f = {selectedComponent instanceof Objective ? Math.round(selectedComponent.focalLength * 100) / 100 : '—'} mm
                            {' · '}
                            optical ∅ = {selectedComponent instanceof Objective ? Math.round(selectedComponent.apertureRadius * 2 * 100) / 100 : '—'} mm
                        </div>
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
                                    min="200"
                                    max="1000"
                                    step="1"
                                    value={localWavelength}
                                    onChange={(e) => {
                                        const newWavelength = parseInt(e.target.value);
                                        setLocalWavelength(newWavelength);

                                        if (selectedComponent && selectedComponent instanceof Laser) {
                                            selectedComponent.wavelength = newWavelength;
                                            setComponents([...components]);
                                        }
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
                                min={0.01}
                                max={100}
                            />
                        </div>
                        <div style={{ fontSize: '10px', color: '#666', marginTop: 6 }}>
                            13-band spectrum (340–820 nm)
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
                                        setComponents([...components]);
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                )}

                {isAperture && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 8 }}>Aperture / Iris</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                            <ScrubInput
                                label="Opening ∅"
                                suffix="mm"
                                value={localApertureDiameter}
                                onChange={setLocalApertureDiameter}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof Aperture) {
                                            c.openingDiameter = Math.min(val, c.housingDiameter - 1);
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.5}
                                min={0.5}
                                max={24}
                                title="Opening diameter of the iris aperture"
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
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof SlitAperture) {
                                            c.slitWidth = Math.min(val, c.housingDiameter - 1);
                                            c.version++;
                                            return c;
                                        }
                                        return c;
                                    });
                                    setComponents([...newComponents]);
                                }}
                                speed={0.3}
                                min={0.1}
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
                                            // Rotate around the optical axis (local X)
                                            const euler = new Euler().setFromQuaternion(c.rotation);
                                            euler.x = rad;
                                            c.rotation.setFromEuler(euler);
                                            c.updateMatrices();
                                            c.version++;
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



                {hasSpectralProfile && (() => {
                    const comp = selectedComponent as (Filter | DichroicMirror);
                    const profile = comp.spectralProfile;
                    const curveData = profile.getSampleCurve(180);
                    const chartW = 250;
                    const chartH = 100;
                    const padL = 0;
                    const padR = 0;
                    const plotW = chartW - padL - padR;

                    // Build the SVG path for the transmission curve
                    const pathPoints = curveData.map((pt, i) => {
                        const x = padL + (i / (curveData.length - 1)) * plotW;
                        const y = chartH - pt.t * chartH;
                        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                    }).join(' ');

                    // Rainbow gradient stops for visible spectrum background
                    const spectrumStops = [
                        { nm: 350, color: '#1a0020' },
                        { nm: 380, color: '#2a0040' },
                        { nm: 420, color: '#4400aa' },
                        { nm: 450, color: '#0000ff' },
                        { nm: 480, color: '#0066ff' },
                        { nm: 500, color: '#00cccc' },
                        { nm: 520, color: '#00ff00' },
                        { nm: 560, color: '#aaff00' },
                        { nm: 580, color: '#ffff00' },
                        { nm: 600, color: '#ff8800' },
                        { nm: 640, color: '#ff0000' },
                        { nm: 700, color: '#aa0000' },
                        { nm: 780, color: '#400000' },
                        { nm: 850, color: '#1a0000' },
                    ];

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

                            {/* Chroma-style Transmission Chart */}
                            <div style={{ marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
                                <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block' }}>
                                    <defs>
                                        <linearGradient id="spectrumGrad" x1="0" x2="1" y1="0" y2="0">
                                            {spectrumStops.map((s, i) => (
                                                <stop key={i} offset={`${((s.nm - 350) / 500) * 100}%`} stopColor={s.color} />
                                            ))}
                                        </linearGradient>
                                    </defs>
                                    {/* Rainbow background */}
                                    <rect x={padL} y="0" width={plotW} height={chartH} fill="url(#spectrumGrad)" opacity="0.4" />
                                    {/* Grid lines */}
                                    {[0.25, 0.5, 0.75].map(t => (
                                        <line key={t} x1={padL} x2={padL + plotW} y1={chartH - t * chartH} y2={chartH - t * chartH} stroke="#555" strokeWidth="0.5" strokeDasharray="2,2" />
                                    ))}
                                    {/* Filled area under curve */}
                                    <path
                                        d={`${pathPoints} L${(padL + plotW).toFixed(1)},${chartH} L${padL},${chartH} Z`}
                                        fill="white" fillOpacity="0.15"
                                    />
                                    {/* Transmission curve */}
                                    <path d={pathPoints} fill="none" stroke="#fff" strokeWidth="2" />
                                    {/* Axis labels */}
                                    <text x={padL + 2} y={chartH - 2} fill="#888" fontSize="8">350</text>
                                    <text x={padL + plotW - 20} y={chartH - 2} fill="#888" fontSize="8">850nm</text>
                                    <text x={padL + 2} y={10} fill="#888" fontSize="8">100%</text>
                                </svg>
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

                            {/* Fluorescence efficiency & absorption */}
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
                                                if (c.id === selection[0] && c instanceof Sample) {
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
                                                if (c.id === selection[0] && c instanceof Sample) {
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
                                </div>
                            </div>
                        </div>
                    );
                })()}


                {/* Card Viewer: E&M beam cross-section + polarization */}
                {selectedComponent instanceof Card && (
                    <CardViewerWithPin
                        card={selectedComponent as Card}
                        pinnedIds={pinnedIds}
                        setPinnedIds={setPinnedIds}
                    />
                )}

                {/* Camera Viewer: Solver 3 render output */}
                {selectedComponent instanceof Camera && (
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
                                if (!rayConfig.solver2Enabled) {
                                    setRayConfig({ ...rayConfig, solver2Enabled: true });
                                }
                                setSolver3Trigger(n => n + 1);
                            }}
                        />
                    </div>
                )}

                {/* PMT Detector: axis binding + raster scan */}
                {isPMT && (() => {
                    const pmt = selectedComponent as PMT;
                    // Find all components with active galvo animation channels
                    const galvoOptions: { compId: string; compName: string; property: string; label: string }[] = [];
                    for (const ch of animator.channels) {
                        if (ch.property === 'rotation.y' || ch.property === 'rotation.z') {
                            const comp = components.find(c => c.id === ch.targetId);
                            if (comp) {
                                const axisLabel = ch.property === 'rotation.y' ? 'U' : 'V';
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
                    const hasScanImage = !!pmt.scanImage;

                    return (
                        <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <label style={{ fontSize: '11px', color: '#666' }}>PMT Raster Scan</label>
                            </div>

                            {galvoOptions.length === 0 && (
                                <div style={{ fontSize: '10px', color: '#666', marginBottom: 8, fontStyle: 'italic' }}>
                                    No galvo channels active. Enable galvo scan on mirrors first.
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
                                const derivedResX = xHz > 0 ? Math.round(pmt.pmtSampleHz / xHz) : '—';
                                const derivedResY = yHz > 0 && xHz > 0 ? Math.round(xHz / yHz) : '—';

                                const hzInputStyle: React.CSSProperties = {
                                    width: '56px', background: '#222', color: '#ccc',
                                    border: '1px solid #555', borderRadius: 3,
                                    fontSize: '10px', padding: '2px 4px', textAlign: 'center',
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
                                                    const yHzNow = yCh ? 1000 / yCh.periodMs : 1;
                                                    pmt.scanResX = Math.max(2, Math.round(pmt.pmtSampleHz / hz));
                                                    pmt.scanResY = Math.max(2, Math.round(hz / yHzNow));
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
                                                    const xHzNow = xCh ? 1000 / xCh.periodMs : 64;
                                                    pmt.scanResY = Math.max(2, Math.round(xHzNow / hz));
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
                                                    const xHzNow = xCh ? 1000 / xCh.periodMs : 64;
                                                    pmt.scanResX = Math.max(2, Math.round(hz / xHzNow));
                                                    pmt.markScanStale();
                                                    pmt.version++;
                                                    setComponents([...components]);
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                style={hzInputStyle}
                                            />
                                            <span style={{ fontSize: '9px', color: '#666' }}>Hz</span>
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#555', marginTop: 4 }}>
                                            Resolution: {derivedResX} × {derivedResY} px
                                        </div>
                                    </div>
                                );
                            })()}
                            {hasAxes && (
                                <div style={{ marginBottom: 8, position: 'relative' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '11px', color: '#aaa' }}>Scan Image</span>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button
                                                onClick={() => {
                                                    if (!rayConfig.solver2Enabled) {
                                                        setRayConfig({ ...rayConfig, solver2Enabled: true });
                                                    }
                                                    // Trigger the PMT raster scan effect
                                                    setScanAccumConfig({ steps: 16, trigger: scanAccumConfig.trigger + 1 });
                                                }}
                                                disabled={isRendering}
                                                title="Re-run raster scan"
                                                style={{
                                                    background: isRendering ? '#333' : '#1a5a2a',
                                                    border: '1px solid #444',
                                                    borderRadius: '3px',
                                                    color: isRendering ? '#666' : '#8f8',
                                                    cursor: isRendering ? 'not-allowed' : 'pointer',
                                                    fontSize: '11px',
                                                    padding: '1px 5px',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                🔄
                                            </button>
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
                                    <canvas
                                        ref={el => {
                                            if (!el) return;
                                            const ctx = el.getContext('2d');
                                            if (!ctx) return;
                                            const w = pmt.scanResX;
                                            const h = pmt.scanResY;
                                            if (pmt.scanImage) {
                                                const img = pmt.scanImage;
                                                let maxVal = 0;
                                                for (let i = 0; i < img.length; i++) if (img[i] > maxVal) maxVal = img[i];
                                                if (maxVal < 1e-12) maxVal = 1;
                                                const imageData = ctx.createImageData(w, h);
                                                for (let y = 0; y < h; y++) {
                                                    for (let x = 0; x < w; x++) {
                                                        const srcIdx = (h - 1 - y) * w + x;
                                                        const v = Math.pow(Math.max(0, Math.min(1, img[srcIdx] / maxVal)), 0.45);
                                                        const dstIdx = (y * w + x) * 4;
                                                        imageData.data[dstIdx + 0] = Math.round(v * 80);
                                                        imageData.data[dstIdx + 1] = Math.round(v * 255);
                                                        imageData.data[dstIdx + 2] = Math.round(v * 80);
                                                        imageData.data[dstIdx + 3] = 255;
                                                    }
                                                }
                                                ctx.putImageData(imageData, 0, 0);
                                            } else {
                                                // Blank black canvas
                                                ctx.fillStyle = '#000';
                                                ctx.fillRect(0, 0, w, h);
                                            }
                                        }}
                                        width={pmt.scanResX}
                                        height={pmt.scanResY}
                                        style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 4, border: '1px solid #333' }}
                                    />
                                    {!hasScanImage && !isRendering && (
                                        <div style={{
                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            borderRadius: 4,
                                            pointerEvents: 'none',
                                        }}>
                                            <span style={{ fontSize: '10px', color: '#555', fontStyle: 'italic' }}>
                                                No scan data yet
                                            </span>
                                        </div>
                                    )}
                                    <div style={{ fontSize: '9px', color: '#555', marginTop: 2 }}>
                                        {pmt.scanResX}×{pmt.scanResY} raster scan
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}


            </div>
        </div>
    );
};

const inputStyle: React.CSSProperties = {
    backgroundColor: '#222',
    border: '1px solid #444',
    color: '#fff',
    padding: '6px',
    borderRadius: '4px',
    width: '100%',
    boxSizing: 'border-box'
};


