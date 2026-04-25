/**
 * ViewerPanels — floating viewer panels that can be toggled on independently
 * of the Inspector selection. These appear at the bottom-left of the viewport.
 * Multiple panels stack horizontally.
 * Each shows only the canvas — no properties, no delete, no readout text.
 *
 * Supports both Card beam profile viewers and Camera Solver 3 image viewers.
 */
import React from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, pinnedViewersAtom, solver3RenderingAtom, solver3RenderTriggerAtom, animatorAtom, scanAccumTriggerAtom } from '../state/store';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';
import { PMTViewer } from './PMTViewer';
import { SampleZoomViewer } from './SampleZoomViewer';
import { OpticalComponent } from '../physics/Component';
import { useIsMobile } from './useIsMobile';

function fmtPowerCompact(watts: number): string {
    if (watts >= 1e-3) return `${(watts * 1e3).toFixed(1)} mW`;
    if (watts >= 1e-6) return `${(watts * 1e6).toFixed(1)} uW`;
    if (watts >= 1e-9) return `${(watts * 1e9).toFixed(1)} nW`;
    return `${watts.toExponential(1)} W`;
}

export const ViewerPanels: React.FC = () => {
    const isMobile = useIsMobile();
    const [components] = useAtom(componentsAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [animator] = useAtom(animatorAtom);
    const [scanAccumConfig, setScanAccumConfig] = useAtom(scanAccumTriggerAtom);
    const [minimizedIds, setMinimizedIds] = React.useState<Set<string>>(new Set());

    // On mobile, start with all pinned viewers minimized
    const initializedForMobile = React.useRef(false);
    React.useEffect(() => {
        if (isMobile && !initializedForMobile.current && pinnedIds.size > 0) {
            initializedForMobile.current = true;
            setMinimizedIds(new Set(pinnedIds));
        }
    }, [isMobile, pinnedIds]);

    // Resolve pinned IDs to actual Card / Camera / PMT / Sample instances (filter stale IDs)
    const pinnedComponents = Array.from(pinnedIds)
        .map(id => components.find(c => c.id === id))
        .filter((c): c is OpticalComponent =>
            c instanceof Card
            || c instanceof Camera
            || (c instanceof PMT && (c as PMT).hasValidAxes())
            || c instanceof Sample
            || c instanceof SampleChamber
        );

    if (pinnedComponents.length === 0) return null;

    // Reserve space for the Sidebar on the left so pinned viewers don't slide
    // behind it. On mobile the sidebar is an overlay (transformed off-screen
    // when closed), so we can hug the left edge there.
    const sidebarWidth = isMobile ? 0 : 250;
    return (
        <div style={{
            position: 'fixed',
            top: isMobile ? undefined : undefined,
            bottom: isMobile ? '8px' : '20px',
            left: isMobile ? '8px' : `${sidebarWidth + 20}px`,
            right: isMobile ? undefined : '20px',
            maxWidth: isMobile ? '40vw' : undefined,
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: isMobile ? '4px' : '8px',
            zIndex: 10,
            pointerEvents: 'none',
            alignItems: 'flex-end',
        }}>
            {pinnedComponents.map(comp => (
                <div
                    key={comp.id}
                    style={{
                        backgroundColor: '#222',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        padding: isMobile && comp instanceof Camera ? '0' : '6px',
                        fontFamily: 'sans-serif',
                        pointerEvents: 'auto',
                        overflow: 'hidden',
                        maxHeight: isMobile && comp instanceof Camera ? '12vh' : undefined,
                        maxWidth: isMobile && comp instanceof Camera ? '40vw' : undefined,
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
                        <CardViewer card={comp} compact />
                    )}
                    {minimizedIds.has(comp.id) && comp instanceof Card && (comp as Card).beamProfiles.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace', marginTop: '2px' }}>
                            {fmtPowerCompact((comp as Card).beamProfiles.reduce((sum, p) => sum + p.power, 0))}
                        </div>
                    )}
                    {!minimizedIds.has(comp.id) && comp instanceof Camera && (
                        <CameraViewer
                            camera={comp}
                            isRendering={isRendering}
                            isMobile={isMobile}
                            onRefresh={() => {
                                if (isRendering) return;
                                if (animator.channels.length > 0) {
                                    // Animation channels present — auto scan accumulation
                                    setScanAccumConfig({ steps: scanAccumConfig.steps, trigger: scanAccumConfig.trigger + 1 });
                                } else {
                                    setSolver3Trigger(n => n + 1);
                                }
                            }}
                        />
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
                                compact
                                onRefresh={() => {
                                    if (isRendering) return;
                                    pmt.markScanStale();
                                    pmt.version++;
                                    setScanAccumConfig({ steps: 16, trigger: scanAccumConfig.trigger + 1 });
                                }}
                            />
                        );
                    })()}
                </div>
            ))}
        </div>
    );
};
