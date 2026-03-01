/**
 * LaserInspector — Properties panel for Laser components.
 * Wavelength slider with color swatch, beam radius, and power.
 */
import React from 'react';
import { Laser } from '../../parts/Laser';
import { OpticalComponent } from '../../physics/Component';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection } from './shared';

function wavelengthToColor(nm: number): string {
    if (nm < 380) return '#8a2be2';
    if (nm < 440) return `rgb(${Math.round(255 * (440 - nm) / 60)}, 0, 255)`;
    if (nm < 490) return `rgb(0, ${Math.round(255 * (nm - 440) / 50)}, 255)`;
    if (nm < 510) return `rgb(0, 255, ${Math.round(255 * (510 - nm) / 20)})`;
    if (nm < 580) return `rgb(${Math.round(255 * (nm - 510) / 70)}, 255, 0)`;
    if (nm < 645) return `rgb(255, ${Math.round(255 * (645 - nm) / 65)}, 0)`;
    if (nm < 780) return '#ff0000';
    return '#880000';
}

function isVisibleSpectrum(nm: number): boolean {
    return nm >= 380 && nm <= 780;
}

interface LaserInspectorProps {
    component: Laser;
    components: OpticalComponent[];
    setComponents: (c: OpticalComponent[]) => void;
    localWavelength: number;
    setLocalWavelength: (v: number) => void;
    localBeamRadius: string;
    setLocalBeamRadius: (v: string) => void;
    localLaserPower: string;
    setLocalLaserPower: (v: string) => void;
    commitLaserParams: () => void;
}

export const LaserInspector: React.FC<LaserInspectorProps> = ({
    component,
    components,
    setComponents,
    localWavelength,
    setLocalWavelength,
    localBeamRadius,
    setLocalBeamRadius,
    localLaserPower,
    setLocalLaserPower,
    commitLaserParams,
}) => {
    return (
        <CollapsibleSection title="Laser Settings">
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

                            if (component instanceof Laser) {
                                component.wavelength = newWavelength;
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
        </CollapsibleSection>
    );
};
