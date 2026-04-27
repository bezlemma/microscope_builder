import { describe, expect, test } from 'bun:test';
import { createStore } from 'jotai/vanilla';
import {
    animatorAtom,
    animationPlayingAtom,
    animationSpeedAtom,
    componentsAtom,
    loadPresetAtom,
    PresetName,
    pushUndoAtom,
    pinnedViewersAtom,
    rayConfigAtom,
    scanAccumTriggerAtom,
    undoAtom,
} from '../store';
import { PMT } from '../../physics/components/PMT';
import { DualGalvoScanHead } from '../../physics/components/DualGalvoScanHead';
import { Sample } from '../../physics/components/Sample';
import { SampleChamber } from '../../physics/components/SampleChamber';

function withConstructorName<T extends Function>(ctor: T, name: string, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(ctor, 'name');
    Object.defineProperty(ctor, 'name', { value: name, configurable: true });
    try {
        run();
    } finally {
        if (original) {
            Object.defineProperty(ctor, 'name', original);
        }
    }
}

describe('Confocal preset loading', () => {
    test('preset loads write hash preset URLs', () => {
        const previousWindow = (globalThis as any).window;
        let replacedUrl = '';
        (globalThis as any).window = {
            location: { pathname: '/builder', hash: '', search: '' },
            history: {
                replaceState: (_state: unknown, _title: string, url: string) => {
                    replacedUrl = url;
                },
            },
        };

        try {
            const store = createStore();
            store.set(loadPresetAtom, PresetName.Confocal);
            expect(replacedUrl).toBe('/builder#preset=confocal-scanning');

            store.set(loadPresetAtom, PresetName.Tutorial2);
            expect(replacedUrl).toBe('/builder#preset=tutorial2');
        } finally {
            if (previousWindow === undefined) {
                delete (globalThis as any).window;
            } else {
                (globalThis as any).window = previousWindow;
            }
        }
    });

    test('arms an immediately resolvable PMT raster scan', () => {
        const store = createStore();
        const before = store.get(scanAccumTriggerAtom).trigger;

        store.set(loadPresetAtom, PresetName.Confocal);

        const components = store.get(componentsAtom);
        const pmt = components.find((c): c is PMT => c instanceof PMT);
        expect(pmt).toBeDefined();
        expect(pmt!.hasValidAxes()).toBe(true);

        const scanHead = components.find((c): c is DualGalvoScanHead => c instanceof DualGalvoScanHead);
        expect(scanHead).toBeDefined();
        expect(pmt!.xAxisComponentId).toBe(scanHead!.id);
        expect(pmt!.yAxisComponentId).toBe(scanHead!.id);
        expect(scanHead!.scanAmplitudeX).toBeGreaterThan(0);
        expect(scanHead!.scanAmplitudeY).toBeGreaterThan(0);

        const animator = store.get(animatorAtom);
        expect(animator.channels.some(ch => ch.targetId === scanHead!.id && ch.property === 'scanX')).toBe(true);
        expect(animator.channels.some(ch => ch.targetId === scanHead!.id && ch.property === 'scanY')).toBe(true);
        expect(store.get(scanAccumTriggerAtom).trigger).toBe(before + 1);
        expect(store.get(rayConfigAtom).rayCount).toBe(16);
    });

    test('optical trap preset uses dense dim ray defaults', () => {
        const store = createStore();

        store.set(loadPresetAtom, PresetName.OpticalTrap);

        const rayConfig = store.get(rayConfigAtom);
        expect(rayConfig.rayCount).toBe(500);
        expect(rayConfig.minRayOpacity).toBe(0);
        expect(rayConfig.maxRayOpacity).toBeCloseTo(0.4, 6);
    });

    test('sample zoom viewers auto-pin in minified builds', () => {
        withConstructorName(Sample, 'a', () => {
            withConstructorName(SampleChamber, 'b', () => {
                const store = createStore();

                store.set(loadPresetAtom, PresetName.OpticalTrap);
                const trapSamples = store.get(componentsAtom).filter(
                    (component): component is Sample | SampleChamber =>
                        component instanceof Sample || component instanceof SampleChamber,
                );
                expect(trapSamples.length).toBeGreaterThan(0);
                expect(trapSamples.every(sample => store.get(pinnedViewersAtom).has(sample.id))).toBe(true);

                store.set(loadPresetAtom, PresetName.OpenSPIM);
                const lightSheetSamples = store.get(componentsAtom).filter(
                    (component): component is Sample | SampleChamber =>
                        component instanceof Sample || component instanceof SampleChamber,
                );
                expect(lightSheetSamples.length).toBeGreaterThan(0);
                expect(lightSheetSamples.every(sample => store.get(pinnedViewersAtom).has(sample.id))).toBe(true);
            });
        });
    });

    test('undo restores scene animation channels', () => {
        const store = createStore();
        store.set(loadPresetAtom, PresetName.Confocal);

        const components = store.get(componentsAtom);
        const scanHead = components.find((c): c is DualGalvoScanHead => c instanceof DualGalvoScanHead);
        expect(scanHead).toBeDefined();

        store.set(animationPlayingAtom, true);
        store.set(animationSpeedAtom, 2);
        store.set(pushUndoAtom);

        const animator = store.get(animatorAtom);
        animator.clearAll();
        animator.reset();
        store.set(componentsAtom, []);
        store.set(animationPlayingAtom, false);
        store.set(animationSpeedAtom, 1);

        store.set(undoAtom);

        const restoredAnimator = store.get(animatorAtom);
        expect(store.get(componentsAtom).some(c => c.id === scanHead!.id)).toBe(true);
        expect(restoredAnimator.channels.some(ch => ch.targetId === scanHead!.id && ch.property === 'scanX')).toBe(true);
        expect(restoredAnimator.channels.some(ch => ch.targetId === scanHead!.id && ch.property === 'scanY')).toBe(true);
        expect(store.get(animationPlayingAtom)).toBe(true);
        expect(store.get(animationSpeedAtom)).toBe(2);
    });
});
