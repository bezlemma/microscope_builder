import React, { useState } from 'react';
import {
    Box,
    Circle,
    Square,
    Search,
    Zap,
    ChevronRight
} from 'lucide-react';

import { useAtom } from 'jotai';
import { loadPresetAtom, activePresetAtom, PresetName } from '../state/store';

// ─── Draggable component item ─────────────────────────────────────────

const DraggableItem = ({ type, label, icon: Icon }: { type: string, label: string, icon: any }) => {
    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('componentType', type);
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div
            draggable
            onDragStart={handleDragStart}
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px 6px 24px',
                margin: '2px 0',
                backgroundColor: '#252525',
                cursor: 'grab',
                border: '1px solid transparent',
                borderRadius: '4px',
                transition: 'all 0.15s ease',
                userSelect: 'none',
                fontSize: '13px',
                color: '#ccc'
            }}
            onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#333';
                e.currentTarget.style.borderColor = '#555';
                e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#252525';
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.color = '#ccc';
            }}
        >
            <Icon size={14} style={{ marginRight: '8px', color: '#64ffda', flexShrink: 0 }} />
            <span style={{ fontWeight: 400 }}>{label}</span>
        </div>
    );
};

// ─── Component groups definition ──────────────────────────────────────

interface ComponentDef {
    type: string;
    label: string;
    icon: any;
}

interface ComponentGroup {
    name: string;
    icon: any;
    color: string;
    items: ComponentDef[];
}

const COMPONENT_GROUPS: ComponentGroup[] = [
    {
        name: 'Sources',
        icon: Zap,
        color: '#ff6b6b',
        items: [
            { type: 'laser', label: 'Laser Source', icon: Zap },
        ]
    },
    {
        name: 'Lenses',
        icon: Circle,
        color: '#64ffda',
        items: [
            { type: 'lens', label: 'Spherical Lens', icon: Circle },
            { type: 'cylindricalLens', label: 'Cylindrical Lens', icon: Circle },
            { type: 'idealLens', label: 'Ideal Lens', icon: Circle },
            { type: 'objective', label: 'Objective', icon: Circle },
            { type: 'prism', label: 'Prism', icon: Box },
        ]
    },
    {
        name: 'Mirrors & Splitters',
        icon: Square,
        color: '#74b9ff',
        items: [
            { type: 'mirror', label: 'Mirror', icon: Square },
            { type: 'beamSplitter', label: 'Beam Splitter', icon: Square },
            { type: 'dichroic', label: 'Dichroic Mirror', icon: Square },
        ]
    },
    {
        name: 'Polarization',
        icon: Circle,
        color: '#a29bfe',
        items: [
            { type: 'halfWavePlate', label: 'λ/2 Plate', icon: Circle },
            { type: 'quarterWavePlate', label: 'λ/4 Plate', icon: Circle },
            { type: 'polarizer', label: 'Linear Polarizer', icon: Box },
        ]
    },
    {
        name: 'Detectors',
        icon: Search,
        color: '#ffeaa7',
        items: [
            { type: 'card', label: 'Viewing Card', icon: Search },
            { type: 'camera', label: 'Camera', icon: Box },
        ]
    },
    {
        name: 'Samples',
        icon: Box,
        color: '#fd79a8',
        items: [
            { type: 'sample', label: 'Sample (Mickey)', icon: Box },
        ]
    },
    {
        name: 'Blockers',
        icon: Box,
        color: '#e17055',
        items: [
            { type: 'blocker', label: 'Blocker', icon: Box },
            { type: 'aperture', label: 'Aperture / Iris', icon: Circle },
        ]
    },
    {
        name: 'Filters',
        icon: Square,
        color: '#81ecec',
        items: [
            { type: 'filter', label: 'Filter', icon: Square },
        ]
    }
];

// ─── Collapsible group component ──────────────────────────────────────

const ComponentGroupSection = ({
    group,
    isOpen,
    onToggle
}: {
    group: ComponentGroup;
    isOpen: boolean;
    onToggle: () => void;
}) => {
    const GroupIcon = group.icon;

    return (
        <div style={{ marginBottom: '2px' }}>
            {/* Group header */}
            <div
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    backgroundColor: isOpen ? '#2a2a2a' : 'transparent',
                    borderRadius: '6px',
                    transition: 'all 0.15s ease',
                    userSelect: 'none',
                }}
                onMouseOver={(e) => {
                    if (!isOpen) e.currentTarget.style.backgroundColor = '#222';
                }}
                onMouseOut={(e) => {
                    if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent';
                }}
            >
                <ChevronRight
                    size={14}
                    style={{
                        marginRight: '6px',
                        color: '#888',
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        flexShrink: 0
                    }}
                />
                <GroupIcon
                    size={14}
                    style={{ marginRight: '8px', color: group.color, flexShrink: 0 }}
                />
                <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: isOpen ? '#fff' : '#aaa',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    transition: 'color 0.15s ease'
                }}>
                    {group.name}
                </span>
                <span style={{
                    marginLeft: 'auto',
                    fontSize: '11px',
                    color: '#555',
                    fontWeight: 400
                }}>
                    {group.items.length}
                </span>
            </div>

            {/* Expandable items */}
            <div style={{
                overflow: 'hidden',
                maxHeight: isOpen ? `${group.items.length * 36}px` : '0px',
                transition: 'max-height 0.25s ease',
                marginLeft: '4px',
                borderLeft: isOpen ? `2px solid ${group.color}33` : '2px solid transparent'
            }}>
                {group.items.map(item => (
                    <DraggableItem
                        key={item.type}
                        type={item.type}
                        label={item.label}
                        icon={item.icon}
                    />
                ))}
            </div>
        </div>
    );
};

// ─── Sidebar ──────────────────────────────────────────────────────────

export const Sidebar: React.FC = () => {
    const [activePreset] = useAtom(activePresetAtom);
    const [, loadPreset] = useAtom(loadPresetAtom);
    const [openGroup, setOpenGroup] = useState<string | null>('Lenses');

    const handleToggle = (groupName: string) => {
        setOpenGroup(prev => prev === groupName ? null : groupName);
    };

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
            onMouseOver={(e) => { if (active) e.currentTarget.style.backgroundColor = '#3a5a4a' }}
            onMouseOut={(e) => { if (active) e.currentTarget.style.backgroundColor = '#2a4a3a' }}
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
            backgroundColor: '#1a1a1a',
            borderRight: '1px solid #333',
            padding: '10px',
            overflowY: 'auto',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column'
        }}>
            <div style={{ flex: 1 }}>
                <h3 style={{
                    color: '#fff',
                    marginBottom: '12px',
                    fontSize: '14px',
                    fontWeight: 700,
                    letterSpacing: '0.5px'
                }}>
                    Components
                </h3>

                <div style={{ marginBottom: '16px' }}>
                    {COMPONENT_GROUPS.map(group => (
                        <ComponentGroupSection
                            key={group.name}
                            group={group}
                            isOpen={openGroup === group.name}
                            onToggle={() => handleToggle(group.name)}
                        />
                    ))}
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
                <PresetButton
                    label="Polarization Zoo"
                    active={activePreset === PresetName.PolarizationZoo}
                    onClick={() => loadPreset(PresetName.PolarizationZoo)}
                />
            </div>
        </div>
    );
};
