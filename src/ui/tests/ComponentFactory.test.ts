import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { applyDefaultPlacementOrientation, createComponentForType } from '../componentFactory';

function forwardDirection(type: string): Vector3 {
    const component = createComponentForType(type);
    if (!component) throw new Error(`Unknown component type: ${type}`);
    applyDefaultPlacementOrientation(component, type);
    return new Vector3(0, 0, 1).applyQuaternion(component.rotation).normalize();
}

describe('Component factory placement defaults', () => {
    test('axial optics drop upright instead of parallel to the table', () => {
        for (const type of [
            'blocker',
            'card',
            'aperture',
            'slitAperture',
            'filter',
            'halfWavePlate',
            'quarterWavePlate',
            'polarizer',
            'laser',
            'lamp',
            'sample',
        ]) {
            const forward = forwardDirection(type);
            expect(Math.abs(forward.z)).toBeLessThan(1e-6);
            expect(forward.x).toBeGreaterThan(0.99);
        }
    });

    test('prism keeps its old clocking when dropped', () => {
        const prism = createComponentForType('prism');
        expect(prism).toBeDefined();
        applyDefaultPlacementOrientation(prism!, 'prism');
        const forward = new Vector3(0, 0, 1).applyQuaternion(prism!.rotation).normalize();
        const up = new Vector3(0, 1, 0).applyQuaternion(prism!.rotation).normalize();
        expect(forward.x).toBeGreaterThan(0.99);
        expect(up.y).toBeGreaterThan(0.99);
    });

    test('sample chamber keeps its bowl/base geometry upright on the table', () => {
        const chamber = createComponentForType('lChamber');
        expect(chamber).toBeDefined();
        applyDefaultPlacementOrientation(chamber!, 'lChamber');
        const forward = new Vector3(0, 0, 1).applyQuaternion(chamber!.rotation).normalize();
        expect(forward.z).toBeGreaterThan(0.99);
    });

    test('polygon scanner keeps its spin axis vertical on drop', () => {
        const scanner = createComponentForType('polygonScanner');
        expect(scanner).toBeDefined();
        applyDefaultPlacementOrientation(scanner!, 'polygonScanner');
        const spinAxis = new Vector3(0, 0, 1).applyQuaternion(scanner!.rotation).normalize();
        expect(spinAxis.z).toBeGreaterThan(0.99);
    });

    test('fold optics drop upright with an in-plane diagonal normal', () => {
        for (const type of ['mirror', 'beamSplitter', 'dichroic']) {
            const forward = forwardDirection(type);
            expect(Math.abs(forward.z)).toBeLessThan(1e-6);
            expect(forward.x).toBeGreaterThan(0.6);
            expect(forward.y).toBeLessThan(-0.6);
        }
    });
});
