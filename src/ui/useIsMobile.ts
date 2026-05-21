import { useState, useEffect } from 'react';

type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
};

export function mobileMediaQuery(breakpoint: number): string {
    return `(max-width: ${breakpoint}px), (max-height: 520px), (orientation: landscape) and (max-width: 1024px) and (max-height: 600px), (pointer: coarse) and (hover: none)`;
}

export function useIsMobile(breakpoint = 768): boolean {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia(mobileMediaQuery(breakpoint)).matches
    );
    useEffect(() => {
        const mql = window.matchMedia(mobileMediaQuery(breakpoint)) as LegacyMediaQueryList;
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
