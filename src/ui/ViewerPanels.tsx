/**
 * ViewerPanels — floating viewer panels that can be toggled on independently
 * of the Inspector selection. These appear at the bottom-left of the viewport.
 * Multiple panels stack horizontally.
 * Each shows only the canvas — no properties, no delete, no readout text.
 *
 * Supports both Card beam profile viewers and Camera Reverse tracer image viewers.
 */
import React from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, mobilePanelModeAtom, pinnedViewersAtom, reverseTraceRenderingAtom, uiLockedAtom } from '../state/store';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { QPD } from '../physics/components/QPD';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';
import { PMTViewer } from './PMTViewer';
import { QPDViewer } from './QPDViewer';
import { SampleZoomViewer } from './SampleZoomViewer';
import { OpticalComponent } from '../physics/Component';
import { useIsMobile } from './useIsMobile';
import { formatPower } from './formatters';

const MOBILE_RASTER_PANEL_WIDTH = 'min(26vw, calc(var(--app-height, 100dvh) * 0.19))';
const MOBILE_RASTER_PANEL_MAX_HEIGHT = 'calc(var(--app-height, 100dvh) * 0.24)';

export const ViewerPanels: React.FC = () => {
    const isMobile = useIsMobile();
    const [components] = useAtom(componentsAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [isRendering] = useAtom(reverseTraceRenderingAtom);
    const [uiLocked] = useAtom(uiLockedAtom);
    const [mobilePanelMode, setMobilePanelMode] = useAtom(mobilePanelModeAtom);
    const [minimizedIds, setMinimizedIds] = React.useState<Set<string>>(new Set());

    // Resolve pinned IDs to actual Card / Camera / PMT / Sample instances (filter stale IDs)
    const pinnedComponents = Array.from(pinnedIds)
        .map(id => components.find(c => c.id === id))
        .filter((c): c is OpticalComponent =>
            c instanceof Card
            || c instanceof Camera
            || (c instanceof PMT && (c as PMT).hasValidAxes())
            || c instanceof QPD
            || c instanceof Sample
            || c instanceof SampleChamber
        )
        .filter(c => !(isMobile && c instanceof QPD));

    if (pinnedComponents.length === 0) return null;
    if (isMobile && mobilePanelMode === 'properties') return null;

    // Reserve space for the Sidebar on the left so pinned viewers don't slide
    // behind it. On mobile the sidebar is an overlay (transformed off-screen
    // when closed), so we can hug the left edge there.
    const sidebarWidth = isMobile || uiLocked ? 0 : 250;
    return (
        <div style={{
            position: 'fixed',
            top: isMobile ? undefined : undefined,
            bottom: isMobile ? '8px' : '20px',
            left: isMobile ? '8px' : `${sidebarWidth + 20}px`,
            right: isMobile ? undefined : '20px',
            maxWidth: isMobile ? '52vw' : undefined,
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: isMobile ? '4px' : '8px',
            zIndex: 10,
            pointerEvents: 'none',
            alignItems: 'flex-end',
        }}>
            {pinnedComponents.map(comp => {
                const isRasterPanel = comp instanceof Camera || comp instanceof PMT;
                return (
                    <div
                        key={comp.id}
                        onPointerDown={() => {
                            if (isMobile) setMobilePanelMode('viewer');
                        }}
                        style={{
                            backgroundColor: '#222',
                            border: '1px solid #444',
                            borderRadius: '6px',
                            padding: isMobile && isRasterPanel ? '0' : '6px',
                            fontFamily: 'sans-serif',
                            pointerEvents: uiLocked ? 'none' : 'auto',
                            overflow: 'hidden',
                            width: isMobile && isRasterPanel ? MOBILE_RASTER_PANEL_WIDTH : undefined,
                            maxWidth: isMobile && isRasterPanel ? '26vw' : undefined,
                            maxHeight: isMobile && isRasterPanel ? MOBILE_RASTER_PANEL_MAX_HEIGHT : undefined,
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                    {/* Header: name + minimize + close */}
                    {!(isMobile && comp instanceof Camera) && (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: minimizedIds.has(comp.id) ? '0' : '4px',
                        paddingLeft: '2px',
                    }}>
                        <span
                            style={{
                                fontSize: '10px',
                                fontWeight: 600,
                                color: '#999',
                                cursor: 'pointer',
                                flex: 1,
                            }}
                            onClick={() => {
                                if (isMobile) setMobilePanelMode('viewer');
                                const next = new Set(minimizedIds);
                                if (next.has(comp.id)) next.delete(comp.id);
                                else next.add(comp.id);
                                setMinimizedIds(next);
                            }}
                            title={minimizedIds.has(comp.id) ? 'Expand viewer' : 'Minimize viewer'}
                        >
                            {minimizedIds.has(comp.id) ? '\u25b8' : '\u25be'} {comp.name}
                        </span>
                        <button
                            onClick={() => {
                                const next = new Set(pinnedIds);
                                next.delete(comp.id);
                                setPinnedIds(next);
                                if (isMobile && next.size === 0) setMobilePanelMode('scene');
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#555',
                                cursor: 'pointer',
                                fontSize: '12px',
                                padding: '0 2px',
                                lineHeight: 1,
                            }}
                            title="Close viewer"
                        >
                            ✕
                        </button>
                    </div>
                    )}

                    {/* Viewer content (hidden when minimized) */}
                    {!minimizedIds.has(comp.id) && comp instanceof Card && (
                        <CardViewer card={comp} />
                    )}
                    {minimizedIds.has(comp.id) && comp instanceof Card && (comp as Card).beamProfiles.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace', marginTop: '2px' }}>
                            {formatPower((comp as Card).beamProfiles.reduce((sum, p) => sum + p.power, 0), 1)}
                        </div>
                    )}
                    {minimizedIds.has(comp.id) && comp instanceof QPD && (
                        <div style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace', marginTop: '2px' }}>
                            {formatPower((comp as QPD).signalSum, 1)}
                        </div>
                    )}
                    {!minimizedIds.has(comp.id) && comp instanceof Camera && (
                        <CameraViewer
                            camera={comp}
                            isRendering={isRendering}
                            isMobile={isMobile}
                        />
                    )}
                    {!minimizedIds.has(comp.id) && comp instanceof QPD && (
                        <QPDViewer qpd={comp} />
                    )}
                    {!minimizedIds.has(comp.id) && (comp instanceof Sample || comp instanceof SampleChamber) && (
                        <SampleZoomViewer sample={comp as Sample | SampleChamber} size={isMobile ? 160 : 240} />
                    )}
                    {!minimizedIds.has(comp.id) && comp instanceof PMT && (() => {
                        const pmt = comp as PMT;
                        return (
                            <PMTViewer
                                pmt={pmt}
                                isRendering={isRendering}
                                isMobile={isMobile}
                            />
                        );
                    })()}
                    </div>
                );
            })}
        </div>
    );
};
