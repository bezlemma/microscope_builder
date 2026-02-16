import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';

// Presets
import { createTransFluorescenceScene } from '../presets/infinitySystem';
import { createBrightfieldScene } from '../presets/brightfield';
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
    TransFluorescence = "Trans. Fluorescence",
    Brightfield = "Brightfield",
    LensZoo = "Lens Zoo",
    PrismDebug = "Prism Debug",
    PolarizationZoo = "Polarization Zoo",
    MZInterferometer = "MZ Interferometer",
    EpiFluorescence = "Epi-Fluorescence"
}

export const activePresetAtom = atom<PresetName>(PresetName.BeamExpander);

export const componentsAtom = atom<OpticalComponent[]>(createBeamExpanderScene());

// Action to load a preset
export const loadPresetAtom = atom(
    null,
    (_get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        // Reset E&M state for fresh preset
        set(rayConfigAtom, { rayCount: 32, showFootprint: false, solver2Enabled: false, emFieldVisible: false });
        if (presetName === PresetName.BeamExpander) {
            set(componentsAtom, createBeamExpanderScene());
        } else if (presetName === PresetName.TransFluorescence) {
            set(componentsAtom, createTransFluorescenceScene());
        } else if (presetName === PresetName.Brightfield) {
            set(componentsAtom, createBrightfieldScene());
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
    solver2Enabled: false,
    emFieldVisible: false
});

// 4. Interaction State
export const isDraggingAtom = atom<boolean>(false);

// 5. Handle Dragging State — prevents Draggable from stealing pointer events
export const handleDraggingAtom = atom<boolean>(false);

// 6. Pinned Viewer Panels — card IDs whose viewer panels are toggled on
export const pinnedViewersAtom = atom<Set<string>>(new Set<string>());

// 7. Solver 3 render trigger — incrementing this value triggers a Solver 3 render
export const solver3RenderTriggerAtom = atom<number>(0);

// 8. Solver 3 rendering status — true while render is in progress
export const solver3RenderingAtom = atom<boolean>(false);
