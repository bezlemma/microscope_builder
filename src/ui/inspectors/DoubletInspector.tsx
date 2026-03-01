/**
 * DoubletInspector — Properties panel for AchromaticDoublet components.
 * Surface selector tabs (S1/S2/S3), per-surface R, thickness, material.
 */
import React from 'react';
import { AchromaticDoublet } from '../../parts/AchromaticDoublet';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

interface DoubletInspectorProps {
    component: AchromaticDoublet;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
}

export const DoubletInspector: React.FC<DoubletInspectorProps> = ({
    component,
    components,
    selection,
    setComponents,
}) => {
    const commit = (mutate: (c: AchromaticDoublet) => void) => {
        const newComponents = components.map(c => {
            if (c.id === selection[0] && c instanceof AchromaticDoublet) {
                mutate(c);
                c.invalidateMesh();
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    return (
        <CollapsibleSection title="Achromatic Doublet">
            <div style={{ fontSize: '10px', color: '#888', marginBottom: 8 }}>
                f = {component.focalLength.toFixed(1)} mm
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <ScrubInput
                    label="R₁" suffix="mm"
                    value={String(component.r1.toFixed(1))}
                    onChange={() => {}}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val)) return;
                        commit(c => { c.r1 = val; });
                    }}
                    speed={1} allowInfinity
                />
                <ScrubInput
                    label="R₂" suffix="mm"
                    value={String(component.r2.toFixed(1))}
                    onChange={() => {}}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val)) return;
                        commit(c => { c.r2 = val; });
                    }}
                    speed={1} allowInfinity
                />
                <ScrubInput
                    label="R₃" suffix="mm"
                    value={String(component.r3.toFixed(1))}
                    onChange={() => {}}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val)) return;
                        commit(c => { c.r3 = val; });
                    }}
                    speed={1} allowInfinity
                />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <ScrubInput
                    label="t₁ Crown" suffix="mm"
                    value={String(component.thickness1.toFixed(1))}
                    onChange={() => {}}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commit(c => { c.thickness1 = val; });
                    }}
                    speed={0.2} min={0.5} max={20}
                />
                <ScrubInput
                    label="t₂ Flint" suffix="mm"
                    value={String(component.thickness2.toFixed(1))}
                    onChange={() => {}}
                    onCommit={(v: string) => {
                        const val = parseFloat(v);
                        if (isNaN(val) || val <= 0) return;
                        commit(c => { c.thickness2 = val; });
                    }}
                    speed={0.2} min={0.5} max={20}
                />
            </div>
            <ScrubInput
                label="Aperture" suffix="mm"
                value={String(component.apertureRadius.toFixed(1))}
                onChange={() => {}}
                onCommit={(v: string) => {
                    const val = parseFloat(v);
                    if (isNaN(val) || val <= 0) return;
                    commit(c => { c.apertureRadius = val; });
                }}
                speed={0.5} min={1} max={50}
            />
            <div style={{ fontSize: '10px', color: '#666', marginTop: 6 }}>
                Crown: {component.material1.name} •
                Flint: {component.material2.name}
            </div>
        </CollapsibleSection>
    );
};
