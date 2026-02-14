/**
 * ViewerPanels — floating card viewer panels that can be toggled on independently
 * of the Inspector selection. These appear at the bottom-left of the viewport
 * (where the Physics Solvers box used to be). Multiple panels stack horizontally.
 * Each shows only the canvas — no properties, no delete, no readout text.
 *
 * Future: will also support Camera view panels for Solver 3.
 */
import React from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, pinnedViewersAtom } from '../state/store';
import { Card } from '../physics/components/Card';
import { CardViewer } from './CardViewer';

export const ViewerPanels: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [pinnedIds, setPinnedIds] = useAtom(pinnedViewersAtom);

    // Resolve pinned IDs to actual Card instances (filter stale IDs)
    const pinnedCards = Array.from(pinnedIds)
        .map(id => components.find(c => c.id === id))
        .filter((c): c is Card => c instanceof Card);

    if (pinnedCards.length === 0) return null;

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
            {pinnedCards.map(card => (
                <div
                    key={card.id}
                    style={{
                        backgroundColor: '#222',
                        border: '1px solid #444',
                        borderRadius: '8px',
                        padding: '6px',
                        fontFamily: 'sans-serif',
                        pointerEvents: 'auto',
                    }}
                >
                    {/* Header: card name + close button */}
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
                            {card.name}
                        </span>
                        <button
                            onClick={() => {
                                const next = new Set(pinnedIds);
                                next.delete(card.id);
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

                    {/* Card viewer — compact: just the animated canvas, no readout text */}
                    <CardViewer card={card} compact />
                </div>
            ))}
        </div>
    );
};
