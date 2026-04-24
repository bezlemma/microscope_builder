import React, { useMemo } from 'react';
import { useAtom } from 'jotai';
import { componentsAtom, activeZLevelAtom } from '../state/store';
import { DualGalvoScanHead } from '../physics/components/DualGalvoScanHead';

function roundTo1(v: number): number {
    return Math.round(v * 10) / 10;
}

/**
 * ZLevelBar — White vertical timeline of discrete Z heights.
 *
 * Floats below the SolverPanel on the right edge. No background —
 * just a white vertical line with circular nodes and labels to
 * their left. Only visible when the scene contains components at
 * 2+ distinct Z levels.
 */
export const ZLevelBar: React.FC = () => {
    const [components] = useAtom(componentsAtom);
    const [activeZ, setActiveZ] = useAtom(activeZLevelAtom);

    const levels = useMemo(() => {
        const set = new Set<number>();
        for (const c of components) {
            set.add(roundTo1(c.position.z));
            if (c instanceof DualGalvoScanHead) {
                set.add(roundTo1(c.position.z + c.mirrorSpacing));
            }
        }
        return Array.from(set).sort((a, b) => b - a);
    }, [components]);

    if (levels.length < 2) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 240,
            right: 28,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            zIndex: 15,
            pointerEvents: 'none',
        }}>
            {/* Timeline container — line on the right, labels on the left */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                position: 'relative',
                paddingRight: 8,
            }}>
                {/* White vertical timeline line */}
                <div style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: '#fff',
                    borderRadius: 1,
                }} />

                {levels.map((z, i) => {
                    const isActive = z === activeZ;
                    return (
                        <button
                            key={z}
                            onClick={() => setActiveZ(z)}
                            style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                background: 'none',
                                border: 'none',
                                padding: '6px 0',
                                marginTop: i === 0 ? 0 : 6,
                                cursor: 'pointer',
                                outline: 'none',
                                pointerEvents: 'auto',
                            }}
                            title={`Build at Z = ${z} mm`}
                        >
                            {/* Label — to the left of the node */}
                            <span style={{
                                marginRight: 12,
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                color: isActive ? '#4af' : '#fff',
                                fontWeight: isActive ? 700 : 400,
                                whiteSpace: 'nowrap',
                                transition: 'color 0.15s ease',
                                textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                            }}>
                                {z} mm
                            </span>

                            {/* Horizontal tick from label to node */}
                            <div style={{
                                width: 8,
                                height: 2,
                                backgroundColor: isActive ? '#4af' : '#fff',
                                marginRight: -1,
                                transition: 'background-color 0.15s ease',
                            }} />

                            {/* Circular node on the timeline */}
                            <div style={{
                                position: 'absolute',
                                right: -8,
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                border: isActive ? '2px solid #4af' : '2px solid #fff',
                                backgroundColor: isActive ? '#4af' : '#222',
                                transition: 'all 0.15s ease',
                            }} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
