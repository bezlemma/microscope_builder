import { describe, expect, test } from 'bun:test';
import { createStore } from 'jotai/vanilla';
import {
    activePresetAtom,
    componentsAtom,
    loadPresetAtom,
    PresetName,
    rayConfigAtom,
    startTutorialStage2Atom,
    tutorialStageAtom,
} from '../store';
import { Camera } from '../../physics/components/Camera';

describe('Tutorial preset loading', () => {
    test('Tutorial starts with the dense ray default', () => {
        const store = createStore();

        expect(store.get(activePresetAtom)).toBe(PresetName.Tutorial);
        expect(store.get(rayConfigAtom).rayCount).toBe(200);

        store.set(loadPresetAtom, PresetName.Tutorial);
        expect(store.get(rayConfigAtom).rayCount).toBe(200);
    });

    test('the tutorial completion action switches to the Tutorial 2 preset', () => {
        const store = createStore();

        store.set(startTutorialStage2Atom);

        expect(store.get(activePresetAtom)).toBe(PresetName.Tutorial2);
        expect(store.get(tutorialStageAtom)).toBe(2);
        expect(store.get(componentsAtom).filter(c => c instanceof Camera && !c.isGhost)).toHaveLength(0);
        expect(store.get(componentsAtom).filter(c => c instanceof Camera && Boolean(c.isGhost))).toHaveLength(1);
    });

    test('Tutorial 2 loads directly as stage 2', () => {
        const store = createStore();

        store.set(loadPresetAtom, PresetName.Tutorial2);

        expect(store.get(activePresetAtom)).toBe(PresetName.Tutorial2);
        expect(store.get(tutorialStageAtom)).toBe(2);
    });
});
