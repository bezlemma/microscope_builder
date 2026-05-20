import { describe, expect, test } from 'bun:test';
import { createStore } from 'jotai/vanilla';
import {
    animatorAtom,
    animationPlayingAtom,
    animationSpeedAtom,
    componentsAtom,
    loadPresetAtom,
    PresetName,
    presetDescriptionAtom,
    pushUndoAtom,
    pinnedViewersAtom,
    OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT,
    rayConfigAtom,
    scanAccumTriggerAtom,
    setVisualizationModeAtom,
    undoAtom,
} from '../store';
import { PMT } from '../../physics/components/PMT';
import { DualGalvoScanHead } from '../../physics/components/DualGalvoScanHead';
import { Card } from '../../physics/components/Card';
import { Camera } from '../../physics/components/Camera';
import { Mirror } from '../../physics/components/Mirror';
import { Sample } from '../../physics/components/Sample';
import { SampleChamber } from '../../physics/components/SampleChamber';
import { QPD } from '../../physics/components/QPD';

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
    test('blank debug preset starts empty', () => {
        const store = createStore();

        store.set(loadPresetAtom, PresetName.Blank);

        expect(store.get(componentsAtom)).toHaveLength(0);
    });

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

            store.set(loadPresetAtom, PresetName.ObliquePlaneMicroscope);
            expect(replacedUrl).toBe('/builder#preset=oblique-plane-light-sheet');
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
        expect(rayConfig.rayCount).toBe(200);
        expect(rayConfig.minRayOpacity).toBe(0);
        expect(rayConfig.maxRayOpacity).toBeCloseTo(0.4, 6);
    });

    test('oblique plane light sheet pins the camera viewer only', () => {
        const store = createStore();

        store.set(loadPresetAtom, PresetName.ObliquePlaneMicroscope);

        const components = store.get(componentsAtom);
        const cameras = components.filter((component): component is Camera => component instanceof Camera);
        const samples = components.filter(
            (component): component is Sample | SampleChamber =>
                component instanceof Sample || component instanceof SampleChamber,
        );
        const animatedMirrors = components.filter((component): component is Mirror => component instanceof Mirror);
        expect(cameras.length).toBeGreaterThan(0);
        expect(samples.length).toBeGreaterThan(0);
        expect(animatedMirrors.length).toBeGreaterThan(0);
        expect(store.get(presetDescriptionAtom)).toBe('');
        expect(cameras.every(camera => store.get(pinnedViewersAtom).has(camera.id))).toBe(true);
        expect(samples.some(sample => store.get(pinnedViewersAtom).has(sample.id))).toBe(false);
        expect(store.get(animatorAtom).channels.some(channel =>
            animatedMirrors.some(mirror => mirror.id === channel.targetId) && channel.property === 'panAngle',
        )).toBe(true);
        const rayConfig = store.get(rayConfigAtom);
        expect(rayConfig.rayCount).toBe(36);
        expect(rayConfig.minRayOpacity).toBeCloseTo(0.10, 6);
        expect(rayConfig.maxRayOpacity).toBeCloseTo(0.75, 6);
        expect(store.get(scanAccumTriggerAtom).steps).toBe(8);
        expect(cameras.every(camera => camera.sensorResX === 16 && camera.sensorResY === 16)).toBe(true);
    });

    test('interferometer and polarization demos open in wave view', () => {
        const store = createStore();

        store.set(loadPresetAtom, PresetName.MZInterferometer);
        expect(store.get(rayConfigAtom).beamFieldEnabled).toBe(true);
        expect(store.get(rayConfigAtom).viewerMode).toBe('wave');
        const mzCards = store.get(componentsAtom).filter((component): component is Card => component instanceof Card);
        expect(mzCards.length).toBeGreaterThan(0);
        expect(mzCards.every(card => store.get(pinnedViewersAtom).has(card.id))).toBe(true);
        expect(mzCards.every(card => card.opaque)).toBe(true);

        store.set(loadPresetAtom, PresetName.PolarizationZoo);
        expect(store.get(rayConfigAtom).beamFieldEnabled).toBe(true);
        expect(store.get(rayConfigAtom).viewerMode).toBe('wave');
        const description = store.get(presetDescriptionAtom);
        expect(description).toContain('Jones-optics');
        expect(description).toContain('half-wave plate');
        expect(description).toContain('three-polarizer');
    });

    test('optical plane view raises the displayed ray count minimum', () => {
        const store = createStore();
        store.set(loadPresetAtom, PresetName.Blank);

        expect(store.get(rayConfigAtom).rayCount).toBeLessThan(OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT);

        store.set(setVisualizationModeAtom, 'planes');

        const rayConfig = store.get(rayConfigAtom);
        expect(rayConfig.viewerMode).toBe('planes');
        expect(rayConfig.rayCount).toBe(OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT);
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
                const trapQpds = store.get(componentsAtom).filter((component): component is QPD => component instanceof QPD);
                expect(trapQpds.length).toBeGreaterThan(0);
                expect(trapQpds.every(qpd => store.get(pinnedViewersAtom).has(qpd.id))).toBe(true);

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
