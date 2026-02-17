import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { serializeScene, deserializeScene } from './ubzSerializer';

// Presets
import { createTransFluorescenceScene } from '../presets/infinitySystem';
import { createBrightfieldScene } from '../presets/brightfield';
import { createBeamExpanderScene } from '../presets/beamExpander';
import { createLensZooScene } from '../presets/lensZoo';
import { createPrismDebugScene } from '../presets/prismDebug';
import { createPolarizationZooScene } from '../presets/polarizationZoo';
import { createMZInterferometerScene } from '../presets/mzInterferometer';
import { createEpiFluorescenceScene } from '../presets/epiFluorescence';
import { createOpenSPIMScene } from '../presets/openSPIM';

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
    EpiFluorescence = "Epi-Fluorescence",
    OpenSPIM = "OpenSPIM Lightsheet"
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
        set(undoStackAtom, []); // Clear undo history on preset load
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
        } else if (presetName === PresetName.OpenSPIM) {
            set(componentsAtom, createOpenSPIMScene());
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

// 9. Load scene from deserialized components (e.g. from .ubz file)
export const loadSceneAtom = atom(
    null,
    (_get, set, components: OpticalComponent[]) => {
        set(componentsAtom, components);
        set(rayConfigAtom, { rayCount: 32, showFootprint: false, solver2Enabled: false, emFieldVisible: false });
        set(selectionAtom, []);
        set(undoStackAtom, []); // Clear undo history on scene load
    }
);

// ════════════════════════════════════════════════════════════
//  10. UNDO SYSTEM — Ctrl+Z support
//  Stores serialized scene snapshots. Max 20 entries.
// ════════════════════════════════════════════════════════════
const MAX_UNDO = 20;
export const undoStackAtom = atom<string[]>([]);

/** Push current scene state onto the undo stack (call BEFORE mutation). */
export const pushUndoAtom = atom(
    null,
    (get, set) => {
        const components = get(componentsAtom);
        const snapshot = serializeScene(components);
        const stack = get(undoStackAtom);
        const newStack = [...stack, snapshot];
        if (newStack.length > MAX_UNDO) newStack.shift();
        set(undoStackAtom, newStack);
    }
);

/** Pop the most recent snapshot and restore it. */
export const undoAtom = atom(
    null,
    (get, set) => {
        const stack = get(undoStackAtom);
        if (stack.length === 0) return;
        const newStack = [...stack];
        const snapshot = newStack.pop()!;
        set(undoStackAtom, newStack);
        const restored = deserializeScene(snapshot);
        set(componentsAtom, restored);
        set(selectionAtom, []);
    }
);
