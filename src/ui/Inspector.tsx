import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { Euler, Quaternion, Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Laser } from '../physics/components/Laser';
import { IdealLens } from '../physics/components/IdealLens';
import { Objective } from '../physics/components/Objective';
import { PrismLens } from '../physics/components/PrismLens';
import { ScrubInput } from './ScrubInput';

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

export const Inspector: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    
    // Derived state
    const selectedComponent = components.find(c => c.id === selection);
    
    // Local state for inputs
    const [localX, setLocalX] = useState<string>('0');
    const [localY, setLocalY] = useState<string>('0');
    const [localRot, setLocalRot] = useState<string>('0');
    
    // Geometry Params
    const [localWidth, setLocalWidth] = useState<string>('0');
    const [localHeight, setLocalHeight] = useState<string>('0');
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

    // Sync local state when selection or actual values change externally
    useEffect(() => {
        if (selectedComponent) {
            try {
                setLocalX(String(Math.round(selectedComponent.position.x * 100) / 100));
                setLocalY(String(Math.round(selectedComponent.position.y * 100) / 100));
                
                // Rotation around Z (World Up) - extract the world-space Z rotation
                // For optical components, the optical axis (local +Z) is rotated to world space.
                // The world-Z rotation is the angle of this axis projected onto the XY plane.
                if (selectedComponent.rotation) {
                    const forwardLocal = new Vector3(0, 0, 1);
                    const forwardWorld = forwardLocal.clone().applyQuaternion(selectedComponent.rotation);
                    const worldZAngle = Math.atan2(forwardWorld.y, forwardWorld.x);
                    const zDeg = Math.round(worldZAngle * 180 / Math.PI);
                    setLocalRot(String(zDeg));
                }

                // Type specific params
                if (selectedComponent instanceof Mirror || selectedComponent instanceof Blocker || selectedComponent instanceof Card) {
                    // Check if properties exist (TS might complain if not cast, relying on JS flexibility or cast)
                    const c = selectedComponent as any;
                    if (c.width != null) setLocalWidth(String(c.width));
                    if (c.height != null) setLocalHeight(String(c.height));
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
                        setLocalR1(Math.abs(radii.R1) >= 1e6 ? "Infinity" : String(Math.round(radii.R1 * 100)/100));
                        setLocalR2(Math.abs(radii.R2) >= 1e6 ? "Infinity" : String(Math.round(radii.R2 * 100)/100));
                    } else {
                        const R = f !== 0 ? (2 * (selectedComponent.ior - 1)) * f : 1e9;
                        setLocalR1(String(Math.round(R * 100)/100));
                        setLocalR2(String(Math.round(-R * 100)/100));
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
            } catch (err) {
                console.error("Inspector Update Error:", err);
            }
        }
    }, [selectedComponent, selection, 
        selectedComponent?.position.x, 
        selectedComponent?.position.y, 
        selectedComponent?.rotation.x,
        selectedComponent?.rotation.y,
        selectedComponent?.rotation.z,
        selectedComponent?.rotation.w
    ]);

    // Handlers
    // ... existing commitPosition ...
    const commitPosition = (axis: 'x'|'y'|'z', valueStr: string) => { /* ... same ... */ 
        if (!selectedComponent) return;
        const val = parseFloat(valueStr);
        if (isNaN(val)) return; 
        
        const newComponents = components.map(c => {
            if (c.id === selection) {
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
            if (c.id === selection) {
                // Use same logic as scroll wheel in GlobalRotation.tsx:
                // The rotation value is the WORLD Z rotation (spin on the table).
                // Start from the component's base rotation and apply desired world-Z rotation.
                
                const zRotRad = val * Math.PI / 180;
                
                // Base rotation: 90° around Y aligns local Z with world X for optical components
                // For non-optical components, base is identity
                const needsBaseYRotation = c.constructor.name === 'Objective' || 
                                          c.constructor.name === 'SphericalLens' ||
                                          c.constructor.name === 'Sample' ||
                                          c.constructor.name === 'Camera';
                
                // Create base quaternion
                const baseQuat = new Quaternion();
                if (needsBaseYRotation) {
                    baseQuat.setFromEuler(new Euler(0, Math.PI / 2, 0));
                }
                
                // Apply world-Z rotation on top (premultiply to rotate in world space)
                const worldZQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), zRotRad);
                const finalQuat = worldZQuat.multiply(baseQuat);
                
                // Extract euler and set
                const euler = new Euler().setFromQuaternion(finalQuat);
                c.setRotation(euler.x, euler.y, euler.z);
                return c;
            }
            return c;
        });
        setComponents(newComponents);
    };

    const commitGeometry = (param: 'width'|'height'|'radius'|'focal'|'r1'|'r2'|'thickness'|'ior', valueStr: string) => {
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
            if (c.id === selection) {
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
                fontFamily: 'sans-serif'
            }}>
                <div style={{ color: '#888', fontStyle: 'italic' }}>No selection</div>
            </div>
        );
    }

    const isRect = selectedComponent instanceof Mirror || selectedComponent instanceof Blocker || selectedComponent instanceof Card;
    const isLens = selectedComponent instanceof SphericalLens;
    const isIdealLens = selectedComponent instanceof IdealLens;
    const isObjective = selectedComponent instanceof Objective;
    const isLaser = selectedComponent instanceof Laser;
    const isPrism = selectedComponent instanceof PrismLens;
    
    const commitLaserParams = () => {
        if (!selectedComponent || !(selectedComponent instanceof Laser)) return;
        const radius = parseFloat(localBeamRadius);
        if (isNaN(radius)) return;
        
        const newComponents = components.map(c => {
            if (c.id === selection && c instanceof Laser) {
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
                {/* Position Group */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Position X (mm)</label>
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
                        <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Position Y (mm)</label>
                        <input 
                            type="text" 
                            value={localY}
                            onChange={(e) => setLocalY(e.target.value)}
                            onBlur={() => commitPosition('y', localY)}
                            onKeyDown={(e) => handleKeyDown(e, () => commitPosition('y', localY))}
                            style={inputStyle}
                        />
                    </div>
                </div>

                {/* Rotation Group */}
                <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Rotation (deg)</label>
                    <input 
                        type="text" 
                        value={localRot}
                        onChange={(e) => setLocalRot(e.target.value)}
                        onBlur={() => commitRotation(localRot)}
                        onKeyDown={(e) => handleKeyDown(e, () => commitRotation(localRot))}
                        style={{ ...inputStyle, width: '100%' }}
                    />
                </div>
                
                {/* Dynamic Properties */}
                {isRect && (
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
                                            if (c.id === selection && c instanceof SphericalLens) {
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
                                            if (c.id === selection && c instanceof PrismLens) {
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
                                        if (c.id === selection && c instanceof PrismLens) {
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
                                        if (c.id === selection && c instanceof PrismLens) {
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
                                        if (c.id === selection && c instanceof PrismLens) {
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
                                        if (c.id === selection && c instanceof PrismLens) {
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
                                        if (c.id === selection && c instanceof IdealLens) {
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
                                        if (c.id === selection && c instanceof IdealLens) {
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
                                        if (c.id === selection && c instanceof Objective) {
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
                                        if (c.id === selection && c instanceof Objective) {
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
                                            if (c.id === selection && c instanceof Objective) {
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
                                        if (c.id === selection && c instanceof Objective) {
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


                <div style={{ fontSize: '11px', color: '#666', marginTop: 5 }}>
                    ID: {selectedComponent.id.substring(0,8)}
                </div>

                <button 
                    onClick={() => {
                        setComponents(components.filter(c => c.id !== selection));
                        setSelection(null);
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
