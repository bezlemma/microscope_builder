import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';

// Presets
import { createTransmissionMicroscopeScene } from '../presets/infinitySystem';
import { createBeamExpanderScene } from '../presets/beamExpander';
import { createLensZooScene } from '../presets/lensZoo';
import { createPrismDebugScene } from '../presets/prismDebug';
import { createPolarizationZooScene } from '../presets/polarizationZoo';
import { createMZInterferometerScene } from '../presets/mzInterferometer';
import { createEpiFluorescenceScene } from '../presets/epiFluorescence';

// --- State Types ---
export interface RayConfig {
    rayCount: number; // Number of intermediate rays
    showFootprint: boolean;
    solver2Enabled: boolean; // E&M (Gaussian beam) solver toggle
    emFieldVisible: boolean; // 3D E-field visualization mode
}

// 1. Component List (The Scene Graph)

// Preset Management
export enum PresetName {
    BeamExpander = "Beam Expander",
    TransmissionMicroscope = "Transmission Microscope",
    LensZoo = "Lens Zoo",
    PrismDebug = "Prism Debug",
    PolarizationZoo = "Polarization Zoo",
    MZInterferometer = "MZ Interferometer",
    EpiFluorescence = "Epi-Fluorescence"
}

export const activePresetAtom = atom<PresetName>(PresetName.BeamExpander);

// The components atom is now derived from an internal atom that can be set,
// or we can make it an atom that defaults to the preset but is writable.
// Simplest pattern for now: A loadable atom.
export const componentsAtom = atom<OpticalComponent[]>(createBeamExpanderScene());

// Action to load a preset
export const loadPresetAtom = atom(
    null,
    (_get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        if (presetName === PresetName.BeamExpander) {
            set(componentsAtom, createBeamExpanderScene());
        } else if (presetName === PresetName.TransmissionMicroscope) {
            set(componentsAtom, createTransmissionMicroscopeScene());
        } else if (presetName === PresetName.LensZoo) {
            set(componentsAtom, createLensZooScene());
        } else if (presetName === PresetName.PrismDebug) {
            set(componentsAtom, createPrismDebugScene());
        } else if (presetName === PresetName.PolarizationZoo) {
            set(componentsAtom, createPolarizationZooScene());
        } else if (presetName === PresetName.MZInterferometer) {
            set(componentsAtom, createMZInterferometerScene());
        } else if (presetName === PresetName.EpiFluorescence) {
            set(componentsAtom, createEpiFluorescenceScene());
        }
    }
);

// 2. Selection State (supports multi-select via Ctrl+Click)
export const selectionAtom = atom<string[]>([]);

// 3. Ray Configuration
export const rayConfigAtom = atom<RayConfig>({
    rayCount: 32,
    showFootprint: false,
    solver2Enabled: true,
    emFieldVisible: false
});

// 4. Interaction State
export const isDraggingAtom = atom<boolean>(false);

// 5. Handle Dragging State — prevents Draggable from stealing pointer events
export const handleDraggingAtom = atom<boolean>(false);

// 6. Pinned Viewer Panels — card IDs whose viewer panels are toggled on
export const pinnedViewersAtom = atom<Set<string>>(new Set<string>());
