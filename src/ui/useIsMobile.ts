import { useState, useEffect } from 'react';

type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
};

/**
 * React hook that returns true when the viewport is at or below the given breakpoint.
 * Uses `matchMedia` so it responds to orientation changes and live resizing.
 */
export function useIsMobile(breakpoint = 768): boolean {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' && window.innerWidth <= breakpoint
    );
    useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${breakpoint}px)`) as LegacyMediaQueryList;
        const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
        } else {
            mql.addListener?.(onChange);
        }
        setIsMobile(mql.matches);
        return () => {
            if (typeof mql.removeEventListener === 'function') {
                mql.removeEventListener('change', onChange);
            } else {
                mql.removeListener?.(onChange);
            }
        };
    }, [breakpoint]);
    return isMobile;
}

export function useIsLandscape(): boolean {
    const [isLandscape, setIsLandscape] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
    );
    useEffect(() => {
        const mql = window.matchMedia('(orientation: landscape)') as LegacyMediaQueryList;
        const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsLandscape(e.matches);
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
        } else {
            mql.addListener?.(onChange);
        }
        setIsLandscape(mql.matches);
        return () => {
            if (typeof mql.removeEventListener === 'function') {
                mql.removeEventListener('change', onChange);
            } else {
                mql.removeListener?.(onChange);
            }
        };
    }, []);
    return isLandscape;
}
