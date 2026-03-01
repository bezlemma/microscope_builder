/**
 * ObjectiveInspector — Properties panel for Objective components.
 * Magnification, NA, immersion, WD, barrel diameter.
 */
import React from 'react';
import { Objective } from '../../parts/Objective';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

interface ObjectiveInspectorProps {
    component: Objective;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
    localObjMag: string;
    setLocalObjMag: (v: string) => void;
    localObjNA: string;
    setLocalObjNA: (v: string) => void;
    localObjImmersion: string;
    setLocalObjImmersion: (v: string) => void;
    localObjWD: string;
    setLocalObjWD: (v: string) => void;
    localObjDiameter: string;
    setLocalObjDiameter: (v: string) => void;
}

export const ObjectiveInspector: React.FC<ObjectiveInspectorProps> = ({
    component,
    components,
    selection,
    setComponents,
    localObjMag, setLocalObjMag,
    localObjNA, setLocalObjNA,
    localObjImmersion, setLocalObjImmersion,
    localObjWD, setLocalObjWD,
    localObjDiameter, setLocalObjDiameter,
}) => {
    const commitObjective = (mutate: (c: Objective) => void) => {
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof Objective) {
                mutate(c);
                c.recalculate();
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    return (
        <CollapsibleSection title="Aplanatic Phase Surface">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <ScrubInput
                    label="Mag" suffix="x"
                    value={localObjMag} onChange={setLocalObjMag}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commitObjective(c => { c.magnification = val; });
                    }}
                    speed={0.5} min={1} max={200}
                />
                <ScrubInput
                    label="NA" suffix=""
                    value={localObjNA} onChange={setLocalObjNA}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commitObjective(c => { c.NA = val; });
                    }}
                    speed={0.05} min={0.01} max={1.7}
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
                            commitObjective(c => { c.immersionIndex = val; });
                        }}
                        style={{
                            width: '100%', background: '#333', color: '#ccc',
                            border: '1px solid #555', borderRadius: 4,
                            padding: '4px 6px', fontSize: '12px'
                        }}
                    >
                        <option value="1.0">Air (1.0)</option>
                        <option value="1.33">Water (1.33)</option>
                        <option value="1.515">Oil (1.515)</option>
                    </select>
                </div>
                <ScrubInput
                    label="WD" suffix="mm"
                    value={localObjWD} onChange={setLocalObjWD}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commitObjective(c => { c.workingDistance = val; c.version++; });
                    }}
                    speed={0.5} min={0.1} max={50}
                />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 8 }}>
                <ScrubInput
                    label="Barrel ∅" suffix="mm"
                    value={localObjDiameter} onChange={setLocalObjDiameter}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commitObjective(c => { c.diameter = val; c.version++; });
                    }}
                    speed={0.5} min={1} max={50}
                />
            </div>
            <div style={{ marginTop: 6, fontSize: '10px', color: '#555' }}>
                f = {Math.round(component.focalLength * 100) / 100} mm
                {' · '}
                optical ∅ = {Math.round(component.apertureRadius * 2 * 100) / 100} mm
            </div>
        </CollapsibleSection>
    );
};
