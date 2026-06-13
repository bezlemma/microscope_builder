import React, { useRef, useState, useCallback, useEffect } from 'react';

interface ScrubInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onCommit: (value: string) => void;
    speed?: number;       // How fast the value changes per pixel of drag
    min?: number;
    max?: number;
    step?: number;        // Rounding step (e.g., 0.01 for 2 decimal places)
    suffix?: string;      // e.g., "mm", "°"
    title?: string;       // Tooltip
    allowInfinity?: boolean;
}

/** Minimum ms between onCommit calls during drag — keeps live preview smooth
 *  without hammering expensive downstream work (solver, spectrum, etc.). */
const COMMIT_THROTTLE_MS = 60;

type UserSelectStyle = CSSStyleDeclaration & {
    webkitUserSelect?: string;
    MozUserSelect?: string;
};

function setBodyDragStyle(enabled: boolean): void {
    const style = document.body.style as UserSelectStyle;
    style.userSelect = enabled ? 'none' : '';
    style.webkitUserSelect = enabled ? 'none' : '';
    style.MozUserSelect = enabled ? 'none' : '';
    style.cursor = enabled ? 'ew-resize' : '';
}

/**
 * ScrubInput — A Blender/Figma-style scrubbable number input.
 *
 * - Type values directly in the text field (commits on Enter/blur)
 * - Click-drag on the LABEL to scrub the value in real-time
 * - Tap the ‹/› stepper buttons to nudge the value up/down by one step
 * - Cursor shows ↔ (ew-resize) when hovering the label
 * - Holds shift for 10x precision (desktop only)
 *
 * During drag, onChange fires every pointer-move (cheap local state update)
 * while onCommit is throttled to ~16 fps to avoid hammering heavy work.
 */
export const ScrubInput: React.FC<ScrubInputProps> = ({
    label,
    value,
    onChange,
    onCommit,
    speed = 1.0,
    min,
    max,
    step = 0.01,
    suffix,
    title,
    allowInfinity = false,
}) => {
    const [isScrubbing, setIsScrubbing] = useState(false);
    const startXRef = useRef(0);
    const startValueRef = useRef(0);

    // Throttle bookkeeping for onCommit during drag
    const lastCommitTimeRef = useRef(0);
    const pendingCommitRef = useRef<string | null>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestScrubValueRef = useRef<string>('');

    const clamp = useCallback((v: number) => {
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
    }, [min, max]);

    const round = useCallback((v: number) => {
        return Math.round(v / step) * step;
    }, [step]);

    /** Fire onCommit, respecting throttle window. Guarantees the last value
     *  is always committed (via a trailing timer). */
    const throttledCommit = useCallback((val: string) => {
        const now = performance.now();
        const elapsed = now - lastCommitTimeRef.current;

        if (elapsed >= COMMIT_THROTTLE_MS) {
            // Enough time has passed — commit immediately
            lastCommitTimeRef.current = now;
            pendingCommitRef.current = null;
            if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
            onCommit(val);
        } else {
            // Too soon — queue a trailing commit so the final value is never lost
            pendingCommitRef.current = val;
            if (!commitTimerRef.current) {
                commitTimerRef.current = setTimeout(() => {
                    commitTimerRef.current = null;
                    if (pendingCommitRef.current !== null) {
                        lastCommitTimeRef.current = performance.now();
                        onCommit(pendingCommitRef.current);
                        pendingCommitRef.current = null;
                    }
                }, COMMIT_THROTTLE_MS - elapsed);
            }
        }
    }, [onCommit]);

    const handleLabelPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Parse current value for scrub start
        const currentVal = value.toLowerCase() === 'infinity' ? 1e9
                         : value.toLowerCase() === '-infinity' ? -1e9
                         : parseFloat(value);
        if (isNaN(currentVal)) return;

        startXRef.current = e.clientX;
        startValueRef.current = currentVal;
        lastCommitTimeRef.current = 0;  // Reset throttle so first move commits immediately
        // Clear the previous scrub's value: a click with zero pointer movement
        // must not re-commit a stale value from an earlier scrub.
        latestScrubValueRef.current = '';
        setIsScrubbing(true);

        // Capture pointer for reliable drag tracking
        try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* Safari/mobile */ }
    }, [value]);

    const handleLabelPointerMove = useCallback((e: React.PointerEvent) => {
        if (!isScrubbing) return;
        e.preventDefault();

        const dx = e.clientX - startXRef.current;

        // Shift = fine (0.1x), default = normal
        const modifier = e.shiftKey ? 0.1 : 1.0;

        let newVal = startValueRef.current + dx * speed * modifier;
        newVal = clamp(newVal);
        newVal = round(newVal);

        // Format display
        let formatted: string;
        if (allowInfinity && Math.abs(newVal) >= 1e6) {
            formatted = newVal > 0 ? 'Infinity' : '-Infinity';
        } else {
            formatted = String(round(newVal));
        }

        latestScrubValueRef.current = formatted;
        onChange(formatted);             // Always — cheap local state update
        throttledCommit(formatted);      // Throttled — expensive downstream work
    }, [isScrubbing, speed, clamp, round, onChange, throttledCommit, allowInfinity]);

    const handleLabelPointerUp = useCallback((e: React.PointerEvent) => {
        if (!isScrubbing) return;
        setIsScrubbing(false);
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }

        // Cancel any pending throttled commit and immediately commit the final value
        if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
        pendingCommitRef.current = null;
        if (latestScrubValueRef.current) {
            onCommit(latestScrubValueRef.current);
        }
    }, [isScrubbing, onCommit]);

    // Clean up trailing timer on unmount
    useEffect(() => {
        return () => {
            if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        };
    }, []);

    // Prevent body selection while scrubbing
    useEffect(() => {
        setBodyDragStyle(isScrubbing);
        return () => setBodyDragStyle(false);
    }, [isScrubbing]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <label
                title={title}
                onPointerDown={handleLabelPointerDown}
                onPointerMove={handleLabelPointerMove}
                onPointerUp={handleLabelPointerUp}
                style={{
                    fontSize: '12px',
                    color: isScrubbing ? '#64ffda' : '#aaa',
                    marginBottom: 4,
                    cursor: 'ew-resize',
                    userSelect: 'none',
                    transition: 'color 0.15s',
                    padding: '2px 0',
                }}
            >
                {label}
            </label>
            <div style={{ position: 'relative', width: '100%' }}>
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => onCommit(value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            onCommit(value);
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    style={{
                        backgroundColor: '#222',
                        border: `1px solid ${isScrubbing ? '#64ffda' : '#444'}`,
                        color: '#fff',
                        padding: suffix ? '6px 28px 6px 6px' : '6px',
                        borderRadius: '4px',
                        width: '100%',
                        minWidth: 0,
                        boxSizing: 'border-box' as const,
                        transition: 'border-color 0.15s',
                    }}
                />
                {suffix && (
                    <span style={{
                        position: 'absolute',
                        right: 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '11px',
                        color: '#777',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: 'var(--ui-font)',
                    }}>
                        {suffix}
                    </span>
                )}
            </div>
        </div>
    );
};
