import type { MutableRefObject } from 'react';
import { AnimationChannel, getProperty, PropertyAnimator, setProperty } from '../physics/PropertyAnimator';
import { OpticalComponent } from '../physics/Component';

export interface SavedAnimatedValue {
    channel: AnimationChannel;
    target: OpticalComponent;
    originalValue: number;
}

interface ScheduledRenderJobOptions {
    animator: PropertyAnimator;
    savedValues: SavedAnimatedValue[];
    scanAccumActiveRef: MutableRefObject<boolean>;
    animStateRef: MutableRefObject<{ playing: boolean; speed: number }>;
    setAnimPlaying: (playing: boolean) => void;
    setSolver3Rendering: (rendering: boolean) => void;
    setProgress: (progress: number) => void;
}

export function captureAnimatedValues(
    channels: AnimationChannel[],
    byId: Map<string, OpticalComponent>
): SavedAnimatedValue[] {
    return channels
        .map(channel => {
            const target = byId.get(channel.targetId);
            if (!target) return null;
            return {
                channel,
                target,
                originalValue: getProperty(target, channel.property),
            };
        })
        .filter((value): value is SavedAnimatedValue => value !== null);
}

export function createScheduledRenderJob(options: ScheduledRenderJobOptions) {
    const {
        animator,
        savedValues,
        scanAccumActiveRef,
        animStateRef,
        setAnimPlaying,
        setSolver3Rendering,
        setProgress,
    } = options;

    const savedPlaying = animStateRef.current.playing;
    const timeoutIds: number[] = [];
    let cancelled = false;
    let closed = false;

    scanAccumActiveRef.current = true;
    setAnimPlaying(false);
    animator.playing = false;
    setSolver3Rendering(true);
    setProgress(0);

    const restoreProperties = () => {
        for (const saved of savedValues) {
            setProperty(saved.target, saved.channel.property, saved.originalValue);
        }
    };

    const close = (progress: number) => {
        if (closed) return;
        closed = true;
        restoreProperties();
        scanAccumActiveRef.current = false;
        setSolver3Rendering(false);
        setProgress(progress);
        if (savedPlaying) {
            setAnimPlaying(true);
        }
    };

    return {
        schedule(callback: () => void, delay: number) {
            const id = window.setTimeout(callback, delay);
            timeoutIds.push(id);
            return id;
        },
        restoreProperties,
        isCancelled() {
            return cancelled;
        },
        finish(progress: number = 1) {
            close(progress);
        },
        cancel(progress: number = 0) {
            if (!cancelled) {
                cancelled = true;
                for (const id of timeoutIds) {
                    window.clearTimeout(id);
                }
            }
            close(progress);
        },
    };
}
