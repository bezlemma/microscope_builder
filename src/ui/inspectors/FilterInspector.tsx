/**
 * FilterInspector — Properties panel for Filter and DichroicMirror components.
 * Spectral profile type, cutoff, bands.
 */
import React from 'react';
import { Filter } from '../../parts/Filter';
import { DichroicMirror } from '../../parts/DichroicMirror';
import { OpticalComponent } from '../../physics/Component';
import { SpectralProfile } from '../../physics/SpectralProfile';
import { ScrubInput } from '../ScrubInput';
import { CollapsibleSection, inputStyle } from './shared';

interface FilterInspectorProps {
    component: Filter | DichroicMirror;
    components: OpticalComponent[];
    selection: string[];
    setComponents: (c: OpticalComponent[]) => void;
    localBands: { center: string; width: string }[];
    setLocalBands: (v: { center: string; width: string }[]) => void;
    commitSpectral: (overrideBands?: { center: string; width: string }[]) => void;
    profile: SpectralProfile;
    isDichroic: boolean;
    localPreset: string;
    setLocalPreset: (v: string) => void;
    localCutoff: string;
    setLocalCutoff: (v: string) => void;
    localSteepness: string;
    setLocalSteepness: (v: string) => void;
}

export const FilterInspector: React.FC<FilterInspectorProps> = ({
    component: _component,
    isDichroic,
    profile,
    localPreset, setLocalPreset,
    localCutoff, setLocalCutoff,
    localSteepness, setLocalSteepness,
    localBands, setLocalBands,
    commitSpectral,
}) => {
    return (
        <CollapsibleSection title={isDichroic ? 'Dichroic Spectrum' : 'Filter Spectrum'}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: 6 }}>
                {isDichroic ? 'Dichroic Spectrum' : 'Filter Spectrum'}: {profile.getLabel()}
            </div>

            {/* Profile type selector */}
            <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Profile Type</label>
                <select
                    value={localPreset}
                    onChange={(e) => { setLocalPreset(e.target.value); }}
                    style={{
                        width: '100%', background: '#333', color: '#ccc',
                        border: '1px solid #555', borderRadius: 4,
                        padding: '4px 6px', fontSize: '11px',
                    }}
                >
                    <option value="longpass">Longpass</option>
                    <option value="shortpass">Shortpass</option>
                    <option value="bandpass">Bandpass</option>
                    <option value="notch">Notch</option>
                </select>
            </div>

            {/* Cutoff + Steepness */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <ScrubInput
                    label="Cutoff" suffix="nm"
                    value={localCutoff} onChange={setLocalCutoff}
                    onCommit={() => commitSpectral()}
                    speed={1} min={200} max={1000}
                />
                <ScrubInput
                    label="Edge" suffix="nm"
                    value={localSteepness} onChange={setLocalSteepness}
                    onCommit={() => commitSpectral()}
                    speed={0.5} min={1} max={100}
                />
            </div>

            {/* Band peaks */}
            {(localPreset === 'bandpass' || localPreset === 'notch') && (
                <div style={{ marginTop: 8 }}>
                    <label style={{ fontSize: '10px', color: '#666', display: 'block', marginBottom: 4 }}>Bands</label>
                    {localBands.map((band, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 4, marginBottom: 4 }}>
                            <input
                                type="text"
                                value={band.center}
                                onChange={e => {
                                    const updated = [...localBands];
                                    updated[idx] = { ...updated[idx], center: e.target.value };
                                    setLocalBands(updated);
                                }}
                                onBlur={() => commitSpectral(localBands)}
                                placeholder="Center nm"
                                style={inputStyle}
                            />
                            <input
                                type="text"
                                value={band.width}
                                onChange={e => {
                                    const updated = [...localBands];
                                    updated[idx] = { ...updated[idx], width: e.target.value };
                                    setLocalBands(updated);
                                }}
                                onBlur={() => commitSpectral(localBands)}
                                placeholder="Width nm"
                                style={inputStyle}
                            />
                            {localBands.length > 1 && (
                                <button
                                    onClick={() => {
                                        const updated = localBands.filter((_, i) => i !== idx);
                                        setLocalBands(updated);
                                        commitSpectral(updated);
                                    }}
                                    style={{
                                        background: 'none', border: 'none', color: '#f66',
                                        cursor: 'pointer', fontSize: '14px', padding: '0 4px',
                                    }}
                                >×</button>
                            )}
                        </div>
                    ))}
                    <button
                        onClick={() => {
                            const updated = [...localBands, { center: '600', width: '40' }];
                            setLocalBands(updated);
                        }}
                        style={{
                            width: '100%', padding: '4px 8px', marginTop: 2,
                            background: '#333', color: '#aaa', border: '1px solid #555',
                            borderRadius: 4, cursor: 'pointer', fontSize: '11px',
                        }}
                    >+ Add Band</button>
                </div>
            )}
        </CollapsibleSection>
    );
};
