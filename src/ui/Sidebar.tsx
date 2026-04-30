import React, { useState } from 'react';
import {
    Box,
    Circle,
    Square,
    Search,
    Zap,
    ChevronRight,
    Type,
    ArrowRight,
    Redo2,
    X,
    Ruler,
} from 'lucide-react';

import { useAtom } from 'jotai';
import { loadPresetAtom, activePresetAtom, PresetName, componentsAtom, loadSceneAtom, selectionAtom, zoomToComponentAtom, measurementAtom, zoomToMeasurementAtom } from '../state/store';
import { downloadUbz, openUbzFilePicker, generateSceneUrl } from '../state/ubzSerializer';
import { useIsMobile, useIsLandscape } from './useIsMobile';

// ─── Draggable component item ─────────────────────────────────────────


const DraggableItem = ({ type, label, icon: Icon, onDragStarted }: { type: string, label: string, icon: any, onDragStarted?: () => void }) => {
    const isMobile = useIsMobile();
    const [hovered, setHovered] = useState(false);
    const [dragging, setDragging] = useState(false);
    const active = hovered || dragging;
    const handleDragStart = (e: React.DragEvent) => {
        setDragging(true);
        e.dataTransfer.setData('componentType', type);
        e.dataTransfer.effectAllowed = 'copy';
        onDragStarted?.();
    };

    return (
        <div
            draggable
            data-component-type={type}
            onDragStart={handleDragStart}
            onDragEnd={() => setDragging(false)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: isMobile ? '4px 6px 4px 16px' : '6px 12px 6px 24px',
                margin: isMobile ? '1px 0' : '2px 0',
                backgroundColor: active ? '#303842' : '#252525',
                cursor: 'grab',
                border: `1px solid ${active ? '#4b6b7a' : 'transparent'}`,
                borderRadius: '4px',
                transition: 'all 0.15s ease',
                userSelect: 'none',
                fontSize: isMobile ? '11px' : '13px',
                color: active ? '#fff' : '#ccc',
                boxShadow: active ? 'inset 0 0 0 1px rgba(100,255,218,0.16), 0 2px 8px rgba(0,0,0,0.18)' : 'none',
                transform: active ? 'translateX(2px)' : 'translateX(0)',
            }}
        >
            <Icon size={isMobile ? 11 : 14} style={{ marginRight: isMobile ? '5px' : '8px', color: active ? '#9dfdeb' : '#64ffda', flexShrink: 0 }} />
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
            { type: 'laser', label: 'Laser', icon: Zap },
            { type: 'lamp', label: 'Lamp', icon: Zap },
            { type: 'pointSource2D', label: 'Point Source 2D', icon: Zap },
            { type: 'pointSource3D', label: 'Point Source 3D', icon: Zap },
            { type: 'coneSource3D', label: 'Cone Source 3D', icon: Zap },
            { type: 'wedgeSource2D', label: 'Wedge Source 2D', icon: Zap },
            { type: 'structuredSource', label: 'Structured Source / SLM', icon: Zap },
        ]
    },
    {
        name: 'Lenses',
        icon: Circle,
        color: '#64ffda',
        items: [
            { type: 'lens', label: 'Spherical Lens', icon: Circle },
            { type: 'asphericLens', label: 'Aspheric Lens', icon: Circle },
            { type: 'cylindricalLens', label: 'Cylindrical Lens', icon: Circle },
            { type: 'idealLens', label: 'Ideal Lens', icon: Circle },
            { type: 'achromatDoublet', label: 'Achromatic Doublet', icon: Circle },
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
            { type: 'curvedMirror', label: 'Curved Mirror', icon: Square },
            { type: 'beamSplitter', label: 'Beam Splitter', icon: Square },
            { type: 'polarizingBeamSplitter', label: 'Polarizing Beam Splitter', icon: Square },
            { type: 'dichroic', label: 'Dichroic Mirror', icon: Square },
            { type: 'polygonScanner', label: 'Polygon Scanner', icon: Square },
            { type: 'dualGalvoScanHead', label: 'Dual Galvo Scan Head', icon: Square },
            { type: 'aod', label: 'Acousto-Optic Deflector', icon: Square },
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
            { type: 'pupilMask', label: 'Pupil Mask', icon: Circle },
            { type: 'faradayIsolator', label: 'Faraday Isolator', icon: Box },
        ]
    },
    {
        name: 'Detectors',
        icon: Search,
        color: '#ffeaa7',
        items: [
            { type: 'card', label: 'Viewing Card', icon: Search },
            { type: 'camera', label: 'Camera', icon: Box },
            { type: 'pmt', label: 'PMT Detector', icon: Search },
            { type: 'qpd', label: 'QPD', icon: Search },
        ]
    },
    {
        name: 'Samples',
        icon: Box,
        color: '#fd79a8',
        items: [
            { type: 'sampleSlide', label: '2D Sample Holder', icon: Box },
            { type: 'colloidSampleSlide', label: 'Colloid Flow Cell', icon: Circle },
            { type: 'sample', label: 'Sample (Mickey)', icon: Box },
            { type: 'lChamber', label: 'X Sample Holder', icon: Box },
            { type: 'mediumVolume', label: 'Medium Volume', icon: Box },
        ]
    },
    {
        name: 'Blockers',
        icon: Box,
        color: '#e17055',
        items: [
            { type: 'abstractPlane', label: 'Abstract Plane', icon: Box },
            { type: 'blocker', label: 'Blocker', icon: Box },
            { type: 'aperture', label: 'Aperture / Iris', icon: Circle },
            { type: 'slitAperture', label: 'Slit Aperture', icon: Box },
            { type: 'doubleSlit', label: 'Double Slit', icon: Box },
        ]
    },
    {
        name: 'Filters',
        icon: Square,
        color: '#81ecec',
        items: [
            { type: 'filter', label: 'Filter', icon: Square },
            { type: 'diffuser', label: 'Diffuser', icon: Square },
        ]
    },
    {
        name: 'Hardware',
        icon: Box,
        color: '#b0b0b0',
        items: [
            { type: 'rail', label: 'Optical Rail', icon: Box },
        ]
    },
    {
        name: 'Annotations',
        icon: Type,
        color: '#007fff',
        items: [
            { type: 'textAnnotation', label: 'Text', icon: Type },
            { type: 'arrowAnnotation', label: 'Arrow', icon: ArrowRight },
            { type: 'curvedArrowAnnotation', label: 'Curved Arrow', icon: Redo2 },
        ]
    }
];

// ─── Collapsible group component ──────────────────────────────────────

const ComponentGroupSection = ({
    group,
    isOpen,
    onToggle,
    onDragStarted
}: {
    group: ComponentGroup;
    isOpen: boolean;
    onToggle: () => void;
    onDragStarted?: () => void;
}) => {
    const GroupIcon = group.icon;
    const isMobile = useIsMobile();

    return (
        <div
            data-component-group-root={group.name}
            data-open={isOpen ? 'true' : 'false'}
            style={{ marginBottom: '2px' }}
        >
            {/* Group header */}
            <div
                data-component-group={group.name}
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: isMobile ? '5px 6px' : '8px 10px',
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
                    size={isMobile ? 11 : 14}
                    style={{
                        marginRight: isMobile ? '4px' : '6px',
                        color: '#888',
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        flexShrink: 0
                    }}
                />
                <GroupIcon
                    size={isMobile ? 11 : 14}
                    style={{ marginRight: isMobile ? '5px' : '8px', color: group.color, flexShrink: 0 }}
                />
                <span style={{
                    fontSize: isMobile ? '10px' : '12px',
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
                    fontSize: isMobile ? '9px' : '11px',
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
                        onDragStarted={onDragStarted}
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
    const [components] = useAtom(componentsAtom);
    const [, loadScene] = useAtom(loadSceneAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [, setZoomTo] = useAtom(zoomToComponentAtom);
    const [measurement, setMeasurement] = useAtom(measurementAtom);
    const [, setZoomToMeasurement] = useAtom(zoomToMeasurementAtom);
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const [sceneOpen, setSceneOpen] = useState(false);
    const [openPresetCat, setOpenPresetCat] = useState<string | null>(null);
    const [shareLabel, setShareLabel] = useState('Share');
    const _isLandscape = useIsLandscape();
    void _isLandscape;



    // Mobile collapse state
    const [mobileOpen, setMobileOpen] = useState(false);
    const isMobile = useIsMobile();

    const handleToggle = (groupName: string) => {
        setOpenGroup(prev => prev === groupName ? null : groupName);
    };

    // Auto-close sidebar on mobile after selecting a preset
    const handlePresetClick = (preset: PresetName) => {
        loadPreset(preset);
        if (isMobile) setMobileOpen(false);
    };

    const sceneComponents = components.filter(component => !component.isGhost && !component.isSubComponent);
    const measurements = Array.isArray(measurement.measurements) ? measurement.measurements : [];
    const sceneRowCount = sceneComponents.length + measurements.length;

    const handleSceneComponentClick = (componentId: string) => {
        setSelection([componentId]);
        setMeasurement(state => ({
            ...state,
            active: false,
            selectedId: null,
            measurements: Array.isArray(state.measurements) ? state.measurements : [],
        }));
        setZoomTo(componentId);
        if (isMobile) setMobileOpen(false);
    };

    const handleSceneMeasurementClick = (measurementId: string) => {
        const selectedMeasurement = measurements.find(current => current.id === measurementId);
        setSelection([]);
        setMeasurement(state => ({
            ...state,
            active: false,
            selectedId: measurementId,
            measurements: Array.isArray(state.measurements) ? state.measurements : [],
        }));
        if (selectedMeasurement) {
            setZoomToMeasurement({ id: selectedMeasurement.id, points: selectedMeasurement.points });
        }
        if (isMobile) setMobileOpen(false);
    };

    const PresetButton = ({ label, active, onClick }: { label: string, active: boolean, onClick?: () => void }) => (
        <div
            onClick={onClick}
            style={{
                padding: '6px 10px 6px 20px',
                margin: '2px 0',
                backgroundColor: active ? '#2a4a3a' : '#252525',
                cursor: 'pointer',
                border: `1px solid ${active ? '#64ffda' : 'transparent'}`,
                borderRadius: '4px',
                transition: 'all 0.15s',
                fontSize: '12px',
                color: active ? '#fff' : '#aaa',
                userSelect: 'none'
            }}
            onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = active ? '#3a5a4a' : '#333';
                e.currentTarget.style.borderColor = active ? '#64ffda' : '#555';
                e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = active ? '#2a4a3a' : '#252525';
                e.currentTarget.style.borderColor = active ? '#64ffda' : 'transparent';
                e.currentTarget.style.color = active ? '#fff' : '#aaa';
            }}
        >
            {label}
        </div>
    );

    const PresetCategory = ({ label, isOpen, onToggle, children }: {
        label: string, isOpen: boolean, onToggle: () => void,
        children: React.ReactNode
    }) => (
        <div style={{ marginBottom: 4 }}>
            <div
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '7px 10px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    backgroundColor: isOpen ? '#252525' : 'transparent',
                    transition: 'background-color 0.15s',
                    userSelect: 'none',
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = isOpen ? '#252525' : 'transparent'; }}
            >
                <ChevronRight
                    size={12}
                    style={{
                        marginRight: 6,
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        color: '#666',
                        flexShrink: 0,
                    }}
                />
                <span style={{ fontSize: '12px', color: '#ccc', fontWeight: 500 }}>
                    {label}
                </span>
            </div>
            <div style={{
                overflow: 'hidden',
                maxHeight: isOpen ? '200px' : '0px',
                transition: 'max-height 0.25s ease',
                marginLeft: 4,
                borderLeft: isOpen ? '2px solid #333' : '2px solid transparent',
            }}>
                {children}
            </div>
        </div>
    );

    // On mobile: show floating toggle button when collapsed
    const isVisible = !isMobile || mobileOpen;

    return (
        <>
            {/* Mobile backdrop overlay */}
            {isMobile && mobileOpen && (
                <div
                    onClick={() => setMobileOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: 'var(--app-height, 100dvh)',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        zIndex: 14,
                    }}
                />
            )}

            {/* Mobile toggle button (visible only when sidebar is collapsed) */}
            {isMobile && !mobileOpen && (
                <button
                    data-mobile-sidebar-toggle="true"
                    onClick={() => setMobileOpen(true)}
                    style={{
                        position: 'fixed',
                        top: 10,
                        left: 10,
                        zIndex: 20,
                        width: 40,
                        height: 40,
                        borderRadius: '8px',
                        border: '1px solid #444',
                        backgroundColor: '#1a1a1a',
                        color: '#aaa',
                        fontSize: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}
                    title="Components & Presets"
                >
                    ☰
                </button>
            )}

            {/* Sidebar panel */}
            <div style={{
                position: isMobile ? 'fixed' : 'relative',
                top: 0,
                left: 0,
                width: isMobile ? '170px' : '250px',
                height: '100%',
                flex: isMobile ? undefined : '0 0 250px',
                backgroundColor: '#1a1a1a',
                borderRight: '1px solid #333',
                padding: isMobile ? '6px' : '10px',
                overflowY: 'auto',
                zIndex: 15,
                display: 'flex',
                flexDirection: 'column',
                transform: isVisible ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.25s ease',
                fontFamily: 'var(--ui-font)',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: isMobile ? 6 : 10,
                }}>
                    <a
                        href="https://bezialemma.com/"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            color: '#888',
                            fontSize: isMobile ? '10px' : '11px',
                            textDecoration: 'none',
                            transition: 'color 0.15s',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.color = '#64ffda'; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = '#888'; }}
                    >
                        ← Bezia Lemma
                    </a>
                    {isMobile && (
                        <button
                            type="button"
                            aria-label="Close sidebar"
                            title="Close sidebar"
                            onClick={() => setMobileOpen(false)}
                            style={{
                                width: 28,
                                height: 28,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'transparent',
                                border: '1px solid transparent',
                                borderRadius: 4,
                                color: '#888',
                                cursor: 'pointer',
                                padding: 0,
                            }}
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div style={{ flex: 1 }}>
                    {/* Brand mark: giant caps inlined in "Bez's Optics & Microscope Builder" on one line. */}
                    <div style={{ marginBottom: isMobile ? 6 : 10 }}>
                        {(() => {
                            const smallPx = isMobile ? 10 : 12;
                            const bigPx = isMobile ? 15 : 18;
                            const capStyle: React.CSSProperties = {
                                fontSize: `${bigPx}px`,
                                fontWeight: 800,
                                lineHeight: 1,
                            };
                            const smStyle: React.CSSProperties = {
                                fontSize: `${smallPx}px`,
                                fontWeight: 500,
                                lineHeight: 1,
                            };
                            return (
                                <div style={{
                                    fontFamily: 'var(--ui-font)',
                                    color: '#007fff',
                                    textShadow: '0 0 8px rgba(0,127,255,0.85), 0 0 16px rgba(0,127,255,0.5)',
                                    // Desktop fits the whole title on one line; mobile's 170px sidebar
                                    // doesn't, so we let it wrap and use an explicit break after "& "
                                    // so the natural break point is between "Optics &" and "Microscope".
                                    whiteSpace: isMobile ? 'normal' : 'nowrap',
                                    userSelect: 'none',
                                    display: 'inline-block',
                                }}>
                                    <span style={capStyle}>B</span><span style={smStyle}>ez's </span>
                                    <span style={capStyle}>O</span><span style={smStyle}>ptics &amp;</span>
                                    {isMobile ? <br /> : <span style={smStyle}> </span>}
                                    <span style={capStyle}>M</span><span style={smStyle}>icroscope </span>
                                    <span style={capStyle}>B</span><span style={smStyle}>uilder</span>
                                </div>
                            );
                        })()}
                    </div>
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
                                onDragStarted={isMobile ? () => setMobileOpen(false) : undefined}
                            />
                        ))}
                    </div>

                    <div style={{
                        marginBottom: '16px',
                        paddingTop: '10px',
                        borderTop: '1px solid #333',
                    }}>
                        <div
                            onClick={() => setSceneOpen(open => !open)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: isMobile ? '5px 6px' : '8px 10px',
                                cursor: 'pointer',
                                backgroundColor: sceneOpen ? '#2a2a2a' : 'transparent',
                                borderRadius: '6px',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                            }}
                            onMouseOver={(e) => {
                                if (!sceneOpen) e.currentTarget.style.backgroundColor = '#222';
                            }}
                            onMouseOut={(e) => {
                                if (!sceneOpen) e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                        >
                            <ChevronRight
                                size={isMobile ? 11 : 14}
                                style={{
                                    marginRight: isMobile ? '4px' : '6px',
                                    color: '#888',
                                    transition: 'transform 0.2s ease',
                                    transform: sceneOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                                    flexShrink: 0,
                                }}
                            />
                            <span style={{
                                fontSize: isMobile ? '10px' : '12px',
                                fontWeight: 600,
                                color: sceneOpen ? '#fff' : '#aaa',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                transition: 'color 0.15s ease',
                            }}>
                                {`Scene (${sceneRowCount})`}
                            </span>
                        </div>

                        <div style={{
                            overflow: 'hidden',
                            maxHeight: sceneOpen ? `${Math.max(1, sceneRowCount) * (isMobile ? 30 : 34)}px` : '0px',
                            transition: 'max-height 0.25s ease',
                            marginLeft: '4px',
                            borderLeft: sceneOpen ? '2px solid rgba(0, 127, 255, 0.25)' : '2px solid transparent',
                        }}>
                            {sceneRowCount === 0 && (
                                <div style={{
                                    padding: isMobile ? '5px 6px 5px 16px' : '6px 12px 6px 24px',
                                    color: '#666',
                                    fontSize: isMobile ? '11px' : '12px',
                                    fontStyle: 'italic',
                                }}>
                                    Empty scene
                                </div>
                            )}
                            {sceneComponents.map(component => {
                                const selected = selection.includes(component.id);
                                return (
                                    <button
                                        key={component.id}
                                        type="button"
                                        onClick={() => handleSceneComponentClick(component.id)}
                                        title="Select and center this component"
                                        style={{
                                            width: '100%',
                                            display: 'block',
                                            textAlign: 'left',
                                            padding: isMobile ? '4px 6px 4px 16px' : '6px 12px 6px 24px',
                                            margin: isMobile ? '1px 0' : '2px 0',
                                            backgroundColor: selected ? 'rgba(0, 127, 255, 0.18)' : 'transparent',
                                            border: `1px solid ${selected ? 'rgba(0, 127, 255, 0.55)' : 'transparent'}`,
                                            borderRadius: '4px',
                                            color: selected ? '#d7ecff' : '#ccc',
                                            cursor: 'pointer',
                                            fontSize: isMobile ? '11px' : '13px',
                                            fontFamily: 'var(--ui-font)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseOver={(e) => {
                                            if (!selected) {
                                                e.currentTarget.style.backgroundColor = '#252525';
                                                e.currentTarget.style.color = '#fff';
                                            }
                                        }}
                                        onMouseOut={(e) => {
                                            if (!selected) {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = '#ccc';
                                            }
                                        }}
                                    >
                                        {component.name}
                                    </button>
                                );
                            })}
                            {measurements.map((current, index) => {
                                const selected = measurement.selectedId === current.id;
                                const pointCount = current.points.length;
                                return (
                                    <button
                                        key={current.id}
                                        type="button"
                                        onClick={() => handleSceneMeasurementClick(current.id)}
                                        title="Select and center this measurement"
                                        style={{
                                            width: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: isMobile ? 5 : 7,
                                            textAlign: 'left',
                                            padding: isMobile ? '4px 6px 4px 16px' : '6px 12px 6px 24px',
                                            margin: isMobile ? '1px 0' : '2px 0',
                                            backgroundColor: selected ? 'rgba(0, 127, 255, 0.18)' : 'transparent',
                                            border: `1px solid ${selected ? 'rgba(0, 127, 255, 0.55)' : 'transparent'}`,
                                            borderRadius: '4px',
                                            color: selected ? '#d7ecff' : '#ccc',
                                            cursor: 'pointer',
                                            fontSize: isMobile ? '11px' : '13px',
                                            fontFamily: 'var(--ui-font)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseOver={(e) => {
                                            if (!selected) {
                                                e.currentTarget.style.backgroundColor = '#252525';
                                                e.currentTarget.style.color = '#fff';
                                            }
                                        }}
                                        onMouseOut={(e) => {
                                            if (!selected) {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = '#ccc';
                                            }
                                        }}
                                    >
                                        <Ruler size={isMobile ? 11 : 13} style={{ color: '#007fff', flexShrink: 0 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{`M${index + 1}`}</span>
                                        <span style={{ marginLeft: 'auto', color: selected ? '#8cc9ff' : '#666', fontSize: isMobile ? 10 : 11 }}>{pointCount}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Save / Load / Share buttons — hidden on mobile because file
                 *  pickers and clipboard access are unreliable on touch devices,
                 *  and the sidebar real estate is too tight to surface them
                 *  without crowding the components/presets the user actually
                 *  came here for.  Desktop users keep all three. */}
                {!isMobile && (
                <div style={{ order: 3, paddingTop: '15px', borderTop: '1px solid #333' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                        <button
                            onClick={() => downloadUbz(components)}
                            style={{
                                flex: 1,
                                padding: '8px 0',
                                background: '#2a2a2a',
                                border: '1px solid #444',
                                borderRadius: '6px',
                                color: '#ccc',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 500,
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#363636'; e.currentTarget.style.borderColor = '#666'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.borderColor = '#444'; }}
                        >
                            Save
                        </button>
                        <button
                            onClick={async () => {
                                try {
                                    const loaded = await openUbzFilePicker();
                                    loadScene(loaded);
                                } catch (e) {
                                    console.warn('Load cancelled or failed:', e);
                                }
                            }}
                            style={{
                                flex: 1,
                                padding: '8px 0',
                                background: '#2a2a2a',
                                border: '1px solid #444',
                                borderRadius: '6px',
                                color: '#ccc',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 500,
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#363636'; e.currentTarget.style.borderColor = '#666'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.borderColor = '#444'; }}
                        >
                            Load
                        </button>
                        <button
                            onClick={async () => {
                                const url = generateSceneUrl(components);
                                try {
                                    await navigator.clipboard.writeText(url);
                                    setShareLabel('Copied!');
                                } catch {
                                    // Clipboard blocked (insecure context, permissions). Fall back to
                                    // putting the URL in the address bar so the user can copy manually.
                                    window.history.replaceState(null, '', url);
                                    setShareLabel('In URL bar');
                                }
                                setTimeout(() => setShareLabel('Share'), 1800);
                            }}
                            title="Copy a URL that restores this exact scene"
                            style={{
                                flex: 1,
                                padding: '8px 0',
                                background: '#2a2a2a',
                                border: '1px solid #444',
                                borderRadius: '6px',
                                color: '#ccc',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 500,
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#363636'; e.currentTarget.style.borderColor = '#666'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.borderColor = '#444'; }}
                        >
                            {shareLabel}
                        </button>
                    </div>
                </div>
                )}


                {/* Presets Section — categorized dropdowns */}
                <div style={{ order: 2, paddingTop: '15px', borderTop: '1px solid #333' }}>
                    <h4 style={{ color: '#888', fontSize: '12px', textTransform: 'uppercase', marginBottom: '10px' }}>Presets</h4>

                    <PresetCategory
                        label="Microscopes"
                        isOpen={openPresetCat === 'Microscopes'}
                        onToggle={() => setOpenPresetCat(prev => prev === 'Microscopes' ? null : 'Microscopes')}
                    >
                        <PresetButton
                            label="Reflection (Epi) Fluorescence "
                            active={activePreset === PresetName.EpiFluorescence}
                            onClick={() => handlePresetClick(PresetName.EpiFluorescence)}
                        />
                        <PresetButton
                            label="Transmission Fluorescence"
                            active={activePreset === PresetName.TransFluorescence}
                            onClick={() => handlePresetClick(PresetName.TransFluorescence)}
                        />
                        <PresetButton
                            label="Brightfield"
                            active={activePreset === PresetName.Brightfield}
                            onClick={() => handlePresetClick(PresetName.Brightfield)}
                        />
                        <PresetButton
                            label="Light Sheet (OpenSPIM)"
                            active={activePreset === PresetName.OpenSPIM}
                            onClick={() => handlePresetClick(PresetName.OpenSPIM)}
                        />
                        <PresetButton
                            label="Confocal Scanning"
                            active={activePreset === PresetName.Confocal}
                            onClick={() => handlePresetClick(PresetName.Confocal)}
                        />

                    </PresetCategory>

                    <PresetCategory
                        label="Optics Demos"
                        isOpen={openPresetCat === 'Optics'}
                        onToggle={() => setOpenPresetCat(prev => prev === 'Optics' ? null : 'Optics')}
                    >
                        <PresetButton
                            label="Beam Expander"
                            active={activePreset === PresetName.BeamExpander}
                            onClick={() => handlePresetClick(PresetName.BeamExpander)}
                        />
                    </PresetCategory>

                    <PresetCategory
                        label="Physics Demos"
                        isOpen={openPresetCat === 'Physics'}
                        onToggle={() => setOpenPresetCat(prev => prev === 'Physics' ? null : 'Physics')}
                    >
                        <PresetButton
                            label="Interferometer"
                            active={activePreset === PresetName.MZInterferometer}
                            onClick={() => handlePresetClick(PresetName.MZInterferometer)}
                        />
                        <PresetButton
                            label="Optical Trap"
                            active={activePreset === PresetName.OpticalTrap}
                            onClick={() => handlePresetClick(PresetName.OpticalTrap)}
                        />
                    </PresetCategory>

                    <PresetCategory
                        label="Papers"
                        isOpen={openPresetCat === 'Papers'}
                        onToggle={() => setOpenPresetCat(prev => prev === 'Papers' ? null : 'Papers')}
                    >
                        <PresetButton
                            label="CheHang Yu 2026"
                            active={activePreset === PresetName.CheHangYu2026}
                            onClick={() => handlePresetClick(PresetName.CheHangYu2026)}
                        />
                    </PresetCategory>

                    <PresetCategory
                        label="Debugs"
                        isOpen={openPresetCat === 'Debugs'}
                        onToggle={() => setOpenPresetCat(prev => prev === 'Debugs' ? null : 'Debugs')}
                    >
                        <PresetButton
                            label="Blank"
                            active={activePreset === PresetName.Blank}
                            onClick={() => handlePresetClick(PresetName.Blank)}
                        />
                        <PresetButton
                            label="Tutorial"
                            active={activePreset === PresetName.Tutorial}
                            onClick={() => handlePresetClick(PresetName.Tutorial)}
                        />
                        <PresetButton
                            label="Tutorial 2"
                            active={activePreset === PresetName.Tutorial2}
                            onClick={() => handlePresetClick(PresetName.Tutorial2)}
                        />
                        <PresetButton
                            label="Lens Zoo"
                            active={activePreset === PresetName.LensZoo}
                            onClick={() => handlePresetClick(PresetName.LensZoo)}
                        />
                        <PresetButton
                            label="Polarization Zoo"
                            active={activePreset === PresetName.PolarizationZoo}
                            onClick={() => handlePresetClick(PresetName.PolarizationZoo)}
                        />
                        <PresetButton
                            label="Prism Debug"
                            active={activePreset === PresetName.PrismDebug}
                            onClick={() => handlePresetClick(PresetName.PrismDebug)}
                        />

                    </PresetCategory>
                </div>
            </div>
        </>
    );
};
