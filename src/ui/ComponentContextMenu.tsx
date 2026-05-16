// Right-click / long-press context menu on an OpticalComponent.
// V1 actions are all paraxial geometric "snaps": move this part to the
// focal / Fourier / image plane of some other part, or rotate it so its
// optical axis matches the incoming beam.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAtom, useStore } from 'jotai';
import { ChevronRight } from 'lucide-react';
import {
    componentsAtom,
    contextMenuAtom,
    forwardRaysAtom,
    hoveredAlignmentTargetAtom,
    pushUndoAtom,
} from '../state/store';
import { OpticalComponent } from '../physics/Component';
import {
    alignAxisToIncomingBeam,
    getFocalLength,
    isFocusingOptic,
    isImageableObject,
    moveToFocalPlaneOf,
    moveToFourierPlaneOf,
    moveToImagePlaneOf,
} from '../physics/alignmentOps';

const MENU_BG = 'rgba(20, 24, 30, 0.96)';
const BORDER = '1px solid rgba(148, 163, 184, 0.28)';
const ACCENT = '#64ffda';
const TEXT = '#e2eaf4';
const DIM = '#8a96a4';

interface MenuItemProps {
    label: string;
    disabled?: boolean;
    accent?: boolean;
    submenu?: { id: string; label: string; subLabel?: string }[];
    onSelect?: () => void;
    onSubSelect?: (id: string) => void;
    onSubHover?: (id: string | null) => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ label, disabled, accent, submenu, onSelect, onSubSelect, onSubHover }) => {
    const [open, setOpen] = useState(false);
    const itemRef = useRef<HTMLDivElement | null>(null);
    const hasSubmenu = !!submenu && submenu.length > 0;
    const greyedOut = disabled || (hasSubmenu && submenu!.length === 0);

    const bg = open && !greyedOut ? 'rgba(100, 255, 218, 0.10)' : 'transparent';
    const fg = greyedOut ? DIM : (accent ? ACCENT : TEXT);

    return (
        <div
            ref={itemRef}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => { setOpen(false); onSubHover?.(null); }}
            onClick={() => {
                if (greyedOut) return;
                if (!hasSubmenu) onSelect?.();
            }}
            style={{
                position: 'relative',
                padding: '7px 14px',
                cursor: greyedOut ? 'default' : 'pointer',
                color: fg,
                fontSize: 12.5,
                lineHeight: 1.3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: bg,
                transition: 'background-color 0.1s',
                whiteSpace: 'nowrap',
                userSelect: 'none',
            }}
        >
            <span>{label}</span>
            {hasSubmenu && <ChevronRight size={13} color={fg} />}
            {hasSubmenu && open && !greyedOut && submenu!.length > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: -4,
                        left: '100%',
                        background: MENU_BG,
                        border: BORDER,
                        borderRadius: 8,
                        padding: '4px 0',
                        boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(10px)',
                        minWidth: 200,
                        zIndex: 1,
                    }}
                >
                    {submenu!.map(s => (
                        <div
                            key={s.id}
                            onClick={(ev) => { ev.stopPropagation(); onSubSelect?.(s.id); onSubHover?.(null); }}
                            style={{
                                padding: '6px 14px',
                                cursor: 'pointer',
                                fontSize: 12.5,
                                color: TEXT,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                lineHeight: 1.25,
                            }}
                            onMouseEnter={(ev) => {
                                (ev.currentTarget as HTMLDivElement).style.background = 'rgba(100, 255, 218, 0.10)';
                                onSubHover?.(s.id);
                            }}
                            onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                                {s.label}
                            </span>
                            {s.subLabel && (
                                <span style={{ color: DIM, fontSize: 10.5, fontWeight: 400 }}>{s.subLabel}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const Divider: React.FC = () => (
    <div style={{ height: 1, background: 'rgba(148, 163, 184, 0.18)', margin: '4px 0' }} />
);

export const ComponentContextMenu: React.FC = () => {
    const [menu, setMenu] = useAtom(contextMenuAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [, setHoveredTarget] = useAtom(hoveredAlignmentTargetAtom);
    const store = useStore();
    const menuRef = useRef<HTMLDivElement | null>(null);

    const closeMenu = () => {
        setHoveredTarget(null);
        setMenu(null);
    };

    const target: OpticalComponent | null = useMemo(() => {
        if (!menu) return null;
        return components.find(c => c.id === menu.componentId) ?? null;
    }, [components, menu]);

    // Pick candidate components for each submenu. We list everything in the
    // scene that fits, excluding the target itself.
    const lensCandidates = useMemo(() => {
        if (!target) return [];
        return components
            .filter(c => c.id !== target.id && !c.isGhost && !c.isSubComponent && isFocusingOptic(c))
            .map(c => {
                const f = getFocalLength(c);
                return {
                    id: c.id,
                    label: c.name,
                    subLabel: f !== null && Number.isFinite(f) ? `f = ${f.toFixed(1)} mm` : undefined,
                };
            });
    }, [components, target]);

    const sourceCandidates = useMemo(() => {
        if (!target) return [];
        return components
            .filter(c => c.id !== target.id && !c.isGhost && !c.isSubComponent && isImageableObject(c))
            .map(c => ({ id: c.id, label: c.name }));
    }, [components, target]);

    // Clicking anywhere off-menu closes it. We bind on `mousedown` so right-
    // clicks elsewhere also dismiss before opening their own menu.
    useEffect(() => {
        if (!menu) return;
        const close = (e: MouseEvent) => {
            if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
            closeMenu();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeMenu();
        };
        window.addEventListener('mousedown', close);
        window.addEventListener('contextmenu', close, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', close);
            window.removeEventListener('contextmenu', close, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [menu, setMenu]);

    if (!menu || !target) return null;

    // Clamp position so the menu stays on-screen.
    const MAX_W = 260;
    const MAX_H = 220;
    const x = Math.min(menu.x, window.innerWidth - MAX_W - 8);
    const y = Math.min(menu.y, window.innerHeight - MAX_H - 8);

    const apply = (fn: (t: OpticalComponent, other: OpticalComponent) => boolean, otherId: string) => {
        const other = components.find(c => c.id === otherId);
        if (!other) return;
        pushUndo();
        const ok = fn(target, other);
        if (ok) {
            // Bump components atom by reference so subscribers re-render.
            setComponents([...components]);
        }
        closeMenu();
    };

    const applyImagePlane = (sourceId: string) => {
        const source = components.find(c => c.id === sourceId);
        if (!source) return;
        pushUndo();
        const ok = moveToImagePlaneOf(target, source, components);
        if (ok) setComponents([...components]);
        closeMenu();
    };

    const applyAlignAxis = () => {
        pushUndo();
        const ok = alignAxisToIncomingBeam(target, store.get(forwardRaysAtom));
        if (ok) setComponents([...components]);
        closeMenu();
    };

    const hasForwardRays = store.get(forwardRaysAtom).length > 0;

    return (
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                top: y,
                left: x,
                minWidth: 240,
                background: MENU_BG,
                border: BORDER,
                borderRadius: 10,
                padding: '6px 0',
                boxShadow: '0 16px 44px rgba(0,0,0,0.6), 0 0 0 1px rgba(100, 255, 218, 0.05)',
                backdropFilter: 'blur(12px)',
                fontFamily: 'var(--ui-font)',
                zIndex: 200,
                color: TEXT,
                pointerEvents: 'auto',
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div style={{
                padding: '6px 14px 4px',
                color: ACCENT,
                fontSize: 9.5,
                letterSpacing: 1.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}>
                {target.name}
            </div>
            <Divider />
            <MenuItem
                label="Move to focal plane of…"
                submenu={lensCandidates}
                onSubSelect={(id) => apply(moveToFocalPlaneOf, id)}
                onSubHover={setHoveredTarget}
            />
            <MenuItem
                label="Move to Fourier plane of…"
                submenu={lensCandidates}
                onSubSelect={(id) => apply(moveToFourierPlaneOf, id)}
                onSubHover={setHoveredTarget}
            />
            <MenuItem
                label="Move to image plane of…"
                submenu={sourceCandidates}
                onSubSelect={applyImagePlane}
                onSubHover={setHoveredTarget}
            />
            <Divider />
            <MenuItem
                label="Center on incoming beam"
                disabled={!hasForwardRays}
                onSelect={applyAlignAxis}
            />
        </div>
    );
};
