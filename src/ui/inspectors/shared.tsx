/**
 * Shared utilities and components for sub-inspectors.
 */
import React from 'react';

// ─── Collapsible Section ────────────────────────────────────────────

export const CollapsibleSection: React.FC<{
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}> = ({ title, defaultOpen = true, children }) => {
    const [isOpen, setIsOpen] = React.useState(defaultOpen);
    return (
        <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 8 }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'none', border: 'none', color: '#999',
                    cursor: 'pointer', fontSize: '10px', padding: 0,
                    display: 'flex', alignItems: 'center', gap: 4,
                    width: '100%', textAlign: 'left', marginBottom: isOpen ? 8 : 0,
                }}
            >
                <span style={{
                    display: 'inline-block', width: 10, textAlign: 'center',
                    transition: 'transform 0.15s',
                    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    fontSize: '8px',
                }}>▶</span>
                <span>{title}</span>
            </button>
            {isOpen && children}
        </div>
    );
};

// ─── Shared Inspector Input Style ───────────────────────────────────

export const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    background: '#222',
    color: '#ccc',
    border: '1px solid #555',
    borderRadius: 4,
    fontSize: '11px',
};
