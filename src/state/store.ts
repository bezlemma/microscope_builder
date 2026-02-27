import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { serializeScene, deserializeScene } from './ubzSerializer';
import { PropertyAnimator } from '../physics/PropertyAnimator';

// Presets
import { createTransFluorescenceScene } from '../presets/TransmissionFluorescence';
import { createBrightfieldScene } from '../presets/brightfield';
import { createBeamExpanderScene } from '../presets/beamExpander';
import { createLensZooScene } from '../presets/lensZoo';
import { createPrismDebugScene } from '../presets/prismDebug';
import { createPolarizationZooScene } from '../presets/polarizationZoo';
import { createMZInterferometerScene } from '../presets/mzInterferometer';
import { createEpiFluorescenceScene } from '../presets/epiFluorescence';
import { createOpenSPIMScene } from '../presets/openSPIM';
import { createConfocalScene } from '../presets/confocal';

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
    OpenSPIM = "OpenSPIM Lightsheet",
    Confocal = "Confocal Scanning"
}

export const activePresetAtom = atom<PresetName>(PresetName.BeamExpander);

export const componentsAtom = atom<OpticalComponent[]>(createBeamExpanderScene());

/** Normalized preset result — all presets produce this shape. */
export interface PresetResult {
    scene: OpticalComponent[];
    channels?: import('../physics/PropertyAnimator').AnimationChannel[];
    animationPlaying?: boolean;
    animationSpeed?: number;
}

// Action to load a preset
const presetFactories = new Map<PresetName, () => PresetResult>([
    [PresetName.BeamExpander, () => ({ scene: createBeamExpanderScene() })],
    [PresetName.TransFluorescence, () => ({ scene: createTransFluorescenceScene() })],
    [PresetName.Brightfield, () => ({ scene: createBrightfieldScene() })],
    [PresetName.LensZoo, () => ({ scene: createLensZooScene() })],
    [PresetName.PrismDebug, () => ({ scene: createPrismDebugScene() })],
    [PresetName.PolarizationZoo, () => ({ scene: createPolarizationZooScene() })],
    [PresetName.MZInterferometer, () => ({ scene: createMZInterferometerScene() })],
    [PresetName.EpiFluorescence, () => ({ scene: createEpiFluorescenceScene() })],
    [PresetName.OpenSPIM, () => ({ scene: createOpenSPIMScene() })],
    [PresetName.Confocal, () => createConfocalScene()],
]);

export const loadPresetAtom = atom(
    null,
    (get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        // Reset E&M state for fresh preset
        set(rayConfigAtom, { rayCount: 32, showFootprint: false, solver2Enabled: false, emFieldVisible: false });
        set(undoStackAtom, []); // Clear undo history on preset load

        const factory = presetFactories.get(presetName);
        if (!factory) return;
        const result = factory();

        set(componentsAtom, result.scene);

        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();

        if (result.channels) {
            for (const ch of result.channels) {
                animator.addChannel(ch);
            }
        }

        if (result.animationPlaying !== undefined) {
            set(animationPlayingAtom, result.animationPlaying);
        }
        if (result.animationSpeed !== undefined) {
            set(animationSpeedAtom, result.animationSpeed);
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
const MAX_UNDO = 20; // How much RAM does this cost us? Seems like not a lot.
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

// ════════════════════════════════════════════════════════════
//  11. ANIMATION SYSTEM — PropertyAnimator
//  Animates numeric properties on components at 60fps.
//  Per PhysicsPlan §4: "Time Is a Scene Graph Mutation."
// ════════════════════════════════════════════════════════════
export const animatorAtom = atom<PropertyAnimator>(new PropertyAnimator());
export const animationPlayingAtom = atom<boolean>(false);
export const animationSpeedAtom = atom<number>(1.0);

// ════════════════════════════════════════════════════════════
//  12. SCAN ACCUMULATION — Solver 3 multi-step batch render
//  Steps through N scan positions, runs Solver 1→2→3 at each,
//  and accumulates the resulting images on the Camera.
// ════════════════════════════════════════════════════════════
export const scanAccumTriggerAtom = atom<{ steps: number; trigger: number }>({ steps: 16, trigger: 0 });
export const scanAccumProgressAtom = atom<number>(0);  // 0..1 progress
