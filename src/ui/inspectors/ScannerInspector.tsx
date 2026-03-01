/**
 * ScannerInspector — Properties panel for PolygonScanner + GalvoScanHead.
 * Faces, inscribed radius, height, scan angle.
 */
import React from 'react';
import { PolygonScanner } from '../../parts/PolygonScanner';
import { GalvoScanHead } from '../../parts/GalvoScanHead';
import { DualGalvoScanHead } from '../../parts/DualGalvoScanHead';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

interface ScannerInspectorProps {
    component: PolygonScanner | GalvoScanHead | DualGalvoScanHead;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
}

export const ScannerInspector: React.FC<ScannerInspectorProps> = ({
    component,
    components,
    selection,
    setComponents,
}) => {
    const commit = (mutate: (c: OpticalComponent) => void) => {
        const newComponents = components.map(c => {
            if (c.id === selection[0]) {
                mutate(c);
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    if (component instanceof PolygonScanner) {
        return (
            <CollapsibleSection title="Polygon Scanner">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <ScrubInput
                        label="Faces" suffix=""
                        value={String(component.numFaces)}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const val = Math.round(parseFloat(v));
                            if (isNaN(val) || val < 3 || val > 32) return;
                            commit(c => { (c as PolygonScanner).numFaces = val; });
                        }}
                        speed={0.2} min={3} max={32}
                    />
                    <ScrubInput
                        label="Radius" suffix="mm"
                        value={String(component.inscribedRadius.toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const val = parseFloat(v);
                            if (isNaN(val) || val <= 0) return;
                            commit(c => { (c as PolygonScanner).inscribedRadius = val; });
                        }}
                        speed={0.5} min={1} max={50}
                    />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
                    <ScrubInput
                        label="Height" suffix="mm"
                        value={String(component.faceHeight.toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const val = parseFloat(v);
                            if (isNaN(val) || val <= 0) return;
                            commit(c => { (c as PolygonScanner).faceHeight = val; });
                        }}
                        speed={0.5} min={1} max={50}
                    />
                    <ScrubInput
                        label="Scan Angle" suffix="°"
                        value={String((component.scanAngle * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const deg = parseFloat(v);
                            if (isNaN(deg)) return;
                            commit(c => { (c as PolygonScanner).scanAngle = deg * Math.PI / 180; });
                        }}
                        speed={0.5}
                    />
                </div>
            </CollapsibleSection>
        );
    }

    if (component instanceof GalvoScanHead) {
        return (
            <CollapsibleSection title="Galvo Scan Head">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <ScrubInput
                        label="Scan X" suffix="°"
                        value={String((component.scanX * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const deg = parseFloat(v);
                            if (isNaN(deg)) return;
                            commit(c => { (c as GalvoScanHead).scanX = deg * Math.PI / 180; });
                        }}
                        speed={0.2}
                    />
                    <ScrubInput
                        label="Scan Y" suffix="°"
                        value={String((component.scanY * 180 / Math.PI).toFixed(1))}
                        onChange={() => {}}
                        onCommit={(v: string) => {
                            const deg = parseFloat(v);
                            if (isNaN(deg)) return;
                            commit(c => { (c as GalvoScanHead).scanY = deg * Math.PI / 180; });
                        }}
                        speed={0.2}
                    />
                </div>
            </CollapsibleSection>
        );
    }

    return null;
};
