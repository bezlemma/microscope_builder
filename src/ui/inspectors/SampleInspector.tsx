/**
 * SampleInspector — Properties panel for Sample/LXSampleHolder components.
 * Fluorescence spectra, absorption, specimen orientation.
 */
import React from 'react';
import { Sample } from '../../parts/Sample';
import { LXSampleHolder } from '../../parts/LXSampleHolder';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

interface SampleInspectorProps {
    component: Sample | LXSampleHolder;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
    commitSpecimenRotation: (axis: 'x' | 'y' | 'z', v: string) => void;
    commitSpecimenOffset: (axis: 'x' | 'y' | 'z', v: string) => void;
}

export const SampleInspector: React.FC<SampleInspectorProps> = ({
    component,
    components: _components,
    selection: _selection,
    setComponents: _setComponents,
    commitSpecimenRotation,
    commitSpecimenOffset,
}) => {
    const isChamber = component instanceof LXSampleHolder;
    const sample = isChamber ? component as LXSampleHolder : component as Sample;

    return (
        <CollapsibleSection title={isChamber ? 'Sample Chamber' : 'Specimen'}>
            {/* Fluorescence info */}
            <div style={{ fontSize: '10px', color: '#888', marginBottom: 8 }}>
                Absorption: {sample.absorption.toFixed(1)}
                {' · '}
                Efficiency: {(sample.fluorescenceEfficiency * 1e4).toFixed(1)}×10⁻⁴
            </div>

            {/* Specimen Rotation */}
            <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Specimen Rotation (°)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <ScrubInput
                        label="Rx" suffix="°"
                        value={String((sample.specimenRotation.x * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenRotation('x', v)}
                        speed={1}
                    />
                    <ScrubInput
                        label="Ry" suffix="°"
                        value={String((sample.specimenRotation.y * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenRotation('y', v)}
                        speed={1}
                    />
                    <ScrubInput
                        label="Rz" suffix="°"
                        value={String((sample.specimenRotation.z * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenRotation('z', v)}
                        speed={1}
                    />
                </div>
            </div>

            {/* Specimen Offset */}
            <div>
                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Specimen Offset (mm)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <ScrubInput
                        label="Ox" suffix="mm"
                        value={String(sample.specimenOffset.x.toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenOffset('x', v)}
                        speed={0.5}
                    />
                    <ScrubInput
                        label="Oy" suffix="mm"
                        value={String(sample.specimenOffset.y.toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenOffset('y', v)}
                        speed={0.5}
                    />
                    <ScrubInput
                        label="Oz" suffix="mm"
                        value={String(sample.specimenOffset.z.toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v) => commitSpecimenOffset('z', v)}
                        speed={0.5}
                    />
                </div>
            </div>
        </CollapsibleSection>
    );
};
