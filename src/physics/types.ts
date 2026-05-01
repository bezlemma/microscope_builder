import { Vector3 } from 'three';
import {
    GaussianPacketQ,
    cloneGaussianPacketQ,
    gaussianAxisStateFromQ,
    gaussianPacketQFromAxisStates,
    propagateGaussianPacketQ,
} from './gaussianPacketState';

export const MIN_PHYSICAL_PACKET_RADIUS_MM = 0.001;

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
    majorAxis?: Vector3;   // Transverse packet major-axis direction
    majorLength?: number;  // Reference semi-major support radius [mm]
    tanAlpha?: number;     // Diagnostic packet divergence tangent
    eU?: number;           // Major-axis eccentricity factor
    eV?: number;           // Minor-axis eccentricity factor
    sigmaU?: number;       // Gaussian amplitude sigma along major axis [mm]
    sigmaV?: number;       // Gaussian amplitude sigma along minor axis [mm]
    curvatureRadiusU?: number; // Wavefront radius along major axis [mm]
    curvatureRadiusV?: number; // Wavefront radius along minor axis [mm]
    packetQ?: GaussianPacketQ; // Complex 2x2 q-matrix in the ray transverse basis
    packetStateMode?: 'compat' | 'explicit';
    transverseProfile?: 'gaussian' | 'superGaussian' | 'flat';
    transverseProfileOrder?: number;
    wavelength: number; // Meters (SI)
    bandwidth?: number; // Meters (SI)
    intensity: number;  // Arbitrary units for Solver 1, Flux for Solver 3
    powerWeight?: number; // Canonical Gaussian Packet power weight
    currentMediumIndex?: number; // Medium index carrying this packet
    polarization: JonesVector;
    phase?: number; // Explicit optical phase [rad]
    opticalPathLength: number; // Accumulated phase [mm]
    interactionDistance?: number; // Distance to intersection (if any)
    interactionComponentId?: string; // ID of the component that was hit
    footprintRadius: number; // [mm]
    coherenceMode: Coherence;
    sourcePosition?: Vector3;
    sourceCellArea?: number; // Source-plane cell represented by this packet [mm^2]

    // Quantum (Solver 5 support)
    entanglementId?: number;

    // Representative path marker used by visual overlays and split recovery.
    // Solver 2 no longer depends on this flag for beamlet propagation.
    isMainRay?: boolean;

    // Solver 3: identifies rays traced from the sensor backward to the source.
    // Used to apply specialized interaction logic (e.g. spectral leakage).
    isBackward?: boolean;

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
    // Source identification: which laser/source this ray originated from.
    // Used to group rays by source in population analysis, preventing
    // cross-laser contamination in split detection and fallback white lines.
    sourceId?: string;
    sourceKind?: 'laser' | 'lamp' | 'point2d' | 'point3d' | 'cone' | 'wedge' | 'structured' | 'pmtPreview';
    packetLaunchRigor?: 'rigorous' | 'geometricFallback';

    // Display-only suppression for physically traced branches that are not
    // useful as table-overlay rays, such as microscopic bead surface glints.
    suppressVisualization?: boolean;
    // Display-only suppression for the infinite extension of a traced branch.
    // The finite component-to-component segments remain visible, but if the
    // branch escapes without another interaction the table overlay does not
    // draw a long tail across the bench.
    suppressOpenTail?: boolean;
}

export interface HitRecord {
    t: number;          // Distance along ray
    point: Vector3;     // World Hit Point
    normal: Vector3;    // World Normal at hit point
    localPoint: Vector3; // Local Hit Point (u,v,w)
    localNormal?: Vector3;    // Local Normal (avoids world↔local round-trip errors)
    localDirection?: Vector3; // Local ray direction (avoids world↔local round-trip errors)
    surfaceIndex?: number; // Which surface was hit (for multi-surface components like lenses)
    isBlocked?: boolean; // If true, the ray hit an opaque physical bound (like a metal lens barrel)
}

export interface InteractionResult {
    rays: Ray[]; // Child rays spawned by interaction
    passthrough?: boolean; // If true, the component is transparent — don't break the ray path
}

export function cloneJonesVector(jones: JonesVector): JonesVector {
    return {
        x: { re: jones.x.re, im: jones.x.im },
        y: { re: jones.y.re, im: jones.y.im },
    };
}

export function defaultRayMajorAxis(direction: Vector3): Vector3 {
    const dir = direction.clone().normalize();
    const reference = Math.abs(dir.y) < 0.9
        ? new Vector3(0, 1, 0)
        : new Vector3(1, 0, 0);
    const axis = new Vector3().crossVectors(dir, reference);
    if (axis.lengthSq() < 1e-12) {
        axis.set(0, 0, 1).cross(dir);
    }
    return axis.normalize();
}

function rayPhaseFromOpl(opticalPathLength: number, wavelength: number): number {
    const wavelengthMm = wavelength * 1e3;
    if (!Number.isFinite(wavelengthMm) || Math.abs(wavelengthMm) < 1e-12) return 0;
    return (2 * Math.PI * opticalPathLength) / wavelengthMm;
}

function finalizeRay(rayState: Ray): Ray {
    const direction = rayState.direction.clone().normalize();
    const majorAxis = (rayState.majorAxis ?? defaultRayMajorAxis(direction)).clone();
    const projectedMajorAxis = majorAxis.sub(direction.clone().multiplyScalar(majorAxis.dot(direction)));
    const orthogonalMajorAxis = projectedMajorAxis.lengthSq() > 1e-12
        ? projectedMajorAxis.normalize()
        : defaultRayMajorAxis(direction);
    const majorLength = Math.max(
        rayState.majorLength ?? rayState.footprintRadius ?? MIN_PHYSICAL_PACKET_RADIUS_MM,
        MIN_PHYSICAL_PACKET_RADIUS_MM,
    );
    const eU = rayState.eU ?? 1;
    const eV = rayState.eV ?? 1;
    const referenceRadius = majorLength / Math.max(Math.abs(eU), 1e-9);
    const minorLength = Math.max(referenceRadius * Math.max(Math.abs(eV), 1e-9), MIN_PHYSICAL_PACKET_RADIUS_MM);
    const representativeRadius = Math.max((majorLength + minorLength) * 0.5, MIN_PHYSICAL_PACKET_RADIUS_MM);
    const wavelengthMm = Math.max(rayState.wavelength * 1e3, 1e-12);
    const refractiveIndex = rayState.currentMediumIndex ?? 1;
    const packetQ = rayState.packetQ ? cloneGaussianPacketQ(rayState.packetQ) : undefined;
    const packetAxisU = packetQ
        ? gaussianAxisStateFromQ(packetQ.uu, wavelengthMm, refractiveIndex)
        : {
            sigma: Math.max(rayState.sigmaU ?? (majorLength / 3), MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: rayState.curvatureRadiusU ?? Number.POSITIVE_INFINITY,
        };
    const packetAxisV = packetQ
        ? gaussianAxisStateFromQ(packetQ.vv, wavelengthMm, refractiveIndex)
        : {
            sigma: Math.max(rayState.sigmaV ?? (minorLength / 3), MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: rayState.curvatureRadiusV ?? Number.POSITIVE_INFINITY,
        };
    const transverseProfile = rayState.transverseProfile ?? 'gaussian';

    return {
        ...rayState,
        origin: rayState.origin.clone(),
        direction,
        majorAxis: orthogonalMajorAxis,
        majorLength,
        tanAlpha: rayState.tanAlpha ?? (wavelengthMm / Math.max(majorLength, MIN_PHYSICAL_PACKET_RADIUS_MM)),
        eU,
        eV,
        sigmaU: packetAxisU.sigma,
        sigmaV: packetAxisV.sigma,
        curvatureRadiusU: packetAxisU.curvatureRadius,
        curvatureRadiusV: packetAxisV.curvatureRadius,
        packetQ,
        packetStateMode: packetQ ? (rayState.packetStateMode ?? 'explicit') : (rayState.packetStateMode ?? 'compat'),
        transverseProfile,
        transverseProfileOrder: rayState.transverseProfileOrder
            ?? (transverseProfile === 'superGaussian' ? 3 : (transverseProfile === 'flat' ? 0 : 1)),
        bandwidth: rayState.bandwidth ?? 0,
        powerWeight: rayState.powerWeight ?? rayState.intensity,
        currentMediumIndex: refractiveIndex,
        footprintRadius: Math.max(rayState.footprintRadius ?? representativeRadius, MIN_PHYSICAL_PACKET_RADIUS_MM),
        polarization: cloneJonesVector(rayState.polarization),
        phase: rayState.phase ?? rayPhaseFromOpl(rayState.opticalPathLength, rayState.wavelength),
        sourcePosition: (rayState.sourcePosition ?? rayState.origin).clone(),
        sourceCellArea: rayState.sourceCellArea,
        entryPoint: rayState.entryPoint?.clone(),
        internalPath: rayState.internalPath?.map(point => point.clone()),
        terminationPoint: rayState.terminationPoint?.clone(),
    };
}

export function createRay(rayState: Ray): Ray {
    return finalizeRay(rayState);
}

export function rayPowerWeight(ray: Pick<Ray, 'powerWeight' | 'intensity'>): number {
    return ray.powerWeight ?? ray.intensity;
}

function propagatedPacketOverrides(parent: Ray, overrides: Partial<Ray>): Partial<Ray> {
    if (overrides.packetQ) return {};
    if (!parent.packetQ && parent.packetStateMode !== 'explicit') return {};

    const targetOrigin = overrides.origin;
    const targetOpl = overrides.opticalPathLength;
    const refractiveIndex = overrides.currentMediumIndex ?? parent.currentMediumIndex ?? 1;
    let traveledDistance = 0;
    if (targetOrigin) {
        traveledDistance = Math.max(targetOrigin.distanceTo(parent.origin), 0);
    } else if (targetOpl !== undefined) {
        traveledDistance = Math.max((targetOpl - parent.opticalPathLength) / Math.max(refractiveIndex, 1e-9), 0);
    }

    if (traveledDistance <= 0 && !parent.packetQ) return {};

    const wavelengthMm = Math.max(parent.wavelength * 1e3, 1e-12);
    const baseQ = parent.packetQ ?? gaussianPacketQFromAxisStates(
        {
            sigma: parent.sigmaU ?? Math.max(parent.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: parent.curvatureRadiusU ?? Number.POSITIVE_INFINITY,
        },
        {
            sigma: parent.sigmaV ?? Math.max(parent.footprintRadius / 3, MIN_PHYSICAL_PACKET_RADIUS_MM / 3),
            curvatureRadius: parent.curvatureRadiusV ?? Number.POSITIVE_INFINITY,
        },
        wavelengthMm,
        parent.currentMediumIndex ?? 1,
    );
    const packetQ = propagateGaussianPacketQ(baseQ, traveledDistance);
    const axisU = gaussianAxisStateFromQ(packetQ.uu, wavelengthMm, refractiveIndex);
    const axisV = gaussianAxisStateFromQ(packetQ.vv, wavelengthMm, refractiveIndex);
    return {
        packetQ,
        packetStateMode: 'explicit',
        sigmaU: axisU.sigma,
        sigmaV: axisV.sigma,
        curvatureRadiusU: axisU.curvatureRadius,
        curvatureRadiusV: axisV.curvatureRadius,
        majorLength: overrides.majorLength ?? Math.max(3 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
        footprintRadius: overrides.footprintRadius ?? Math.max(Math.SQRT2 * Math.max(axisU.sigma, axisV.sigma), MIN_PHYSICAL_PACKET_RADIUS_MM),
    };
}

/**
 * Create a child ray from a parent, safely stripping visualization-only fields.
 *
 * The `...ray` spread pattern copies ALL fields from the incoming ray into
 * the child, including visualization metadata (`internalPath`, `terminationPoint`,
 * `entryPoint`, `interactionDistance`) and the parent's interaction target that
 * belong to the PARENT's history.
 * When components are chained (e.g. prism → lens), this causes the parent's
 * internal bounce points to "leak" into the child's visualization, creating
 * phantom ray segments that appear to jump back to a previous component.
 *
 * This helper strips those fields before applying overrides, so only
 * explicitly provided visualization data appears on the child ray.
 */
export function childRay(parent: Ray, overrides: Partial<Ray>): Ray {
    const draft: Ray = {
        ...parent,
        // Strip visualization-only fields from parent
        entryPoint: undefined,
        internalPath: undefined,
        terminationPoint: undefined,
        interactionDistance: undefined,
        interactionComponentId: undefined,
        exitSurfaceId: undefined,
        suppressVisualization: undefined,
        ...propagatedPacketOverrides(parent, overrides),
        // Apply caller's overrides last — these win
        ...overrides
    };

    if (overrides.opticalPathLength !== undefined && overrides.phase === undefined) {
        draft.phase = undefined;
    }

    if (overrides.intensity !== undefined && overrides.powerWeight === undefined) {
        draft.powerWeight = overrides.intensity;
    } else if (overrides.powerWeight !== undefined && overrides.intensity === undefined) {
        draft.intensity = overrides.powerWeight;
    }

    return finalizeRay(draft);
}
