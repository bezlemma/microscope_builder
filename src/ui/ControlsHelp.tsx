import React, { useState } from 'react';

export const ControlsHelp: React.FC = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setOpen(!open)}
                title="Keyboard & mouse controls"
                style={{
                    position: 'absolute',
                    bottom: 16,
                    right: 16,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: '1px solid #555',
                    backgroundColor: open ? '#333' : 'rgba(30,30,30,0.7)',
                    color: '#aaa',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 100,
                    transition: 'all 0.15s',
                }}
            >
                ?
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: 52,
                        right: 16,
                        width: 280,
                        backgroundColor: 'rgba(25, 25, 25, 0.95)',
                        color: '#ccc',
                        padding: 14,
                        borderRadius: 8,
                        border: '1px solid #444',
                        fontFamily: 'sans-serif',
                        fontSize: '11px',
                        lineHeight: '1.6',
                        zIndex: 100,
                        maxHeight: 'calc(100vh - 80px)',
                        overflowY: 'auto',
                    }}
                >
                    <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: 10, color: '#fff' }}>Controls</div>

                    <Section title="Navigate">
                        <Row keys="Middle-drag / Shift+Drag / WASD" action="Pan" />
                        <Row keys="Alt+Drag / Alt+Middle-drag" action="Rotate" />
                        <Row keys="Scroll / []" action="Zoom" />
                    </Section>

                    <Section title="Components">
                        <Row keys="Click" action="Select" />
                        <Row keys="Shift + Click" action="Multi-select" />
                        <Row keys="Drag" action="Move" />
                        <Row keys="Scroll / Q/E" action="Rotate" />
                        <Row keys="Escape" action="Deselect all" />
                        <Row keys="Delete" action="Remove" />
                    </Section>
                </div>
            )}
        </>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3, borderBottom: '1px solid #333', paddingBottom: 3 }}>{title}</div>
        {children}
    </div>
);

const Row: React.FC<{ keys: string; action: string }> = ({ keys, action }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1px 0' }}>
        <span style={{ color: '#7af', fontFamily: 'monospace', fontSize: '10px' }}>{keys}</span>
        <span style={{ color: '#999', fontSize: '10px' }}>{action}</span>
    </div>
);
