import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Vector3 } from 'three';
import { Laser } from '../physics/components/Laser';

// Presets
import { createInfinitySystemScene } from '../presets/infinitySystem';
import { createBeamExpanderScene } from '../presets/beamExpander';

// --- State Types ---
export interface RayConfig {
    rayCount: number; // Number of intermediate rays
    showFootprint: boolean;
}

// 1. Component List (The Scene Graph)

// Preset Management
export enum PresetName {
    BeamExpander = "Beam Expander",
    InfinitySystem = "Infinity System"
}

export const activePresetAtom = atom<PresetName>(PresetName.BeamExpander);

// The components atom is now derived from an internal atom that can be set,
// or we can make it an atom that defaults to the preset but is writable.
// Simplest pattern for now: A loadable atom.
export const componentsAtom = atom<OpticalComponent[]>(createBeamExpanderScene());

// Action to load a preset
export const loadPresetAtom = atom(
    null,
    (get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        if (presetName === PresetName.BeamExpander) {
            set(componentsAtom, createBeamExpanderScene());
        } else if (presetName === PresetName.InfinitySystem) {
            set(componentsAtom, createInfinitySystemScene());
        }
    }
);

// 2. Selection State
export const selectionAtom = atom<string | null>(null);

// 3. Ray Configuration
export const rayConfigAtom = atom<RayConfig>({
    rayCount: 32, 
    showFootprint: false
});

// 4. Interaction State
export const isDraggingAtom = atom<boolean>(false);

// 5. Handle Dragging State — prevents Draggable from stealing pointer events
export const handleDraggingAtom = atom<boolean>(false);
