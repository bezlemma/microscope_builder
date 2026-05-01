import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { serializeScene, deserializeScene } from './ubzSerializer';
import { PropertyAnimator, type AnimationChannel } from '../physics/PropertyAnimator';
import { Card } from '../physics/components/Card';
import { Camera } from '../physics/components/Camera';
import { PMT } from '../physics/components/PMT';
import { QPD } from '../physics/components/QPD';
import { Sample } from '../physics/components/Sample';
import { SampleChamber } from '../physics/components/SampleChamber';
import type { GaussianBeamSegment } from '../physics/Solver2';

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
import { createTutorialMicroscopeScene, createTutorialScene } from '../presets/tutorial';
import { createCheHangYu2026Scene } from '../presets/CheHangYu2026';

// --- State Types ---
export interface RayConfig {
    rayCount: number; // Number of intermediate rays
    reversePathCount: number; // Backward paths retained for rod/wave visualization
    showFootprint: boolean;
    solver2Enabled: boolean; // Beamlet/bundle data toggle
    viewerMode: 'rods' | 'wave' | 'planes';
    minRayOpacity: number; // Minimum opacity for the dimmest visible rays (0..1)
    maxRayOpacity: number; // Maximum opacity for the brightest rays (0..1)
}

export const MIN_FORWARD_RAY_COUNT = 4;
export const OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT = 100;
export const MAX_FORWARD_RAY_COUNT = 30000;
export const MIN_REVERSE_PATH_COUNT = 1;
export const MAX_REVERSE_PATH_COUNT = 30000;

export const DEFAULT_RAY_CONFIG: RayConfig = {
    rayCount: 32,
    // Always 1: each progressive round adds one sample/pixel and the
    // accumulator builds the running average across rounds, so a "samples
    // per pixel" knob is redundant.  Kept as a constant so older save files
    // referencing the field still load cleanly.
    reversePathCount: 1,
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
    Tutorial2 = "Tutorial 2",
    CheHangYu2026 = "Papers: Yu 2026 (Nisam 2x)",
}

export type ViewMode = 'schematic' | 'realistic';
export const viewModeAtom = atom<ViewMode>('schematic');

const INITIAL_TUTORIAL = createTutorialScene();

export const presetDescriptionAtom = atom<string>(INITIAL_TUTORIAL.description ?? "");

export const activePresetAtom = atom<PresetName | null>(PresetName.Tutorial);

export type TutorialStage = 1 | 2;
export const tutorialStageAtom = atom<TutorialStage>(1);

export const componentsAtom = atom<OpticalComponent[]>(INITIAL_TUTORIAL.scene);

/** Normalized preset result — all presets produce this shape. */
export interface PresetResult {
    scene: OpticalComponent[];
    description?: string;
    channels?: import('../physics/PropertyAnimator').AnimationChannel[];
    animationPlaying?: boolean;
    animationSpeed?: number;
    /** Optional full ray-display override for presets with special visibility needs. */
    rayConfig?: Partial<RayConfig>;
    /** Override the forward (rod-tracer) ray-per-source count when this preset
     *  loads.  Falls back to DEFAULT_RAY_CONFIG.rayCount when omitted. */
    rayCount?: number;
}

// Action to load a preset
const presetFactories = new Map<PresetName, () => PresetResult>([
    [PresetName.Blank, () => ({ scene: createBlankScene() })],
    [PresetName.BeamExpander, () => ({ scene: createBeamExpanderScene() })],
    [PresetName.TransFluorescence, () => ({ scene: createTransFluorescenceScene() })],
    [PresetName.Brightfield, () => ({ scene: createBrightfieldScene() })],
    [PresetName.LensZoo, () => ({ scene: createLensZooScene() })],
    [PresetName.PrismDebug, () => ({ scene: createPrismDebugScene() })],
    [PresetName.PolarizationZoo, () => ({
        scene: createPolarizationZooScene(),
        rayConfig: { solver2Enabled: true, viewerMode: 'wave' },
    })],
    [PresetName.MZInterferometer, () => ({
        scene: createMZInterferometerScene(),
        rayConfig: { solver2Enabled: true, viewerMode: 'wave' },
    })],
    [PresetName.EpiFluorescence, () => ({ scene: createEpiFluorescenceScene() })],
    [PresetName.OpenSPIM, () => ({ scene: createOpenSPIMScene(), rayCount: 100 })],
    [PresetName.Confocal, () => createConfocalScene()],
    [PresetName.OpticalTrap, () => ({
        scene: createOpticalTrapScene(),
        rayCount: 500,
        rayConfig: { minRayOpacity: 0, maxRayOpacity: 0.4 },
    })],
    [PresetName.Tutorial, () => createTutorialScene()],
    [PresetName.Tutorial2, () => createTutorialMicroscopeScene()],
    [PresetName.CheHangYu2026, () => createCheHangYu2026Scene()],
]);

/** URL-friendly slug for a preset name (e.g. "Papers: Yu 2026 (Nisam 2x)"
 *  → "papers-yu-2026-nisam-2x"). Mirrors the slug derivation in App.tsx so
 *  preset URLs are stable across the URL effect and `loadPresetAtom`. */
function presetSlug(name: PresetName): string {
    if (name === PresetName.Tutorial2) return 'tutorial2';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Replace the address bar with a clean preset URL, dropping any leftover
 *  `#scene=` hash from a Share link or stale `?preset=` slug. No reload. */
function syncUrlToPreset(presetName: PresetName | null): void {
    if (typeof window === 'undefined') return;
    const base = window.location.pathname;
    const next = presetName ? `${base}#preset=${presetSlug(presetName)}` : base;
    window.history.replaceState(null, '', next);
}

export const loadPresetAtom = atom(
    null,
    (get, set, presetName: PresetName) => {
        set(activePresetAtom, presetName);
        set(tutorialStageAtom, presetName === PresetName.Tutorial2 ? 2 : 1);
        syncUrlToPreset(presetName);
        // Reset bundle-view state for fresh preset
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
        set(undoStackAtom, []); // Clear undo history on preset load
        set(activeZLevelAtom, 0); // Reset Z-level
        set(measurementAtom, { active: false, selectedId: null, measurements: [] });

        const factory = presetFactories.get(presetName);
        if (!factory) return;
        const result = factory();

        // Per-preset forward ray count override (OpenSPIM wants more rays for
        // a visible light sheet, etc.).
        if (result.rayCount !== undefined) {
            set(rayConfigAtom, prev => ({ ...prev, rayCount: result.rayCount! }));
        }
        if (result.rayConfig) {
            set(rayConfigAtom, prev => ({ ...prev, ...result.rayConfig }));
        }

        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();

        if (result.channels) {
            for (const ch of result.channels) {
                animator.addChannel(ch);
            }
        }

        set(componentsAtom, result.scene);
        set(presetDescriptionAtom, result.description || "");

        if (result.animationPlaying !== undefined) {
            set(animationPlayingAtom, result.animationPlaying);
        }
        if (result.animationSpeed !== undefined) {
            set(animationSpeedAtom, result.animationSpeed);
        }

        // Phone-friendly defaults: every detector in the preset (Cameras,
        // scan-configured PMTs, and QPDs) starts with its viewer pinned so the image
        // panel is visible immediately. We also kick off the Solver-3
        // backward-trace so the user sees a first image without having to
        // press Render.
        const cards = presetName === PresetName.MZInterferometer
            ? result.scene.filter((c): c is Card => c instanceof Card)
            : [];
        const cameras = result.scene.filter((c): c is Camera => c instanceof Camera && !c.isGhost);
        const pmts = result.scene.filter((c): c is PMT => c instanceof PMT && (c as PMT).hasValidAxes());
        const qpds = result.scene.filter((c): c is QPD => c instanceof QPD);
        const hasImageDetector = cameras.length > 0 || pmts.length > 0;
        const hasDetector = hasImageDetector || qpds.length > 0 || cards.length > 0;
        const shouldPinSampleView = presetName === PresetName.OpenSPIM || presetName === PresetName.OpticalTrap;
        if (hasDetector || shouldPinSampleView) {
            const pinned = new Set(get(pinnedViewersAtom));
            for (const card of cards) pinned.add(card.id);
            for (const cam of cameras) pinned.add(cam.id);
            for (const pmt of pmts) pinned.add(pmt.id);
            for (const qpd of qpds) pinned.add(qpd.id);
            // OpenSPIM and Optical Trap both need the local sample view to
            // make the core interaction legible: light-sheet placement for
            // OpenSPIM, bead capture inside the flow cell for Optical Trap.
            if (shouldPinSampleView) {
                for (const comp of result.scene) {
                    if (comp instanceof Sample || comp instanceof SampleChamber) {
                        pinned.add(comp.id);
                    }
                }
            }
            set(pinnedViewersAtom, pinned);
            // Bumping the trigger atom causes OpticalTable's Solver-3 effect to
            // run. It reads `components` at render time and will see the new scene.
            if (hasImageDetector) {
                set(solver3RenderTriggerAtom, get(solver3RenderTriggerAtom) + 1);
            }
        }

        // Auto-start PMT raster scans the same way cameras auto-render.  PMTs
        // build their image by raster-scanning galvo channels, so they need
        // `scanAccumTriggerAtom` bumped when the same preset is clicked again;
        // otherwise a configured PMT can keep showing its previous run.
        if (pmts.length > 0 && result.channels && result.channels.length > 0) {
            const prev = get(scanAccumTriggerAtom);
            set(scanAccumTriggerAtom, { steps: prev.steps, trigger: prev.trigger + 1 });
        }
    }
);

// 2. Selection State (supports multi-select via Ctrl+Click)
export const selectionAtom = atom<string[]>([]);
export const opticalPlaneInspectorClearSignalAtom = atom<number>(0);

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
        const minRayCount = mode === 'planes' ? OPTICAL_PLANE_MIN_FORWARD_RAY_COUNT : MIN_FORWARD_RAY_COUNT;
        set(rayConfigAtom, {
            ...current,
            rayCount: Math.max(current.rayCount, minRayCount),
            solver2Enabled: mode === 'wave' ? true : (mode === 'planes' ? false : current.solver2Enabled),
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

// 6a. Forward ray paths — published whenever Solver 1 traces.  Other viewers
// (e.g. SampleZoomViewer) read from this so they don't have to re-trace.
export const forwardRaysAtom = atom<import('../physics/types').Ray[][]>([]);
/** Reverse ray paths from Solver 3, published for SVG export and diagnostics. */
export const reverseRaysAtom = atom<import('../physics/types').Ray[][]>([]);

// Trap beam segments are published even when the global Solver-2 wave overlay
// is hidden, so the optical-trap sample viewer can show diagnostics using the
// same cached field that drives bead/colloid dynamics.
export const trapBeamSegmentsAtom = atom<GaussianBeamSegment[][]>([]);

// 7. Solver 3 render trigger — incrementing this value triggers a Solver 3 render
export const solver3RenderTriggerAtom = atom<number>(0);

// 8. Solver 3 rendering status — true while render is in progress
export const solver3RenderingAtom = atom<boolean>(false);

// 8.5. Drawn ray counts — number of forward and reverse rays currently visualized
export const drawnRayCountsAtom = atom<{ forward: number; reverse: number }>({ forward: 0, reverse: 0 });

// 8.6. Camera image tick — bumped every time Solver-3 refreshes a camera's
// emission/excitation image. Lets CameraViewer re-render on each progressive
// round without having to watch the mutated Camera instance directly.
export const cameraImageTickAtom = atom<number>(0);

// 8.7. Card image tick — bumped when Card detector hit/profile data changes.
// Cards are mutated by the forward tracer, so their viewers need the same
// explicit invalidation path cameras use.
export const cardImageTickAtom = atom<number>(0);

export const startTutorialStage2Atom = atom(
    null,
    (get, set) => {
        const result = createTutorialMicroscopeScene();

        set(tutorialStageAtom, 2);
        set(activePresetAtom, PresetName.Tutorial2);
        syncUrlToPreset(PresetName.Tutorial2);
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
        set(undoStackAtom, []);
        set(activeZLevelAtom, 0);
        set(measurementAtom, { active: false, selectedId: null, measurements: [] });

        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();
        set(animationPlayingAtom, false);
        set(animationSpeedAtom, 1.0);

        set(componentsAtom, result.scene);
        set(presetDescriptionAtom, result.description || "");
        set(selectionAtom, []);
        set(pinnedViewersAtom, new Set());
        set(solver3RenderingAtom, false);
        set(scanAccumProgressAtom, 0);
        set(cameraImageTickAtom, tick => tick + 1);
    }
);

// 9. Load scene from deserialized components (e.g. from .ubz file)
export const loadSceneAtom = atom(
    null,
    (get, set, components: OpticalComponent[]) => {
        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();

        set(componentsAtom, components);
        set(activePresetAtom, null);
        set(tutorialStageAtom, 1);
        set(presetDescriptionAtom, "");
        set(rayConfigAtom, { ...DEFAULT_RAY_CONFIG });
        set(selectionAtom, []);
        set(undoStackAtom, []); // Clear undo history on scene load
        set(animationPlayingAtom, false);
        set(animationSpeedAtom, 1.0);
        set(solver3RenderingAtom, false);
        set(scanAccumProgressAtom, 0);
        set(activeZLevelAtom, 0);
        set(measurementAtom, { active: false, selectedId: null, measurements: [] });
        set(resetViewSignalAtom, signal => signal + 1);
        // The scene is now whatever the user just loaded — no preset matches it,
        // and any pasted Share-link hash that brought us here is now consumed.
        // Wipe the address bar so the user isn't stuck looking at the old URL.
        syncUrlToPreset(null);
    }
);

// ════════════════════════════════════════════════════════════
//  10. UNDO SYSTEM — Ctrl+Z support
//  Stores serialized scene snapshots. Max 20 entries.
// ════════════════════════════════════════════════════════════
const MAX_UNDO = 20; // How much RAM does this cost us? Seems like not a lot.
interface UndoSnapshot {
    sceneText: string;
    channels: AnimationChannel[];
    animationPlaying: boolean;
    animationSpeed: number;
}

function cloneChannels(channels: AnimationChannel[]): AnimationChannel[] {
    return channels.map(ch => ({ ...ch }));
}

export const undoStackAtom = atom<UndoSnapshot[]>([]);

/** Push current scene state onto the undo stack (call BEFORE mutation). */
export const pushUndoAtom = atom(
    null,
    (get, set) => {
        const components = get(componentsAtom);
        const animator = get(animatorAtom);
        const snapshot: UndoSnapshot = {
            sceneText: serializeScene(components),
            channels: cloneChannels(animator.channels),
            animationPlaying: get(animationPlayingAtom),
            animationSpeed: get(animationSpeedAtom),
        };
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
        const restored = deserializeScene(snapshot.sceneText);
        const restoredIds = new Set(restored.map(c => c.id));
        const restoredChannels = snapshot.channels.filter(ch => restoredIds.has(ch.targetId));
        const animator = get(animatorAtom);
        animator.clearAll();
        animator.reset();
        for (const ch of restoredChannels) {
            animator.addChannel({ ...ch });
        }
        set(componentsAtom, restored);
        set(selectionAtom, []);
        set(animationPlayingAtom, snapshot.animationPlaying && restoredChannels.length > 0);
        set(animationSpeedAtom, snapshot.animationSpeed);
        set(solver3RenderingAtom, false);
        set(scanAccumProgressAtom, 0);
        set(cameraImageTickAtom, tick => tick + 1);
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

// Presentation/edit lock: hide editing UI and disable component mutation while
// leaving camera navigation active.
export const uiLockedAtom = atom<boolean>(false);

export type MeasurementPoint = { x: number; y: number; z: number };
export type MeasurementDrawMode = 'line' | 'angle';
export type MeasurementPlaneMode = 'free' | 'xy' | 'xz' | 'yz';
export interface Measurement {
    id: string;
    points: MeasurementPoint[];
}
export interface MeasurementZoomTarget {
    id: string;
    points: MeasurementPoint[];
}
export interface MeasurementState {
    active: boolean;
    selectedId: string | null;
    measurements: Measurement[];
    drawMode?: MeasurementDrawMode;
    planeMode?: MeasurementPlaneMode;
    showProjected?: boolean;
}
export const measurementAtom = atom<MeasurementState>({
    active: false,
    selectedId: null,
    measurements: [],
    drawMode: 'line',
    planeMode: 'free',
    showProjected: true,
});

// ════════════════════════════════════════════════════════════
//  14. VIEW CONTROL SIGNALS
// ════════════════════════════════════════════════════════════
/** Incrementing triggers a zoom-to-fit / reset-view action. */
export const resetViewSignalAtom = atom<number>(0);
/** Set to a component ID to trigger zoom-to-component. Null clears. */
export const zoomToComponentAtom = atom<string | null>(null);
/** Set to measurement points to center the camera on that measurement. Null clears. */
export const zoomToMeasurementAtom = atom<MeasurementZoomTarget | null>(null);
/** Incrementing asks the active R3F canvas to export the current camera view as SVG. */
export const svgExportRequestAtom = atom<number>(0);

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
//  16. TWO-HOLE PLACEMENT — pick a starting hole, then an ending
//  hole.  Reused by Rails and by arrow / curved-arrow annotations.
// ════════════════════════════════════════════════════════════
export type TwoHolePlacementKind = 'rail' | 'arrowAnnotation' | 'curvedArrowAnnotation';

export interface TwoHolePlacementState {
    active: boolean;
    kind: TwoHolePlacementKind;
    firstHole: import('three').Vector3 | null;
}

export const railPlacementAtom = atom<TwoHolePlacementState>({ active: false, kind: 'rail', firstHole: null });

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
