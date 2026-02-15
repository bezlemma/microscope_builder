import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom, pinnedViewersAtom, rayConfigAtom } from '../state/store';
import { Euler, Quaternion, Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Laser } from '../physics/components/Laser';
import { IdealLens } from '../physics/components/IdealLens';
import { Objective } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import { Waveplate } from '../physics/components/Waveplate';
import { Aperture } from '../physics/components/Aperture';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { SpectralProfile, ProfilePreset } from '../physics/SpectralProfile';
import { ScrubInput } from './ScrubInput';
import { CardViewer } from './CardViewer';

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

export const Inspector: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [rayConfig, setRayConfig] = useAtom(rayConfigAtom);

    // Derived state — only show single-component properties when exactly 1 is selected
    const selectedComponent = selection.length === 1
        ? components.find(c => c.id === selection[0])
        : undefined;

    // Local state for inputs
    const [localX, setLocalX] = useState<string>('0');
    const [localY, setLocalY] = useState<string>('0');
    const [localRot, setLocalRot] = useState<string>('0');

    // Geometry Params (Card)
    const [localWidth, setLocalWidth] = useState<string>('0');
    const [localHeight, setLocalHeight] = useState<string>('0');

    // Mirror Params
    const [localMirrorDiameter, setLocalMirrorDiameter] = useState<string>('25');
    const [localMirrorThickness, setLocalMirrorThickness] = useState<string>('2');

    // Blocker Params
    const [localBlockerDiameter, setLocalBlockerDiameter] = useState<string>('20');
    const [localBlockerThickness, setLocalBlockerThickness] = useState<string>('5');
    const [localRadius, setLocalRadius] = useState<string>('0');
    const [localFocal, setLocalFocal] = useState<string>('0');
    const [localR1, setLocalR1] = useState<string>('0');
    const [localR2, setLocalR2] = useState<string>('0');
    const [localThickness, setLocalThickness] = useState<string>('0');
    const [localIor, setLocalIor] = useState<string>('1.5');
    const [localLensType, setLocalLensType] = useState<string>('biconvex');

    // IdealLens Params
    const [localIdealFocal, setLocalIdealFocal] = useState<string>('50');
    const [localIdealAperture, setLocalIdealAperture] = useState<string>('15');

    // Objective Params
    const [localObjNA, setLocalObjNA] = useState<string>('0.25');
    const [localObjMag, setLocalObjMag] = useState<string>('10');
    const [localObjImmersion, setLocalObjImmersion] = useState<string>('1.0');
    const [localObjWD, setLocalObjWD] = useState<string>('10');

    // Laser Params
    const [localWavelength, setLocalWavelength] = useState<number>(532);
    const [localBeamRadius, setLocalBeamRadius] = useState<string>('2');

    // Prism Params
    const [localApexAngle, setLocalApexAngle] = useState<string>('60');
    const [localPrismHeight, setLocalPrismHeight] = useState<string>('20');
    const [localPrismWidth, setLocalPrismWidth] = useState<string>('20');
    const [localPrismIor, setLocalPrismIor] = useState<string>('1.5168');

    // Aperture Params
    const [localApertureDiameter, setLocalApertureDiameter] = useState<string>('10');

    // Spectral Profile Params (shared by Filter & Dichroic)
    const [localSpectralPreset, setLocalSpectralPreset] = useState<ProfilePreset>('bandpass');
    const [localSpectralCutoff, setLocalSpectralCutoff] = useState<string>('500');
    const [localSpectralCenter, setLocalSpectralCenter] = useState<string>('525');
    const [localSpectralWidth, setLocalSpectralWidth] = useState<string>('50');
    const [localSpectralSteepness, setLocalSpectralSteepness] = useState<string>('15');

    // Sync local state when selection or actual values change externally
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

                // Type specific params
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

                    // Lens type detection
                    if (typeof selectedComponent.getLensType === 'function') {
                        setLocalLensType(selectedComponent.getLensType());
                    }

                    // Radii
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
                }
                if (selectedComponent instanceof Laser) {
                    setLocalWavelength(selectedComponent.wavelength);
                    setLocalBeamRadius(String(selectedComponent.beamRadius));
                }
                if (selectedComponent instanceof PrismLens) {
                    setLocalApexAngle(String(Math.round(selectedComponent.apexAngle * 180 / Math.PI * 100) / 100));
                    setLocalPrismHeight(String(selectedComponent.height));
                    setLocalPrismWidth(String(selectedComponent.width));
                    setLocalPrismIor(String(selectedComponent.ior));
                }
                if (selectedComponent instanceof Aperture) {
                    setLocalApertureDiameter(String(Math.round(selectedComponent.openingDiameter * 100) / 100));
                }
                if (selectedComponent instanceof Filter) {
                    const sp = selectedComponent.spectralProfile;
                    setLocalSpectralPreset(sp.preset);
                    setLocalSpectralCutoff(String(sp.cutoffNm));
                    setLocalSpectralSteepness(String(sp.edgeSteepness));
                    if (sp.bands.length > 0) {
                        setLocalSpectralCenter(String(sp.bands[0].center));
                        setLocalSpectralWidth(String(sp.bands[0].width));
                    }
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
                }
            } catch (err) {
                console.error("Inspector Update Error:", err);
            }
        }
    }, [selectedComponent, selection, components]);

    // Handlers
    // ... existing commitPosition ...
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

        // Handle "Infinity" case for radii
        let val: number;
        if (valueStr.toLowerCase() === 'infinity') {
            val = 1e9;
        } else {
            val = parseFloat(valueStr);
        }

        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0]) {
                // TypeScript casting to access specific props
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
                    c.r1 = val;
                    if (c.r2 === undefined) {
                        const old = c.getRadii();
                        c.r2 = old.R2;
                    }
                }
                if (param === 'r2' && c instanceof SphericalLens) {
                    c.r2 = val;
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

    // ... handleKeyDown ...
    const handleKeyDown = (e: React.KeyboardEvent, commitFn: () => void) => {
        if (e.key === 'Enter') {
            commitFn();
            (e.target as HTMLInputElement).blur();
        }
    };

    if (!selectedComponent) {
        return (
            <div style={{
                position: 'absolute',
                top: 20,
                right: 20,
                width: 280,
                backgroundColor: 'rgba(30, 30, 30, 0.9)',
                color: 'white',
                padding: 15,
                borderRadius: 8,
                border: '1px solid #444',
                fontFamily: 'sans-serif',
                fontSize: '12px',
            }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Physics Solvers</div>

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
                <div
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 8 }}
                >
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

                    {/* E-field visualization toggle (eyeball) */}
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

                {/* Solver 3: Wave (Placeholder) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.5, marginTop: 4 }}>
                    <input type="checkbox" disabled />
                    <span>Wave (WIP)</span>
                </div>
            </div>
        );
    }

    const isCard = selectedComponent instanceof Card;
    const isMirror = selectedComponent instanceof Mirror;
    const isBlocker = selectedComponent instanceof Blocker;
    const isLens = selectedComponent instanceof SphericalLens;
    const isIdealLens = selectedComponent instanceof IdealLens;
    const isObjective = selectedComponent instanceof Objective;
    const isLaser = selectedComponent instanceof Laser;
    const isPrism = selectedComponent instanceof PrismLens;
    const isWaveplate = selectedComponent instanceof Waveplate;
    const isAperture = selectedComponent instanceof Aperture;
    const isFilter = selectedComponent instanceof Filter;
    const isDichroic = selectedComponent instanceof DichroicMirror;
    const hasSpectralProfile = isFilter || isDichroic;

    const commitLaserParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof Laser)) return;
        const radius = parseFloat(localBeamRadius);
        if (isNaN(radius)) return;

        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Laser) {
                c.wavelength = localWavelength;
                c.beamRadius = radius;
                return c;
            }
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
            padding: 20,
            borderRadius: 8,
            border: '1px solid #444',
            fontFamily: 'Inter, sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
        }}>
            <h3 style={{ marginTop: 0, marginBottom: 15, borderBottom: '1px solid #555', paddingBottom: 10 }}>
                {selectedComponent.name}
            </h3>

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
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '10px', color: '#888', marginBottom: 2 }}>Rot°</label>
                        <input
                            type="text"
                            value={localRot}
                            onChange={(e) => setLocalRot(e.target.value)}
                            onBlur={() => commitRotation(localRot)}
                            onKeyDown={(e) => handleKeyDown(e, () => commitRotation(localRot))}
                            style={inputStyle}
                        />
                    </div>
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
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
                        {/* Shape Presets */}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Shape</label>
                            <select
                                value={
                                    Math.abs(parseFloat(localApexAngle) - 60) < 0.5 ? 'equilateral' :
                                        Math.abs(parseFloat(localApexAngle) - 90) < 0.5 ? 'right-angle' :
                                            Math.abs(parseFloat(localApexAngle) - 45) < 0.5 ? '45-degree' : 'custom'
                                }
                                onChange={(e) => {
                                    const type = e.target.value;
                                    let angle = 60;
                                    if (type === 'right-angle') angle = 90;
                                    else if (type === '45-degree') angle = 45;
                                    setLocalApexAngle(String(angle));
                                    if (selectedComponent instanceof PrismLens) {
                                        const newComponents = components.map(c => {
                                            if (c.id === selection[0] && c instanceof PrismLens) {
                                                c.apexAngle = angle * Math.PI / 180;
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
                                <option value="equilateral">Equilateral (60°)</option>
                                <option value="45-degree">45° Prism</option>
                                <option value="right-angle">Right-Angle (90°)</option>
                                <option value="custom">Custom</option>
                            </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
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
                                label="Height"
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
                            <ScrubInput
                                label="Width"
                                suffix="mm"
                                value={localPrismWidth}
                                onChange={setLocalPrismWidth}
                                onCommit={(v: string) => {
                                    const val = parseFloat(v);
                                    if (isNaN(val) || val <= 0) return;
                                    const newComponents = components.map(c => {
                                        if (c.id === selection[0] && c instanceof PrismLens) {
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
                        <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                            f = {selectedComponent instanceof Objective ? Math.round(selectedComponent.focalLength * 100) / 100 : '—'} mm
                            {' · '}
                            ∅ = {selectedComponent instanceof Objective ? Math.round(selectedComponent.apertureRadius * 2 * 100) / 100 : '—'} mm
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
                                        // Immediately commit wavelength change
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

                        {/* Beam Radius */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Beam Radius (mm)</label>
                            <input
                                type="text"
                                value={localBeamRadius}
                                onChange={(e) => setLocalBeamRadius(e.target.value)}
                                onBlur={commitLaserParams}
                                onKeyDown={(e) => handleKeyDown(e, commitLaserParams)}
                                style={inputStyle}
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

                    const commitSpectral = () => {
                        const cutoff = parseFloat(localSpectralCutoff) || 500;
                        const center = parseFloat(localSpectralCenter) || 525;
                        const width = parseFloat(localSpectralWidth) || 50;
                        const steep = parseFloat(localSpectralSteepness) || 15;

                        const newProfile = new SpectralProfile(
                            localSpectralPreset,
                            cutoff,
                            localSpectralPreset === 'bandpass' || localSpectralPreset === 'multiband'
                                ? [{ center, width }]
                                : profile.bands,
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
                                        const newProfile = new SpectralProfile(
                                            preset, cutoff,
                                            preset === 'bandpass' || preset === 'multiband' ? [{ center, width }] : profile.bands,
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
                                        onCommit={commitSpectral}
                                        speed={2}
                                        min={350}
                                        max={850}
                                    />
                                )}
                                {(localSpectralPreset === 'bandpass' || localSpectralPreset === 'multiband') && (
                                    <>
                                        <ScrubInput
                                            label="Center"
                                            suffix="nm"
                                            value={localSpectralCenter}
                                            onChange={setLocalSpectralCenter}
                                            onCommit={commitSpectral}
                                            speed={2}
                                            min={350}
                                            max={850}
                                        />
                                        <ScrubInput
                                            label="Width"
                                            suffix="nm"
                                            value={localSpectralWidth}
                                            onChange={setLocalSpectralWidth}
                                            onCommit={commitSpectral}
                                            speed={1}
                                            min={5}
                                            max={300}
                                        />
                                    </>
                                )}
                                <ScrubInput
                                    label="Edge"
                                    suffix="nm"
                                    value={localSpectralSteepness}
                                    onChange={setLocalSpectralSteepness}
                                    onCommit={commitSpectral}
                                    speed={0.5}
                                    min={1}
                                    max={50}
                                    title="Edge steepness — smaller = sharper transition"
                                />
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

                <div style={{ fontSize: '11px', color: '#666', marginTop: 5 }}>
                    ID: {selectedComponent.id.substring(0, 8)}
                </div>

                <button
                    onClick={() => {
                        setComponents(components.filter(c => c.id !== selection[0]));
                        setSelection([]);
                    }}
                    style={deleteButtonStyle}
                >
                    Delete Component
                </button>
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

const deleteButtonStyle: React.CSSProperties = {
    marginTop: 20,
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    padding: '8px',
    borderRadius: '4px',
    cursor: 'pointer',
    width: '100%',
    fontWeight: 'bold'
};
