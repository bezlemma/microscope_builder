import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { Euler, Quaternion, Vector3 } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
import { Laser } from '../physics/components/Laser';

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
    
    // Laser Params
    const [localWavelength, setLocalWavelength] = useState<number>(532);
    const [localBeamRadius, setLocalBeamRadius] = useState<string>('2');

    // Sync local state when selection or actual values change externally
    useEffect(() => {
        if (selectedComponent) {
            setLocalX(String(Math.round(selectedComponent.position.x * 100) / 100));
            setLocalY(String(Math.round(selectedComponent.position.y * 100) / 100));
            
            // Rotation around Z (World Up) - extract the world-space Z rotation
            // For optical components, the optical axis (local +Z) is rotated to world space.
            // The world-Z rotation is the angle of this axis projected onto the XY plane.
            const forwardLocal = new Vector3(0, 0, 1);
            const forwardWorld = forwardLocal.clone().applyQuaternion(selectedComponent.rotation);
            const worldZAngle = Math.atan2(forwardWorld.y, forwardWorld.x);
            const zDeg = Math.round(worldZAngle * 180 / Math.PI);
            setLocalRot(String(zDeg));

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
            }
            if (selectedComponent instanceof Laser) {
                setLocalWavelength(selectedComponent.wavelength);
                setLocalBeamRadius(String(selectedComponent.beamRadius));
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

    const commitGeometry = (param: 'width'|'height'|'radius'|'focal', valueStr: string) => {
        if (!selectedComponent) return;
        const val = parseFloat(valueStr);
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
                }
                return c; // Mutable update inside map, but we trigger re-render via setComponents
            }
            return c;
        });
        // Force new creation? Map creates new array. Objects mutated? 
        // Ideally we should clone the object but physics objects are class instances.
        // Jotai atom update will trigger React re-render if array reference changes.
        // Visualizers read props. If object is same reference but mutated, React might not see deep change unless forceUpdate?
        // Actually, map returns same object references.
        // Let's rely on standard React behavior: Array changed = Re-render.
        // But visualizer prop check? Visualizers take { component }.
        // If Component object is mutated, Visualizer might not update if memoized.
        // But we are passing new array.
        // To be safe, we can clone? No, copy methods are complex.
        // Let's assume re-render of Parent (OpticalTable) re-renders children Visualizers.
        // OpticalTable maps over components.
        
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
    const isLaser = selectedComponent instanceof Laser;
    
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
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, borderTop: '1px solid #444', paddingTop: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Radius (mm)</label>
                            <input 
                                type="text" 
                                value={localRadius}
                                onChange={(e) => setLocalRadius(e.target.value)}
                                onBlur={() => commitGeometry('radius', localRadius)}
                                onKeyDown={(e) => handleKeyDown(e, () => commitGeometry('radius', localRadius))}
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Focal Len (mm)</label>
                            <input 
                                type="text" 
                                value={localFocal}
                                onChange={(e) => setLocalFocal(e.target.value)}
                                onBlur={() => commitGeometry('focal', localFocal)}
                                onKeyDown={(e) => handleKeyDown(e, () => commitGeometry('focal', localFocal))}
                                style={inputStyle}
                            />
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
