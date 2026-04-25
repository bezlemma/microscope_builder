import { describe, expect, test } from 'bun:test';
import { createStore } from 'jotai/vanilla';
import {
    animatorAtom,
    componentsAtom,
    loadPresetAtom,
    PresetName,
    rayConfigAtom,
    scanAccumTriggerAtom,
} from '../store';
import { PMT } from '../../physics/components/PMT';
import { DualGalvoScanHead } from '../../physics/components/DualGalvoScanHead';

describe('Confocal preset loading', () => {
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
});
