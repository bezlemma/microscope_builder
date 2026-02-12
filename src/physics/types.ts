import { Vector3 } from 'three';

// --- Coordinate Systems ---
// World Space (Optics Table): Right-handed, Z-up. Units: mm.
// Light Space (Component): Right-handed, W-axis along optical axis. UV is transverse plane.

export interface Complex {
    re: number;
    im: number;
}

export interface JonesVector {
    x: Complex;
    y: Complex;
}

export enum Coherence {
    Coherent,
    Incoherent
}

export interface Ray {
    origin: Vector3;    // World Position [mm]
    direction: Vector3; // World Direction (Normalized)
    wavelength: number; // Meters (SI)
    intensity: number;  // Arbitrary units for Solver 1, Flux for Solver 3
    polarization: JonesVector;
    opticalPathLength: number; // Accumulated phase [mm]
    interactionDistance?: number; // Distance to intersection (if any)
    footprintRadius: number; // [mm]
    coherenceMode: Coherence;
    
    // Quantum (Solver 5 support)
    entanglementId?: number;
    
    // Solver 2 skeleton: marks the primary path for Gaussian beam propagation.
    // Only the first child ray (index 0) from each interaction inherits this flag.
    isMainRay?: boolean;
    
    // Visualization: For thick components, the point where ray entered (front surface)
    // This allows the visualizer to draw: prev.origin → entryPoint → internalPath → origin → next
    entryPoint?: Vector3;
    // Internal bounce path (e.g. TIR inside prisms): world-space points between entry and exit
    internalPath?: Vector3[];
    // Where the ray was absorbed/trapped internally (e.g. TIR at prism apex with no exit face)
    // Visualizer draws path to this point so blocked rays show their full internal journey
    terminationPoint?: Vector3;
    // Post-trace split detection: identifies which surface the ray exited through.
    // Format: "ComponentName:faceName" (e.g. "Prism:front", "Prism:back").
    // Used to group rays from the same source that exit through different faces.
    exitSurfaceId?: string;
}

export interface HitRecord {
    t: number;          // Distance along ray
    point: Vector3;     // World Hit Point
    normal: Vector3;    // World Normal at hit point
    localPoint: Vector3; // Local Hit Point (u,v,w)
    localNormal?: Vector3;    // Local Normal (avoids world↔local round-trip errors)
    localDirection?: Vector3; // Local ray direction (avoids world↔local round-trip errors)
    surfaceIndex?: number; // Which surface was hit (for multi-surface components like lenses)
}

export interface InteractionResult {
    rays: Ray[]; // Child rays spawned by interaction
}

/**
 * Create a child ray from a parent, safely stripping visualization-only fields.
 *
 * The `...ray` spread pattern copies ALL fields from the incoming ray into
 * the child, including visualization metadata (`internalPath`, `terminationPoint`,
 * `entryPoint`, `interactionDistance`) that belong to the PARENT's history.
 * When components are chained (e.g. prism → lens), this causes the parent's
 * internal bounce points to "leak" into the child's visualization, creating
 * phantom ray segments that appear to jump back to a previous component.
 *
 * This helper strips those fields before applying overrides, so only
 * explicitly provided visualization data appears on the child ray.
 */
export function childRay(parent: Ray, overrides: Partial<Ray>): Ray {
    return {
        ...parent,
        // Strip visualization-only fields from parent
        entryPoint: undefined,
        internalPath: undefined,
        terminationPoint: undefined,
        interactionDistance: undefined,
        isMainRay: undefined,
        exitSurfaceId: undefined,
        // Apply caller's overrides last — these win
        ...overrides
    };
}
