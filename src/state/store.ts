import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { serializeScene, deserializeScene } from './ubzSerializer';
import { PropertyAnimator } from '../physics/PropertyAnimator';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';

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
import { createBlankScene } from '../presets/blank';
import { createOpticalTrapScene } from '../presets/opticalTrap';
import { createTutorialScene } from '../presets/tutorial';

// --- State Types ---
export interface RayConfig {
    rayCount: number; // Number of intermediate rays
    reversePathCount: number; // Backward paths retained for rod/wave visualization
    showFootprint: boolean;
    solver2Enabled: boolean; // Beamlet/bundle data toggle
    viewerMode: 'rods' | 'wave';
    minRayOpacity: number; // Minimum opacity for the dimmest visible rays (0..1)
    maxRayOpacity: number; // Maximum opacity for the brightest rays (0..1)
}

export const MIN_FORWARD_RAY_COUNT = 4;
export const MAX_FORWARD_RAY_COUNT = 30000;
export const MIN_REVERSE_PATH_COUNT = 1;
export const MAX_REVERSE_PATH_COUNT = 30000;

export const DEFAULT_RAY_CONFIG: RayConfig = {
    rayCount: 32,
    reversePathCount: 4,
    showFootprint: false,
    solver2Enabled: false,
    viewerMode: 'rods',
    minRayOpacity: 0.33,
    maxRayOpacity: 1.0,
};

// 1. Component List (The Scene Graph)

// Preset Management
export enum PresetName {
    Blank = "Blank",
    BeamExpander = "Beam Expander",
    TransFluorescence = "Trans. Fluorescence",
    Brightfield = "Brightfield",
    LensZoo = "Lens Zoo",
    PrismDebug = "Prism Debug",
    PolarizationZoo = "Polarization Zoo",
    MZInterferometer = "MZ Interferometer",
    EpiFluorescence = "Epi-Fluorescence",
    OpenSPIM = "OpenSPIM Lightsheet",
    Confocal = "Confocal Scanning",
    OpticalTrap = "Optical Trap",
    Tutorial = "Tutorial",
}

export type ViewMode = 'schematic' | 'realistic';
export const viewModeAtom = atom<ViewMode>('schematic');

const INITIAL_TUTORIAL = createTutorialScene();

export const presetDescriptionAtom = atom<string>(INITIAL_TUTORIAL.description ?? "");

export const activePresetAtom = atom<PresetName | null>(PresetName.Tutorial);

export const componentsAtom = atom<OpticalComponent[]>(INITIAL_TUTORIAL.scene);

/** Normalized preset result — all presets produce this shape. */
export interface PresetResult {
    scene: OpticalComponent[];
    description?: string;
    channels?: import('../physics/PropertyAnimator').AnimationChannel[];
    animationPlaying?: boolean;
    animationSpeed?: number;
}

// Action to load a preset
const presetFactories = new Map<PresetName, () => PresetResult>([
    [PresetName.Blank, () => ({ scene: createBlankScene() })],
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
    [PresetName.OpticalTrap, () => ({ scene: createOpticalTrapScene() })],
    [PresetName.Tutorial, () => createTutorialScene()],
]);

export const loadPresetAtom = atom(
    null,
    (get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        // Reset bundle-view state for fresh preset
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
        set(undoStackAtom, []); // Clear undo history on preset load
        set(activeZLevelAtom, 0); // Reset Z-level

        const factory = presetFactories.get(presetName);
        if (!factory) return;
        const result = factory();

        set(componentsAtom, result.scene);
        set(presetDescriptionAtom, result.description || "");

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

        // Phone-friendly defaults: every detector in the preset (Cameras and
        // scan-configured PMTs) starts with its viewer pinned so the image
        // panel is visible immediately. We also kick off the Solver-3
        // backward-trace so the user sees a first image without having to
        // press Render.
        const cameras = result.scene.filter((c): c is Camera => c instanceof Camera);
        const pmts = result.scene.filter((c): c is PMT => c instanceof PMT && (c as PMT).hasValidAxes());
        const hasDetector = cameras.length > 0 || pmts.length > 0;
        if (hasDetector) {
            const pinned = new Set(get(pinnedViewersAtom));
            for (const cam of cameras) pinned.add(cam.id);
            for (const pmt of pmts) pinned.add(pmt.id);
            set(pinnedViewersAtom, pinned);
            // Bumping the trigger atom causes OpticalTable's Solver-3 effect to
            // run. It reads `components` at render time and will see the new scene.
            set(solver3RenderTriggerAtom, get(solver3RenderTriggerAtom) + 1);
        }
    }
);

// 2. Selection State (supports multi-select via Ctrl+Click)
export const selectionAtom = atom<string[]>([]);

// 3. Ray Configuration
export const rayConfigAtom = atom<RayConfig>({
    ...DEFAULT_RAY_CONFIG
});

export const resetRayConfigAtom = atom(
    null,
    (_get, set) => {
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
    }
);

export const setBundleDataEnabledAtom = atom(
    null,
    (get, set, enabled: boolean) => {
        const current = get(rayConfigAtom);
        set(rayConfigAtom, {
            ...current,
            solver2Enabled: enabled,
            viewerMode: enabled ? current.viewerMode : 'rods',
        });
    }
);

export const setVisualizationModeAtom = atom(
    null,
    (get, set, mode: RayConfig['viewerMode']) => {
        const current = get(rayConfigAtom);
        set(rayConfigAtom, {
            ...current,
            solver2Enabled: mode === 'wave' ? true : current.solver2Enabled,
            viewerMode: mode,
        });
    }
);

// 4. Interaction State
export const isDraggingAtom = atom<boolean>(false);
export const mobileSnapEnabledAtom = atom<boolean>(false);

// 5. Handle Dragging State — prevents Draggable from stealing pointer events
export const handleDraggingAtom = atom<boolean>(false);

// 6. Pinned Viewer Panels — card IDs whose viewer panels are toggled on
export const pinnedViewersAtom = atom<Set<string>>(new Set<string>());

// 7. Solver 3 render trigger — incrementing this value triggers a Solver 3 render
export const solver3RenderTriggerAtom = atom<number>(0);

// 8. Solver 3 rendering status — true while render is in progress
export const solver3RenderingAtom = atom<boolean>(false);

// 8.5. Reverse Ray Counter — tracks number of reverse rays processed
export const reverseRayCounterAtom = atom<number>(0);

// 8.6. Drawn ray counts — number of forward and reverse rays currently visualized
export const drawnRayCountsAtom = atom<{ forward: number; reverse: number }>({ forward: 0, reverse: 0 });

// 8.7. Camera image tick — bumped every time Solver-3 refreshes a camera's
// emission/excitation image. Lets CameraViewer re-render on each progressive
// round without having to watch the mutated Camera instance directly.
export const cameraImageTickAtom = atom<number>(0);

// 9. Load scene from deserialized components (e.g. from .ubz file)
export const loadSceneAtom = atom(
    null,
    (get, set, components: OpticalComponent[]) => {
        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();

        set(componentsAtom, components);
        set(activePresetAtom, null);
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
        set(selectionAtom, []);
        set(undoStackAtom, []); // Clear undo history on scene load
        set(animationPlayingAtom, false);
        set(animationSpeedAtom, 1.0);
        set(solver3RenderingAtom, false);
        set(scanAccumProgressAtom, 0);
        set(activeZLevelAtom, 0);
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
//  12. Imaging progress + scan accumulation
//  scanAccumProgressAtom is the shared 0..1 progress value for
//  Solver 3 image renders, scan accumulation, and PMT raster scans.
//  scanAccumTriggerAtom starts the animated scan/raster jobs.
// ════════════════════════════════════════════════════════════
export const scanAccumTriggerAtom = atom<{ steps: number; trigger: number }>({ steps: 16, trigger: 0 });
export const scanAccumProgressAtom = atom<number>(0);  // 0..1 progress

// ════════════════════════════════════════════════════════════
//  13. Z-LEVEL SYSTEM — Multi-height optical table
//  Tracks which Z-level is "active" for component placement
//  and visual emphasis in the viewport.
// ════════════════════════════════════════════════════════════
export const activeZLevelAtom = atom<number>(0);

// ════════════════════════════════════════════════════════════
//  14. VIEW CONTROL SIGNALS
// ════════════════════════════════════════════════════════════
/** Incrementing triggers a zoom-to-fit / reset-view action. */
export const resetViewSignalAtom = atom<number>(0);
/** Set to a component ID to trigger zoom-to-component. Null clears. */
export const zoomToComponentAtom = atom<string | null>(null);

// ════════════════════════════════════════════════════════════
//  15. CAMERA MODE — Ortho / Perspective switching
// ════════════════════════════════════════════════════════════
/** True = orthographic (default top-down), false = perspective (tilted 3D). */
export const isOrthoAtom = atom<boolean>(true);
/** Blend factor 0..1 for smooth visual transitions between camera modes. */
export const cameraBlendAtom = atom<number>(0);
/** Mobile camera touch mode: pan (default 2D) or rotate (orbit 3D). */
export const mobileCameraModeAtom = atom<'pan' | 'rotate'>('pan');

// ════════════════════════════════════════════════════════════
//  16. RAIL PLACEMENT — Two-click rail placement workflow
// ════════════════════════════════════════════════════════════
export const railPlacementAtom = atom<{ active: boolean; firstHole: import('three').Vector3 | null }>({ active: false, firstHole: null });

// ════════════════════════════════════════════════════════════
//  17. SOLVER DIAGNOSTICS — elapsed time, step count
// ════════════════════════════════════════════════════════════
export interface SolverDiagnostics {
    label: string;
    elapsedMs: number;
    step: number;
    totalSteps: number;
}
export const solverDiagnosticsAtom = atom<SolverDiagnostics | null>(null);

// ════════════════════════════════════════════════════════════
//  18. ROD PATH STUBS — compatibility with legacy UI components
//  `rodPathsAtom` and `selectedRodAtom` are still consumed by
//  Inspector's rod-properties panel; `rodConfigAtom` was a dead
//  alias that's no longer imported.
// ════════════════════════════════════════════════════════════
/** Rod paths stub — empty in ray system. */
export const rodPathsAtom = atom<{ forward: any[][]; imageFormation: any[][]; generation: number }>({ forward: [], imageFormation: [], generation: 0 });
/** Selected rod stub — null in ray system. */
export const selectedRodAtom = atom<{ source: string; pathIndex: number; segmentIndex: number } | null>(null);
