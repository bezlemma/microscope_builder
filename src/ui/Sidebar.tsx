import React from 'react';
import { 
    Box, 
    Circle, 
    Square, 
    Search,
    Zap
} from 'lucide-react';

import { useAtom } from 'jotai';
import { loadPresetAtom, activePresetAtom, PresetName } from '../state/store';

// Helper for draggable items
const DraggableItem = ({ type, label, icon: Icon }: { type: string, label: string, icon: any }) => {
    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('componentType', type);
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div 
            draggable 
            onDragStart={handleDragStart}
            className="sidebar-button" // We will add global CSS or inline styles
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                margin: '6px 0',
                backgroundColor: '#2a2a2a',
                cursor: 'grab',
                border: '1px solid #444',
                borderRadius: '4px',
                transition: 'background-color 0.2s',
                userSelect: 'none'
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#3a3a3a')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#2a2a2a')}
        >
            <Icon size={16} style={{ marginRight: '10px', color: '#64ffda' }} /> {/* Accent color */}
            <span style={{ fontSize: '13px', color: '#eee', fontWeight: 500 }}>{label}</span>
        </div>
    );
};

export const Sidebar: React.FC = () => {
    const [activePreset] = useAtom(activePresetAtom);
    const [, loadPreset] = useAtom(loadPresetAtom);

    const PresetButton = ({ label, active, onClick }: { label: string, active: boolean, onClick?: () => void }) => (
        <div 
            onClick={onClick}
            style={{
                padding: '8px 12px',
                margin: '4px 0',
                backgroundColor: active ? '#2a4a3a' : '#222',
                cursor: 'pointer',
                border: `1px solid ${active ? '#64ffda' : '#333'}`,
                borderRadius: '4px',
                opacity: active ? 1 : 0.5,
                transition: 'all 0.2s',
                fontSize: '13px',
                color: active ? '#fff' : '#888',
                userSelect: 'none'
            }}
            onMouseOver={(e) => { if(active) e.currentTarget.style.backgroundColor = '#3a5a4a' }}
            onMouseOut={(e) => { if(active) e.currentTarget.style.backgroundColor = '#2a4a3a' }}
        >
            {label}
        </div>
    );

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '250px',
            height: '100%',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #333',
            padding: '10px',
            overflowY: 'auto',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column'
        }}>
            <div style={{ flex: 1 }}>
                <h3 style={{ color: '#fff', marginBottom: '15px' }}>Components</h3>
                
                <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase' }}>Sources</h4>
                    <DraggableItem type="laser" label="Laser Source" icon={Zap} />
                    <DraggableItem type="pointSource" label="Point Source" icon={Circle} />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase' }}>Optics</h4>
                    <DraggableItem type="lens" label="Spherical Lens" icon={Circle} />
                    <DraggableItem type="cylindricalLens" label="Cylindrical Lens" icon={Circle} />
                    <DraggableItem type="prism" label="Prism" icon={Box} />
                    <DraggableItem type="idealLens" label="Ideal Lens" icon={Circle} />
                    <DraggableItem type="objective" label="Objective" icon={Circle} />
                    <DraggableItem type="mirror" label="Mirror" icon={Square} />
                    <DraggableItem type="blocker" label="Blocker" icon={Box} />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase' }}>Detectors</h4>
                    <DraggableItem type="card" label="Viewing Card" icon={Search} />
                    <DraggableItem type="camera" label="Camera" icon={Box} />
                </div>
                
                 <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase' }}>Samples</h4>
                    <DraggableItem type="sample" label="Sample (Mickey)" icon={Box} />
                </div>
            </div>

            {/* Presets Section */}
            <div style={{ paddingTop: '15px', borderTop: '1px solid #333' }}>
                <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase', marginBottom: '10px' }}>Presets</h4>
                <PresetButton 
                    label="Beam Expander" 
                    active={activePreset === PresetName.BeamExpander} 
                    onClick={() => loadPreset(PresetName.BeamExpander)} 
                />
                <PresetButton 
                    label="Transmission Microscope" 
                    active={activePreset === PresetName.TransmissionMicroscope} 
                    onClick={() => loadPreset(PresetName.TransmissionMicroscope)}
                />
                <PresetButton 
                    label="Lens Zoo" 
                    active={activePreset === PresetName.LensZoo} 
                    onClick={() => loadPreset(PresetName.LensZoo)}
                />
                <PresetButton 
                    label="Prism Debug" 
                    active={activePreset === PresetName.PrismDebug} 
                    onClick={() => loadPreset(PresetName.PrismDebug)}
                />
            </div>
            
        </div>
    );
};
