import { useState, useEffect } from 'react';

/**
 * React hook that returns true when the viewport is at or below the given breakpoint.
 * Uses `matchMedia` so it responds to orientation changes and live resizing.
 */
export function useIsMobile(breakpoint = 768): boolean {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' && window.innerWidth <= breakpoint
    );
    useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mql.addEventListener('change', onChange);
        setIsMobile(mql.matches);
        return () => mql.removeEventListener('change', onChange);
    }, [breakpoint]);
    return isMobile;
}
