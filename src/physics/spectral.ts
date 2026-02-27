/**
 * Shared wavelength-to-color utilities.
 * 
 * Replaces duplicate implementations in Inspector.tsx, RayVisualizer.tsx,
 * and ComponentVisualizers.tsx with a single source of truth.
 */

/** Convert wavelength (nm) to linear RGB in [0, 1] range. */
export function wavelengthToRGB(nm: number): { r: number; g: number; b: number; isVisible: boolean } {
    let r = 0, g = 0, b = 0;

    if (nm >= 380 && nm < 440) {
        r = -(nm - 440) / (440 - 380);
        b = 1.0;
    } else if (nm >= 440 && nm < 490) {
        g = (nm - 440) / (490 - 440);
        b = 1.0;
    } else if (nm >= 490 && nm < 510) {
        g = 1.0;
        b = -(nm - 510) / (510 - 490);
    } else if (nm >= 510 && nm < 580) {
        r = (nm - 510) / (580 - 510);
        g = 1.0;
    } else if (nm >= 580 && nm < 645) {
        r = 1.0;
        g = -(nm - 645) / (645 - 580);
    } else if (nm >= 645 && nm <= 780) {
        r = 1.0;
    }

    // Apply intensity correction for edge wavelengths
    let factor = 1.0;
    if (nm >= 380 && nm < 420) {
        factor = 0.3 + 0.7 * (nm - 380) / (420 - 380);
    } else if (nm >= 645 && nm <= 780) {
        factor = 0.3 + 0.7 * (780 - nm) / (780 - 645);
    } else if (nm < 380 || nm > 780) {
        return { r: 0.53, g: 0.53, b: 0.53, isVisible: false };
    }

    r = Math.pow(r * factor, 0.8);
    g = Math.pow(g * factor, 0.8);
    b = Math.pow(b * factor, 0.8);

    return { r, g, b, isVisible: true };
}

/** Convert wavelength (nm) to CSS `rgb(...)` string. */
export function wavelengthToCSS(nm: number): string {
    const { r, g, b, isVisible } = wavelengthToRGB(nm);
    if (!isVisible) return 'rgb(135, 135, 135)';
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** Convert wavelength (nm) to hex `#rrggbb` string. */
export function wavelengthToHex(nm: number): string {
    const { r, g, b, isVisible } = wavelengthToRGB(nm);
    if (!isVisible) return '#888888';
    const toHex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Returns true if the wavelength (nm) falls in the visible spectrum. */
export function isVisibleSpectrum(nm: number): boolean {
    return nm >= 380 && nm <= 780;
}
