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
import { componentsAtom, pinnedViewersAtom, solver3RenderingAtom } from '../state/store';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';
import { CardViewer } from './CardViewer';
import { CameraViewer } from './CameraViewer';
import { OpticalComponent } from '../physics/Component';

export const ViewerPanels: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);

    // Resolve pinned IDs to actual Card or Camera instances (filter stale IDs)
    const pinnedComponents = Array.from(pinnedIds)
        .map(id => components.find(c => c.id === id))
        .filter((c): c is OpticalComponent => c instanceof Card || c instanceof Camera);

    if (pinnedComponents.length === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '320px',
            display: 'flex',
            flexDirection: 'row',
            gap: '8px',
            zIndex: 10,
            pointerEvents: 'none',
        }}>
            {pinnedComponents.map(comp => (
                <div
                    key={comp.id}
                    style={{
                        backgroundColor: '#222',
                        border: '1px solid #444',
                        borderRadius: '8px',
                        padding: '6px',
                        fontFamily: 'sans-serif',
                        pointerEvents: 'auto',
                    }}
                >
                    {/* Header: name + close button */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                        paddingLeft: '2px',
                    }}>
                        <span style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#999',
                        }}>
                            {comp.name}
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

                    {/* Viewer content */}
                    {comp instanceof Card && (
                        <CardViewer card={comp} compact />
                    )}
                    {comp instanceof Camera && (
                        <CameraViewer
                            camera={comp}
                            isRendering={isRendering}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};
