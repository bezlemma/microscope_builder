import React, { useMemo } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { QPD } from '../physics/components/QPD';
import { TrappedBead } from '../physics/components/TrappedBead';
import {
    componentsAtom,
    forwardRaysRevisionAtom,
    trapBeamSegmentsAtom,
    trapBeamSegmentsRevisionAtom,
} from '../state/store';
import { estimateTrapFieldDiagnostics } from '../physics/trapDiagnostics';

interface QPDViewerProps {
    qpd: QPD;
    compact?: boolean;
}

function fmtPower(watts: number): string {
    if (!Number.isFinite(watts) || watts <= 0) return '0 W';
    if (watts >= 1) return `${watts.toFixed(2)} W`;
    if (watts >= 1e-3) return `${(watts * 1e3).toFixed(2)} mW`;
    if (watts >= 1e-6) return `${(watts * 1e6).toFixed(2)} uW`;
    if (watts >= 1e-9) return `${(watts * 1e9).toFixed(2)} nW`;
    return `${watts.toExponential(2)} W`;
}

function fmtRate(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value >= 10) return value.toFixed(0);
    return value.toFixed(1);
}

function fmtPercent(value: number): string {
    return `${Math.round(Math.max(0, value) * 100)}%`;
}

function statusForQPD(qpd: QPD): { label: string; color: string } {
    if (qpd.interceptedPower <= 1e-12) return { label: 'no signal', color: '#ff6b8a' };
    if (qpd.signalSum <= 1e-12) return { label: 'no quadrant signal', color: '#ff6b8a' };
    if (qpd.clippedFraction > 0.08) return { label: 'clipped', color: '#ff6b8a' };
    const radial = Math.hypot(qpd.signalX, qpd.signalY);
    if (radial > 0.35) return { label: 'off center', color: '#ffd166' };
    if (qpd.fillRatio < 0.06) return { label: 'underfilled', color: '#ffd166' };
    if (qpd.fillRatio > 0.8) return { label: 'near edge', color: '#ffd166' };
    return { label: 'centered', color: '#7ee081' };
}

export const QPDViewer: React.FC<QPDViewerProps> = ({ qpd, compact }) => {
    const components = useAtomValue(componentsAtom);
    const forwardRaysRevision = useAtomValue(forwardRaysRevisionAtom);
    const trapBeamSegmentsRevision = useAtomValue(trapBeamSegmentsRevisionAtom);
    const store = useStore();
    const size = compact ? 128 : 220;
    const status = statusForQPD(qpd);
    const maxQuadrant = Math.max(...qpd.quadrants, 1e-15);

    const trapField = useMemo(() => {
        const bead = components.find((component): component is TrappedBead => component instanceof TrappedBead);
        return bead ? estimateTrapFieldDiagnostics(bead, store.get(trapBeamSegmentsAtom)) : null;
    }, [components, forwardRaysRevision, trapBeamSegmentsRevision, store]);

    const spotX = size / 2 + qpd.signalX * size * 0.38;
    const spotY = size / 2 - qpd.signalY * size * 0.38;
    const beamR = Math.max(3, Math.min(size * 0.42, (qpd.fillRatio || 0) * size * 0.42));
    const quadrantOpacity = (power: number) => 0.12 + 0.72 * Math.sqrt(Math.max(0, power) / maxQuadrant);
    const labelStyle: React.CSSProperties = { color: '#8391a1', fontSize: compact ? 9 : 10 };
    const valueStyle: React.CSSProperties = { color: '#dcecff', fontSize: compact ? 10 : 11, fontFamily: 'monospace' };
    const rowStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        gap: compact ? 6 : 10,
        lineHeight: 1.35,
    };
    const containerStyle: React.CSSProperties = compact
        ? {
            width: '100%',
            maxWidth: 330,
            color: '#dcecff',
            fontFamily: 'sans-serif',
            marginTop: 4,
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${size}px, 1fr))`,
            gap: 8,
            alignItems: 'start',
        }
        : {
            width: size,
            color: '#dcecff',
            fontFamily: 'sans-serif',
            marginTop: 4,
        };

    return (
        <div style={containerStyle}>
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                style={{
                    display: 'block',
                    background: '#06080b',
                    border: '1px solid #333',
                    borderRadius: 4,
                }}
            >
                <circle cx={size / 2} cy={size / 2} r={size * 0.44} fill="#101820" stroke="#3c4652" strokeWidth="1.2" />
                <path d={`M ${size / 2} ${size / 2} L ${size * 0.12} ${size / 2} A ${size * 0.38} ${size * 0.38} 0 0 1 ${size / 2} ${size * 0.12} Z`} fill="#7db3ff" opacity={quadrantOpacity(qpd.quadrants[0])} />
                <path d={`M ${size / 2} ${size / 2} L ${size / 2} ${size * 0.12} A ${size * 0.38} ${size * 0.38} 0 0 1 ${size * 0.88} ${size / 2} Z`} fill="#7db3ff" opacity={quadrantOpacity(qpd.quadrants[1])} />
                <path d={`M ${size / 2} ${size / 2} L ${size * 0.12} ${size / 2} A ${size * 0.38} ${size * 0.38} 0 0 0 ${size / 2} ${size * 0.88} Z`} fill="#7db3ff" opacity={quadrantOpacity(qpd.quadrants[2])} />
                <path d={`M ${size / 2} ${size / 2} L ${size / 2} ${size * 0.88} A ${size * 0.38} ${size * 0.38} 0 0 0 ${size * 0.88} ${size / 2} Z`} fill="#7db3ff" opacity={quadrantOpacity(qpd.quadrants[3])} />
                <line x1={size * 0.1} y1={size / 2} x2={size * 0.9} y2={size / 2} stroke="#06080b" strokeWidth={Math.max(3, size * 0.025)} />
                <line x1={size / 2} y1={size * 0.1} x2={size / 2} y2={size * 0.9} stroke="#06080b" strokeWidth={Math.max(3, size * 0.025)} />
                <circle cx={size / 2} cy={size / 2} r={size * 0.44} fill="none" stroke={status.color} strokeOpacity="0.55" strokeWidth="1.4" />
                {qpd.signalSum > 1e-12 && (
                    <>
                        <circle cx={spotX} cy={spotY} r={beamR} fill={status.color} opacity="0.12" />
                        <circle cx={spotX} cy={spotY} r="4" fill="#f3f8ff" stroke={status.color} strokeWidth="1.4" />
                    </>
                )}
                <text x={size * 0.28} y={size * 0.28} fill="#dcecff" opacity="0.72" fontSize="11" fontWeight="700">A</text>
                <text x={size * 0.70} y={size * 0.28} fill="#dcecff" opacity="0.72" fontSize="11" fontWeight="700">B</text>
                <text x={size * 0.28} y={size * 0.74} fill="#dcecff" opacity="0.72" fontSize="11" fontWeight="700">C</text>
                <text x={size * 0.70} y={size * 0.74} fill="#dcecff" opacity="0.72" fontSize="11" fontWeight="700">D</text>
            </svg>

            <div style={{
                marginTop: compact ? 0 : 8,
                padding: compact ? '6px 7px' : '7px 8px',
                background: '#111',
                border: '1px solid #282828',
                borderRadius: 4,
                minWidth: 0,
            }}>
                <div style={{ ...rowStyle, marginBottom: 4 }}>
                    <span style={labelStyle}>Status</span>
                    <span style={{ ...valueStyle, color: status.color, fontWeight: 700 }}>{status.label}</span>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>X</span>
                    <span style={valueStyle}>{qpd.signalSum > 1e-12 ? qpd.signalX.toFixed(4) : '--'}</span>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>Y</span>
                    <span style={valueStyle}>{qpd.signalSum > 1e-12 ? qpd.signalY.toFixed(4) : '--'}</span>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>Sum</span>
                    <span style={valueStyle}>{fmtPower(qpd.signalSum)}</span>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>Fill</span>
                    <span style={valueStyle}>{qpd.signalSum > 1e-12 ? fmtPercent(qpd.fillRatio) : '--'}</span>
                </div>
                <div style={rowStyle}>
                    <span style={labelStyle}>Lost</span>
                    <span style={valueStyle}>{qpd.interceptedPower > 1e-12 ? fmtPercent(qpd.clippedFraction) : '--'}</span>
                </div>
                {!compact && (
                    <>
                        <div style={{ height: 1, background: '#242a31', margin: '7px 0' }} />
                        <div style={rowStyle}>
                            <span style={labelStyle}>A / B</span>
                            <span style={valueStyle}>{fmtPower(qpd.quadrants[0])} / {fmtPower(qpd.quadrants[1])}</span>
                        </div>
                        <div style={rowStyle}>
                            <span style={labelStyle}>C / D</span>
                            <span style={valueStyle}>{fmtPower(qpd.quadrants[2])} / {fmtPower(qpd.quadrants[3])}</span>
                        </div>
                        {trapField && (
                            <>
                                <div style={{ height: 1, background: '#242a31', margin: '7px 0' }} />
                                <div style={rowStyle}>
                                    <span style={labelStyle}>kx</span>
                                    <span style={valueStyle}>{fmtRate(trapField.stiffnessPerSecond.x)} /s</span>
                                </div>
                                <div style={rowStyle}>
                                    <span style={labelStyle}>ky</span>
                                    <span style={valueStyle}>{fmtRate(trapField.stiffnessPerSecond.y)} /s</span>
                                </div>
                                <div style={rowStyle}>
                                    <span style={labelStyle}>kz</span>
                                    <span style={valueStyle}>{fmtRate(trapField.stiffnessPerSecond.z)} /s</span>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
