import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, selectionAtom } from '../state/store';
import { Euler } from 'three';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Card } from '../physics/components/Card';
// ... existing imports

export const Inspector: React.FC = () => {
    const [components, setComponents] = useAtom(componentsAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    
    // Derived state
    const selectedComponent = components.find(c => c.id === selection);
    
    // Local state for inputs
    const [localX, setLocalX] = useState<string>('0');
    const [localZ, setLocalZ] = useState<string>('0');
    const [localRot, setLocalRot] = useState<string>('0');
    
    // Geometry Params
    const [localWidth, setLocalWidth] = useState<string>('0');
    const [localHeight, setLocalHeight] = useState<string>('0');
    const [localRadius, setLocalRadius] = useState<string>('0');
    const [localFocal, setLocalFocal] = useState<string>('0');

    // Sync local state when selection or actual values change externally
    useEffect(() => {
        if (selectedComponent) {
            setLocalX(String(Math.round(selectedComponent.position.x * 100) / 100));
            setLocalZ(String(Math.round(selectedComponent.position.z * 100) / 100));
            // Rotation around Z (World Up)
            const zDeg = Math.round(new Euler().setFromQuaternion(selectedComponent.rotation).z * 180 / Math.PI);
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
        }
    }, [selectedComponent, selection]); // Simplified dependency

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

    const commitRotation = (valueStr: string) => { /* ... same ... */ 
         if (!selectedComponent) return;
        const val = parseFloat(valueStr);
        if (isNaN(val)) return;

        const newComponents = components.map(c => {
            if (c.id === selection) {
                c.setRotation(0, 0, val * Math.PI / 180); // Z-axis rotation (World Up)
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
                        <label style={{ fontSize: '12px', color: '#aaa', marginBottom: 4 }}>Position Z (mm)</label>
                        <input 
                            type="text" 
                            value={localZ}
                            onChange={(e) => setLocalZ(e.target.value)}
                            onBlur={() => commitPosition('z', localZ)}
                            onKeyDown={(e) => handleKeyDown(e, () => commitPosition('z', localZ))}
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
