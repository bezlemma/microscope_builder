import type { MutableRefObject } from 'react';
import { AnimationChannel, getProperty, PropertyAnimator, setProperty } from '../physics/PropertyAnimator';
import { OpticalComponent } from '../physics/Component';

export interface SavedAnimatedValue {
    channel: AnimationChannel;
    target: OpticalComponent;
    originalValue: number;
}

// ─── Worker-Based Timer (Bypasses Browser Background Tab Throttling) ─────
// Modern browsers throttle setTimeout to ~1 Hz in background tabs.
// By offloading the timeout to a dedicated Web Worker we bypass this
// completely, ensuring render-job steps fire on schedule even when the
// user switches to another tab.

const workerScript = `
    const timers = new Map();
    self.onmessage = function(e) {
        const data = e.data;
        if (data.action === 'setTimeout') {
            timers.set(data.id, setTimeout(() => {
                self.postMessage(data.id);
                timers.delete(data.id);
            }, data.delay));
        } else if (data.action === 'clearTimeout') {
            const timerId = timers.get(data.id);
            if (timerId !== undefined) {
                clearTimeout(timerId);
                timers.delete(data.id);
            }
        }
    };
`;

let workerTimerAvailable = false;
let timerWorker: Worker | null = null;
let nextTimerId = 1;
const timerCallbacks = new Map<number, () => void>();

try {
    const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    try {
        timerWorker = new Worker(workerUrl);
    } finally {
        URL.revokeObjectURL(workerUrl);
    }
    timerWorker.onmessage = (e) => {
        const id = e.data as number;
        const callback = timerCallbacks.get(id);
        if (callback) {
            timerCallbacks.delete(id);
            callback();
        }
    };
    workerTimerAvailable = true;
} catch {
    // Worker creation can fail in some environments (e.g. restrictive CSP).
    // Fall back to window.setTimeout below.
    workerTimerAvailable = false;
}

const WorkerTimer = {
    setTimeout: (callback: () => void, delay: number): number => {
        if (workerTimerAvailable && timerWorker) {
            const id = nextTimerId++;
            timerCallbacks.set(id, callback);
            timerWorker.postMessage({ id, action: 'setTimeout', delay });
            return id;
        }
        // Fallback to standard timer
        return window.setTimeout(callback, delay);
    },
    clearTimeout: (id: number): void => {
        if (workerTimerAvailable && timerWorker) {
            timerCallbacks.delete(id);
            timerWorker.postMessage({ id, action: 'clearTimeout' });
        } else {
            window.clearTimeout(id);
        }
    },
};

// ─── Detailed Progress Tracking ──────────────────────────────────────────

/** Detailed progress snapshot exposed to UI consumers. */
export interface RenderJobProgress {
    /** 0..1 fractional progress. */
    fraction: number;
    /** Current step index (0-based). */
    step: number;
    /** Total number of steps (0 if unknown). */
    totalSteps: number;
    /** Wall-clock milliseconds since job start. */
    elapsedMs: number;
    /** Human-readable status label (e.g. "Step 3 / 16"). */
    label: string;
}

// ─── Scheduled Render Job ────────────────────────────────────────────────

interface ScheduledRenderJobOptions {
    animator: PropertyAnimator;
    savedValues: SavedAnimatedValue[];
    scanAccumActiveRef: MutableRefObject<boolean>;
    animStateRef: MutableRefObject<{ playing: boolean; speed: number }>;
    setAnimPlaying: (playing: boolean) => void;
    setSolver3Rendering: (rendering: boolean) => void;
    setProgress: (progress: number) => void;
    /** Optional callback receiving detailed progress snapshots. */
    onDetailedProgress?: (progress: RenderJobProgress) => void;
    /** Total number of steps for this job (enables step tracking). */
    totalSteps?: number;
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
        onDetailedProgress,
        totalSteps: totalStepsOption,
    } = options;

    const savedPlaying = animStateRef.current.playing;
    const timeoutIds: number[] = [];
    let cancelled = false;
    let closed = false;
    const startTime = performance.now();
    let currentStep = 0;
    const totalSteps = totalStepsOption ?? 0;

    scanAccumActiveRef.current = true;
    setAnimPlaying(false);
    animator.playing = false;
    setSolver3Rendering(true);
    setProgress(0);

    const emitProgress = (fraction: number) => {
        setProgress(fraction);
        if (onDetailedProgress) {
            const elapsedMs = performance.now() - startTime;
            const label = totalSteps > 0
                ? `Step ${currentStep + 1} / ${totalSteps}`
                : `${Math.round(fraction * 100)}%`;
            onDetailedProgress({ fraction, step: currentStep, totalSteps, elapsedMs, label });
        }
    };

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
        emitProgress(progress);
        if (savedPlaying) {
            setAnimPlaying(true);
        }
    };

    return {
        schedule(callback: () => void, delay: number) {
            const id = WorkerTimer.setTimeout(callback, delay);
            timeoutIds.push(id);
            return id;
        },
        restoreProperties,
        isCancelled() {
            return cancelled;
        },
        /** Advance the step counter (for step-tracking progress). */
        advanceStep(step: number) {
            currentStep = step;
        },
        /** Get wall-clock elapsed time since job start. */
        elapsedMs() {
            return performance.now() - startTime;
        },
        /** Update progress fraction (0..1) and emit detailed progress. */
        reportProgress(fraction: number) {
            emitProgress(fraction);
        },
        finish(progress: number = 1) {
            close(progress);
        },
        cancel(progress: number = 0) {
            if (!cancelled) {
                cancelled = true;
                for (const id of timeoutIds) {
                    WorkerTimer.clearTimeout(id);
                }
            }
            close(progress);
        },
    };
}
