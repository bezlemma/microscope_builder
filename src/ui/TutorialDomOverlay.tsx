import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { activePresetAtom, componentsAtom, PresetName, tutorialStageAtom } from '../state/store';
import { Camera } from '../physics/components/Camera';
import { useIsMobile } from './useIsMobile';

interface CalloutLayout {
    left: number;
    top: number;
    width: number;
    arrowTop: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function findSidebarAnchor(): DOMRect | null {
    const openDetectors = document.querySelector('[data-component-group-root="Detectors"][data-open="true"]');
    const cameraItem = openDetectors?.querySelector('[data-component-type="camera"]') as HTMLElement | null;
    const detectorsGroup = document.querySelector('[data-component-group="Detectors"]') as HTMLElement | null;
    const anchor = cameraItem ?? detectorsGroup;
    return anchor?.getBoundingClientRect() ?? null;
}

function computeLayout(isMobile: boolean): CalloutLayout {
    const viewportW = window.innerWidth || 1024;
    const viewportH = window.innerHeight || 768;
    const anchorRect = findSidebarAnchor();
    const fallbackTargetY = isMobile ? 76 : 112;
    const targetY = anchorRect ? anchorRect.top + anchorRect.height / 2 : fallbackTargetY;
    const targetRight = anchorRect ? anchorRect.right : 0;
    const width = isMobile ? Math.min(250, viewportW - 36) : Math.min(340, Math.max(240, viewportW - targetRight - 56));
    const left = isMobile ? 18 : clamp(targetRight + 36, 12, Math.max(12, viewportW - width - 12));
    const top = isMobile
        ? clamp(targetY - 40, 12, Math.max(12, viewportH - 150))
        : clamp(targetY - 42, 12, Math.max(12, viewportH - 150));

    return {
        left,
        top,
        width,
        arrowTop: clamp(targetY - top, 16, 112),
    };
}

export const TutorialDomOverlay: React.FC = () => {
    const activePreset = useAtomValue(activePresetAtom);
    const tutorialStage = useAtomValue(tutorialStageAtom);
    const components = useAtomValue(componentsAtom);
    const isMobile = useIsMobile();
    const [layout, setLayout] = useState<CalloutLayout | null>(null);
    const hasRealCamera = components.some(component => component instanceof Camera && !component.isGhost);

    useEffect(() => {
        if (activePreset !== PresetName.Tutorial2 || tutorialStage !== 2 || hasRealCamera) {
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
    }, [activePreset, hasRealCamera, isMobile, tutorialStage]);

    if (activePreset !== PresetName.Tutorial2 || tutorialStage !== 2 || hasRealCamera) return null;

    return (
        <div
            className="tutorial-sidebar-callout"
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
                    ? 'Open the parts drawer. Drag Camera onto the table, then move and rotate it onto the target.'
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
