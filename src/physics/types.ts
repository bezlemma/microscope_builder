import { Vector3, Matrix4 } from 'three';

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
    
    // Visualization: For thick components, the point where ray entered (front surface)
    // This allows the visualizer to draw: prev.origin → entryPoint → origin → next
    entryPoint?: Vector3;
}

export interface HitRecord {
    t: number;          // Distance along ray
    point: Vector3;     // World Hit Point
    normal: Vector3;    // World Normal at hit point
    localPoint: Vector3; // Local Hit Point (u,v,w)
}

export interface InteractionResult {
    rays: Ray[]; // Child rays spawned by interaction
}
