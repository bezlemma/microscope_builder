/**
 * LensInspector — Properties panel for SphericalLens components.
 * Lens type, focal length, aperture, R1/R2, thickness, IoR.
 * Advanced: dispersion material selection.
 */
import React from 'react';
import { SphericalLens } from '../../parts/SphericalLens';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

interface LensInspectorProps {
    component: SphericalLens;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
    localLensType: string;
    setLocalLensType: (v: string) => void;
    localFocalLength: string;
    setLocalFocalLength: (v: string) => void;
    localRadius: string;
    setLocalRadius: (v: string) => void;
    localThickness: string;
    setLocalThickness: (v: string) => void;
    localIor: string;
    setLocalIor: (v: string) => void;
    localR1: string;
    setLocalR1: (v: string) => void;
    localR2: string;
    setLocalR2: (v: string) => void;
    commitGeometry: (param: string, valueStr: string) => void;
}

export const LensInspector: React.FC<LensInspectorProps> = ({
    component,
    components,
    selection,
    setComponents,
    localLensType, setLocalLensType,
    localFocalLength, setLocalFocalLength,
    localRadius, setLocalRadius,
    localThickness, setLocalThickness,
    localIor, setLocalIor,
    localR1, setLocalR1,
    localR2, setLocalR2,
    commitGeometry,
}) => {
    return (
        <CollapsibleSection title="Lens Properties">
            {/* Lens Type Selector */}
            <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: 4 }}>Lens Type</label>
                <select
                    value={localLensType}
                    onChange={(e) => {
                        const type = e.target.value;
                        setLocalLensType(type);
                        if (component instanceof SphericalLens) {
                            const newComponents = components.map(c => {
                                if (c.id === selection[0] && c instanceof SphericalLens) {
                                    switch (type) {
                                        case 'biconvex': c.r1 = 50; c.r2 = -50; break;
                                        case 'planoconvex': c.r1 = 50; c.r2 = Infinity; break;
                                        case 'meniscus': c.r1 = 30; c.r2 = 50; break;
                                        case 'biconcave': c.r1 = -50; c.r2 = 50; break;
                                        case 'planoconcave': c.r1 = -50; c.r2 = Infinity; break;
                                    }
                                    c.invalidateMesh();
                                }
                                return c;
                            });
                            setComponents([...newComponents]);
                        }
                    }}
                    style={{
                        width: '100%', padding: '4px 6px',
                        background: '#222', color: '#ccc',
                        border: '1px solid #555', borderRadius: 4,
                        fontSize: '11px', cursor: 'pointer',
                    }}
                >
                    <option value="biconvex">Biconvex</option>
                    <option value="planoconvex">Plano-Convex</option>
                    <option value="meniscus">Meniscus</option>
                    <option value="biconcave">Biconcave</option>
                    <option value="planoconcave">Plano-Concave</option>
                </select>
            </div>

            {/* Core geometry */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <ScrubInput
                    label="Focal Length" suffix="mm"
                    value={localFocalLength} onChange={setLocalFocalLength}
                    onCommit={(v) => commitGeometry('focal', v)}
                    speed={1}
                />
                <ScrubInput
                    label="Aperture" suffix="mm"
                    value={localRadius} onChange={setLocalRadius}
                    onCommit={(v) => commitGeometry('radius', v)}
                    speed={0.5} min={0.5} max={100}
                />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
                <ScrubInput
                    label="Thickness" suffix="mm"
                    value={localThickness} onChange={setLocalThickness}
                    onCommit={(v) => commitGeometry('thickness', v)}
                    speed={0.2} min={0.5} max={50}
                />
                <ScrubInput
                    label="IoR" suffix=""
                    value={localIor} onChange={setLocalIor}
                    onCommit={(v) => commitGeometry('ior', v)}
                    speed={0.01} min={1.0} max={3.0}
                />
            </div>

            {/* Surface Radii */}
            <div style={{ borderTop: '1px solid #333', paddingTop: 8, marginTop: 8 }}>
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: 6 }}>Surface Radii (drag labels ↔ to scrub)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <ScrubInput
                        label="R1 (Front)"
                        value={localR1} onChange={setLocalR1}
                        onCommit={(v) => commitGeometry('r1', v)}
                        speed={2.0} allowInfinity
                        title="− = Convex, + = Concave, 'Infinity' = Flat"
                    />
                    <ScrubInput
                        label="R2 (Back)"
                        value={localR2} onChange={setLocalR2}
                        onCommit={(v) => commitGeometry('r2', v)}
                        speed={2.0} allowInfinity
                        title="− = Convex, + = Concave, 'Infinity' = Flat"
                    />
                </div>
            </div>
        </CollapsibleSection>
    );
};
