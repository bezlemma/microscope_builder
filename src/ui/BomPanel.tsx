import React, { useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, PackageSearch } from 'lucide-react';
import type { OpticalComponent } from '../physics/Component';
import { summarizeBom } from '../catalog/catalog';

export const BomPanel: React.FC<{
    components: OpticalComponent[];
    isMobile: boolean;
}> = ({ components, isMobile }) => {
    const [open, setOpen] = useState(false);
    const summary = useMemo(() => summarizeBom(components), [components]);
    const count = summary.lines.reduce((total, line) => total + line.quantity, 0);
    const maxHeight = summary.lines.length === 0 ? 34 : Math.min(260, 34 + summary.lines.length * 74);

    if (count === 0) return null;

    return (
        <div style={{ marginBottom: 16, paddingTop: 10, borderTop: '1px solid #333' }}>
            <div
                onClick={() => setOpen(prev => !prev)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: isMobile ? '5px 6px' : '8px 10px',
                    cursor: 'pointer',
                    backgroundColor: open ? '#2a2a2a' : 'transparent',
                    borderRadius: 6,
                    transition: 'all 0.15s ease',
                    userSelect: 'none',
                }}
                onMouseOver={(event) => {
                    if (!open) event.currentTarget.style.backgroundColor = '#222';
                }}
                onMouseOut={(event) => {
                    if (!open) event.currentTarget.style.backgroundColor = 'transparent';
                }}
            >
                <ChevronRight
                    size={isMobile ? 11 : 14}
                    style={{
                        marginRight: isMobile ? 4 : 6,
                        color: '#888',
                        transition: 'transform 0.2s ease',
                        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                        flexShrink: 0,
                    }}
                />
                <PackageSearch size={isMobile ? 11 : 14} style={{ marginRight: isMobile ? 5 : 8, color: '#64ffda', flexShrink: 0 }} />
                <span style={{
                    fontSize: isMobile ? 10 : 12,
                    fontWeight: 600,
                    color: open ? '#fff' : '#aaa',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                }}>
                    BoM ({count})
                </span>
            </div>

            <div style={{
                overflow: 'hidden',
                maxHeight: open ? `${maxHeight}px` : '0px',
                transition: 'max-height 0.25s ease',
                marginLeft: 4,
                borderLeft: open ? '2px solid rgba(100, 255, 218, 0.25)' : '2px solid transparent',
            }}>
                {summary.lines.length === 0 && (
                    <div style={{
                        padding: isMobile ? '5px 6px 5px 16px' : '6px 12px 6px 24px',
                        color: '#666',
                        fontSize: isMobile ? 11 : 12,
                        fontStyle: 'italic',
                    }}>
                        No catalog parts attached
                    </div>
                )}
                {summary.lines.map(line => (
                    <div
                        key={line.part.partId}
                        style={{
                            padding: isMobile ? '6px 6px 6px 16px' : '8px 10px 8px 24px',
                            color: '#cbd6df',
                            fontSize: isMobile ? 10 : 11,
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#fff', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {line.part.sku}
                            </span>
                            <span style={{ marginLeft: 'auto', color: '#64ffda' }}>x{line.quantity}</span>
                        </div>
                        <div style={{ color: '#7d8c99', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                            {line.part.vendor.toUpperCase()} · {line.part.confidence}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: 5 }}>
                            <span style={{ color: '#6d7a84' }}>
                                {line.totalPrice !== undefined && line.currency
                                    ? `${line.currency} ${line.totalPrice.toFixed(2)}`
                                    : 'price not cached'}
                            </span>
                            {line.part.productUrl && (
                                <a
                                    href={line.part.productUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Open vendor page"
                                    style={{
                                        marginLeft: 'auto',
                                        display: 'inline-flex',
                                        color: '#8cc9ff',
                                        textDecoration: 'none',
                                    }}
                                >
                                    <ExternalLink size={12} />
                                </a>
                            )}
                        </div>
                    </div>
                ))}
                {Object.entries(summary.totalByCurrency).map(([currency, total]) => (
                    <div
                        key={currency}
                        style={{
                            padding: isMobile ? '5px 6px 5px 16px' : '6px 10px 6px 24px',
                            color: '#e6eef6',
                            fontSize: isMobile ? 10 : 11,
                            fontWeight: 700,
                        }}
                    >
                        Total: {currency} {total.toFixed(2)}
                    </div>
                ))}
            </div>
        </div>
    );
};
