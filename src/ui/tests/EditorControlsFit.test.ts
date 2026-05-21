import { describe, expect, test } from 'bun:test';
import { fitSceneToViewport, type ViewportReservation } from '../EditorControls';

interface Bounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

function projectedSceneRect(
    width: number,
    height: number,
    bounds: Bounds,
    fit: { centerX: number; centerY: number; zoom: number },
    rotateForPortrait: boolean,
): { left: number; right: number; top: number; bottom: number } {
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
    ];

    const points = corners.map(({ x, y }) => {
        if (rotateForPortrait) {
            return {
                x: width / 2 + (y - fit.centerY) * fit.zoom,
                y: height / 2 + (x - fit.centerX) * fit.zoom,
            };
        }
        return {
            x: width / 2 + (x - fit.centerX) * fit.zoom,
            y: height / 2 - (y - fit.centerY) * fit.zoom,
        };
    });

    return {
        left: Math.min(...points.map(p => p.x)),
        right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)),
        bottom: Math.max(...points.map(p => p.y)),
    };
}

function intersectsReservedPanel(
    sceneRect: { left: number; right: number; top: number; bottom: number },
    height: number,
    reservation: ViewportReservation,
): boolean {
    const panel = {
        left: 0,
        right: reservation.left,
        top: height - reservation.bottom,
        bottom: height,
    };
    return sceneRect.left < panel.right
        && sceneRect.right > panel.left
        && sceneRect.top < panel.bottom
        && sceneRect.bottom > panel.top;
}

describe('mobile preset fitting', () => {
    test('keeps portrait preset bounds out from under a pinned viewer', () => {
        const width = 390;
        const height = 844;
        const bounds = { minX: -90, maxX: 320, minY: -25, maxY: 25 };
        const reservation = { left: 130, bottom: 150 };

        const fit = fitSceneToViewport(width, height, bounds, true, reservation);
        const sceneRect = projectedSceneRect(width, height, bounds, fit, true);

        expect(intersectsReservedPanel(sceneRect, height, reservation)).toBe(false);
    });

    test('keeps landscape preset bounds out from under a pinned viewer', () => {
        const width = 844;
        const height = 390;
        const bounds = { minX: -120, maxX: 420, minY: -30, maxY: 30 };
        const reservation = { left: 180, bottom: 120 };

        const fit = fitSceneToViewport(width, height, bounds, false, reservation);
        const sceneRect = projectedSceneRect(width, height, bounds, fit, false);

        expect(intersectsReservedPanel(sceneRect, height, reservation)).toBe(false);
    });
});
