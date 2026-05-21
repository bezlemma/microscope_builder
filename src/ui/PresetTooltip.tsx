import React, { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import { activePresetAtom, presetDescriptionAtom } from '../state/store';
import { useIsMobile } from './useIsMobile';

export const PresetTooltip: React.FC = () => {
    const activePreset = useAtomValue(activePresetAtom);
    const description = useAtomValue(presetDescriptionAtom);
    const isMobile = useIsMobile();
    const tooltipKey = useMemo(() => activePreset ?? 'custom-scene', [activePreset]);
    const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());

    if (!description || dismissedKeys.has(tooltipKey)) {
        return null;
    }

    const dismissForSession = () => {
        setDismissedKeys(prev => {
            const next = new Set(prev);
            next.add(tooltipKey);
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
                top: isMobile ? undefined : 12,
                bottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 12px)' : undefined,
                left: isMobile ? undefined : 12,
                right: isMobile ? 12 : undefined,
                zIndex: 12,
                maxWidth: isMobile ? 'min(360px, calc(100vw - 24px))' : 330,
                maxHeight: isMobile ? 'min(34vh, 180px)' : undefined,
                padding: isMobile ? '12px 12px 12px 14px' : '10px 10px 10px 12px',
                border: '1px solid rgba(100, 255, 218, 0.28)',
                borderRadius: 6,
                background: 'rgba(18, 22, 28, 0.92)',
                color: '#c6d8e8',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                backdropFilter: 'blur(8px)',
                fontFamily: 'var(--ui-font)',
                fontSize: isMobile ? 13 : 'var(--workspace-font-size)',
                lineHeight: isMobile ? 1.42 : 1.35,
                overflowY: 'auto',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>{description}</div>
                <button
                    type="button"
                    title="Close tooltip"
                    aria-label="Close tooltip"
                    onClick={dismissForSession}
                    style={iconButton}
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};
