import React, { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import { activePresetAtom, presetDescriptionAtom } from '../state/store';
import { useIsMobile } from './useIsMobile';

const STORAGE_KEY = 'microscope-builder-dismissed-preset-tooltips';

function readDismissedKeys(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
    } catch {
        return new Set();
    }
}

function writeDismissedKeys(keys: Set<string>) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
        // Private browsing or storage-disabled contexts should still allow
        // closing the tooltip for this session.
    }
}

export const PresetTooltip: React.FC = () => {
    const activePreset = useAtomValue(activePresetAtom);
    const description = useAtomValue(presetDescriptionAtom);
    const isMobile = useIsMobile();
    const tooltipKey = useMemo(() => activePreset ?? 'custom-scene', [activePreset]);
    const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => readDismissedKeys());

    if (!description || dismissedKeys.has(tooltipKey)) {
        return null;
    }

    const dismissPermanently = () => {
        setDismissedKeys(prev => {
            const next = new Set(prev);
            next.add(tooltipKey);
            writeDismissedKeys(next);
            return next;
        });
    };

    const iconButton: React.CSSProperties = {
        width: 24,
        height: 24,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(198, 216, 232, 0.18)',
        borderRadius: 4,
        background: 'rgba(255, 255, 255, 0.04)',
        color: '#b9cadd',
        cursor: 'pointer',
        flexShrink: 0,
    };

    return (
        <div
            style={{
                position: 'absolute',
                top: isMobile ? 58 : 12,
                left: isMobile ? 58 : 12,
                zIndex: 12,
                maxWidth: isMobile ? 'calc(100vw - 80px)' : 330,
                padding: '10px 10px 10px 12px',
                border: '1px solid rgba(100, 255, 218, 0.28)',
                borderRadius: 6,
                background: 'rgba(18, 22, 28, 0.92)',
                color: '#c6d8e8',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                backdropFilter: 'blur(8px)',
                fontFamily: 'var(--ui-font)',
                fontSize: 'var(--workspace-font-size)',
                lineHeight: 1.35,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>{description}</div>
                <button
                    type="button"
                    title="Close tooltip"
                    aria-label="Close tooltip"
                    onClick={dismissPermanently}
                    style={iconButton}
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};
