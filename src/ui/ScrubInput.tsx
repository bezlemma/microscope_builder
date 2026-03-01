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

/**
 * ScrubInput — A Blender/Figma-style scrubbable number input.
 * 
 * - Type values directly in the text field (commits on Enter/blur)
 * - Click-drag on the LABEL to scrub the value in real-time
 * - Cursor shows ↔ (ew-resize) when hovering the label
 * - Holds shift for 10x precision, ctrl for 0.1x precision
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
    suffix = '',
    title,
    allowInfinity = false,
}) => {
    const [isScrubbing, setIsScrubbing] = useState(false);
    const startXRef = useRef(0);
    const startValueRef = useRef(0);

    const clamp = useCallback((v: number) => {
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
    }, [min, max]);

    const round = useCallback((v: number) => {
        return Math.round(v / step) * step;
    }, [step]);

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
        if (allowInfinity && Math.abs(newVal) >= 1e6) {
            onChange(newVal > 0 ? 'Infinity' : '-Infinity');
        } else {
            onChange(String(round(newVal)));
        }

        // Commit in real-time for live updates
        if (allowInfinity && Math.abs(newVal) >= 1e6) {
            onCommit(newVal > 0 ? 'Infinity' : '-Infinity');
        } else {
            onCommit(String(round(newVal)));
        }
    }, [isScrubbing, speed, clamp, round, onChange, onCommit, allowInfinity]);

    const handleLabelPointerUp = useCallback((e: React.PointerEvent) => {
        if (!isScrubbing) return;
        setIsScrubbing(false);
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }, [isScrubbing]);

    // Prevent body selection while scrubbing
    useEffect(() => {
        if (isScrubbing) {
            document.body.style.userSelect = 'none';
            (document.body.style as any).webkitUserSelect = 'none';  // Safari
            (document.body.style as any).MozUserSelect = 'none';     // Firefox
            document.body.style.cursor = 'ew-resize';
        } else {
            document.body.style.userSelect = '';
            (document.body.style as any).webkitUserSelect = '';
            (document.body.style as any).MozUserSelect = '';
            document.body.style.cursor = '';
        }
        return () => {
            document.body.style.userSelect = '';
            (document.body.style as any).webkitUserSelect = '';
            (document.body.style as any).MozUserSelect = '';
            document.body.style.cursor = '';
        };
    }, [isScrubbing]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
                }}
            >
                {label}{suffix ? ` (${suffix})` : ''}
                <span style={{ 
                    fontSize: '10px', 
                    color: '#555', 
                    marginLeft: 4,
                    opacity: 0.7,
                }}>
                    ↔
                </span>
            </label>
            <input
                type="text"
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
                    padding: '6px',
                    borderRadius: '4px',
                    width: '100%',
                    boxSizing: 'border-box' as const,
                    transition: 'border-color 0.15s',
                }}
            />
        </div>
    );
};
