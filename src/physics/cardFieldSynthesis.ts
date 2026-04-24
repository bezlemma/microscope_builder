/**
 * Stub — card field synthesis requires rod-based beam field data.
 * Only the resolution helper is needed by the Inspector UI.
 */
export function resolutionFromPixelPitch(
    cardWidth: number,
    cardHeight: number,
    pixelPitch: number,
): { resX: number; resY: number } {
    const resX = Math.max(1, Math.round(cardWidth / pixelPitch));
    const resY = Math.max(1, Math.round(cardHeight / pixelPitch));
    return { resX, resY };
}
