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
import { componentsAtom, pinnedViewersAtom, reverseTraceRenderingAtom, uiLockedAtom } from '../state/store';
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
    const [isRendering] = useAtom(reverseTraceRenderingAtom);
    const [uiLocked] = useAtom(uiLockedAtom);
    const [minimizedIds, setMinimizedIds] = React.useState<Set<string>>(new Set());

    // On mobile, start with auxiliary viewers minimized so the screen isn't
    // swamped on first preset load — but EXCLUDE Cameras, since they are the
    // primary image output the user came to see.  Without this exclusion the
    // mobile-camera special-case path below (which suppresses the panel
    // header) leaves the Camera as a 0-px invisible div when minimized,
    // which is exactly the OpenSPIM "camera doesn't show up" bug.
    const initializedForMobile = React.useRef(false);
    React.useEffect(() => {
        if (isMobile && !initializedForMobile.current && pinnedIds.size > 0) {
            initializedForMobile.current = true;
            const toMinimize = new Set<string>();
            for (const id of pinnedIds) {
                const comp = components.find(c => c.id === id);
                if (comp && !(comp instanceof Camera)) toMinimize.add(id);
            }
            setMinimizedIds(toMinimize);
        }
    }, [isMobile, pinnedIds, components]);

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
            // Mobile gives the pinned viewer roughly the bottom-left eighth of
            // the screen — wide enough that the camera/PMT image is readable,
            // bounded so it doesn't swallow the whole bottom half.
            maxWidth: isMobile ? '50vw' : undefined,
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
                        pointerEvents: uiLocked ? 'none' : 'auto',
                        // Don't clip Camera content on mobile — the inner viewer
                        // is laid out at 256px display width plus its controls;
                        // the previous 12vh cap chopped the image in half on
                        // any phone-sized screen. 35vh (≈ a quarter of screen
                        // height) lets the whole image breathe while still
                        // capping the panel's growth.
                        overflow: 'hidden',
                        maxHeight: isMobile && comp instanceof Camera ? 'calc(var(--app-height, 100dvh) * 0.35)' : undefined,
                        maxWidth: isMobile && comp instanceof Camera ? '50vw' : undefined,
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
                        <CardViewer card={comp} />
                    )}
                    {minimizedIds.has(comp.id) && comp instanceof Card && (comp as Card).beamProfiles.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace', marginTop: '2px' }}>
                            {fmtPowerCompact((comp as Card).beamProfiles.reduce((sum, p) => sum + p.power, 0))}
                        </div>
                    )}
                    {minimizedIds.has(comp.id) && comp instanceof QPD && (
                        <div style={{ fontSize: '9px', color: '#777', fontFamily: 'monospace', marginTop: '2px' }}>
                            {fmtPowerCompact((comp as QPD).signalSum)}
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
                                compact
                            />
                        );
                    })()}
                </div>
            ))}
        </div>
    );
};
