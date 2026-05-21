import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { activePresetAtom, componentsAtom, mobilePanelModeAtom, PresetName, tutorialStageAtom } from '../state/store';
import { Camera } from '../physics/components/Camera';
import { useIsMobile } from './useIsMobile';

interface CalloutLayout {
    left: number;
    top: number;
    width: number;
    arrowTop: number;
    anchor: 'menu' | 'drawer';
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function findSidebarAnchor(isMobile: boolean): { rect: DOMRect; anchor: CalloutLayout['anchor'] } | null {
    if (isMobile) {
        const mobileMenu = document.querySelector('[data-mobile-sidebar-toggle="true"]') as HTMLElement | null;
        const mobileMenuRect = mobileMenu?.getBoundingClientRect();
        if (mobileMenuRect && mobileMenuRect.width > 0 && mobileMenuRect.height > 0) {
            return { rect: mobileMenuRect, anchor: 'menu' };
        }
    }

    const openDetectors = document.querySelector('[data-component-group-root="Detectors"][data-open="true"]');
    const cameraItem = openDetectors?.querySelector('[data-component-type="camera"]') as HTMLElement | null;
    const detectorsGroup = document.querySelector('[data-component-group="Detectors"]') as HTMLElement | null;
    const anchor = cameraItem ?? detectorsGroup;
    const rect = anchor?.getBoundingClientRect() ?? null;
    return rect ? { rect, anchor: 'drawer' } : null;
}

function computeLayout(isMobile: boolean): CalloutLayout {
    const viewportW = window.innerWidth || 1024;
    const viewportH = window.innerHeight || 768;
    const anchor = findSidebarAnchor(isMobile);
    const anchorRect = anchor?.rect ?? null;
    const fallbackTargetY = isMobile ? 30 : 112;
    const fallbackTargetRight = isMobile ? 50 : 0;
    const targetY = anchorRect ? anchorRect.top + anchorRect.height / 2 : fallbackTargetY;
    const targetRight = anchorRect ? anchorRect.right : fallbackTargetRight;
    const anchorKind = anchor?.anchor ?? 'menu';
    if (isMobile && anchorKind === 'menu') {
        const left = clamp(targetRight + 18, 12, Math.max(12, viewportW - 172));
        const width = Math.min(300, Math.max(220, viewportW - left - 12));
        return {
            left,
            top: clamp((anchorRect?.bottom ?? 50) + 34, 82, Math.max(82, viewportH - 150)),
            width,
            arrowTop: 16,
            anchor: 'menu',
        };
    }

    const width = isMobile
        ? Math.min(300, Math.max(220, viewportW - targetRight - 32))
        : Math.min(340, Math.max(240, viewportW - targetRight - 56));
    const left = isMobile
        ? clamp(targetRight + 18, 12, Math.max(12, viewportW - width - 12))
        : clamp(targetRight + 36, 12, Math.max(12, viewportW - width - 12));
    const top = isMobile
        ? clamp(targetY - 40, 12, Math.max(12, viewportH - 150))
        : clamp(targetY - 42, 12, Math.max(12, viewportH - 150));

    return {
        left,
        top,
        width,
        arrowTop: clamp(targetY - top, 16, 112),
        anchor: anchorKind,
    };
}

export const TutorialDomOverlay: React.FC = () => {
    const activePreset = useAtomValue(activePresetAtom);
    const tutorialStage = useAtomValue(tutorialStageAtom);
    const components = useAtomValue(componentsAtom);
    const mobilePanelMode = useAtomValue(mobilePanelModeAtom);
    const isMobile = useIsMobile();
    const [layout, setLayout] = useState<CalloutLayout | null>(null);
    const hasRealCamera = components.some(component => component instanceof Camera && !component.isGhost);
    const mobilePropertiesOpen = isMobile && mobilePanelMode === 'properties';

    useEffect(() => {
        if (activePreset !== PresetName.Tutorial2 || tutorialStage !== 2 || hasRealCamera || mobilePropertiesOpen) {
            setLayout(null);
            return;
        }

        const update = () => setLayout(computeLayout(isMobile));
        update();

        const observer = new MutationObserver(update);
        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['data-open', 'style', 'class'],
        });

        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        const interval = window.setInterval(update, 250);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
            window.clearInterval(interval);
        };
    }, [activePreset, hasRealCamera, isMobile, mobilePropertiesOpen, tutorialStage]);

    if (activePreset !== PresetName.Tutorial2 || tutorialStage !== 2 || hasRealCamera || mobilePropertiesOpen) return null;

    return (
        <div
            className={`tutorial-sidebar-callout ${layout?.anchor === 'menu' ? 'menu-anchor' : ''}`}
            style={layout ? {
                left: `${layout.left}px`,
                top: `${layout.top}px`,
                width: `${layout.width}px`,
            } : undefined}
        >
            <div className="tutorial-callout-title">
                {isMobile ? 'Open Components' : 'Add the Camera'}
            </div>
            <div className="tutorial-callout-body">
                {isMobile
                    ? layout?.anchor === 'menu'
                        ? 'Tap the menu to open the parts drawer, then drag Camera from Detectors onto the table.'
                        : 'Drag Camera from Detectors onto the table, then move and rotate it onto the target.'
                    : 'Open Detectors, drag Camera onto the table, then move and rotate it onto the target.'}
            </div>
            <div
                className="tutorial-sidebar-arrow"
                aria-hidden="true"
                style={layout ? { top: `${layout.arrowTop}px` } : undefined}
            />
        </div>
    );
};
