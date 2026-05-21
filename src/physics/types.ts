import { Vector3 } from 'three';

export const MIN_PHYSICAL_PACKET_RADIUS_MM = 0.001;

// --- Coordinate Systems ---
// World Space (Optics Table): Right-handed, Z-up. Units: mm.
// Light Space (Component): Right-handed, W-axis along optical axis. UV is transverse plane.

export interface Complex {
    re: number;
    im: number;
}

// The complex E-field as a fully 3D vector in world XYZ. There's nothing
// special about any axis — Ex, Ey, Ez are equal members. The 2-component
// Jones of older Jones-calculus tutorials is just the special case where
// the propagation direction happens to be along world Z and the engine
// can implicitly assume Ez = 0; this codebase doesn't make that assumption.
export interface JonesVector {
    x: Complex;
    y: Complex;
    z: Complex;
}

export const ZERO_COMPLEX: Complex = { re: 0, im: 0 };

/** Project the complex E-field onto a real 3D unit vector → complex scalar. */
export function jonesProject(j: JonesVector, v: Vector3): Complex {
    return {
        re: j.x.re * v.x + j.y.re * v.y + j.z.re * v.z,
        im: j.x.im * v.x + j.y.im * v.y + j.z.im * v.z,
    };
}

/** Sum of complex-scalar × Vector3 contributions to build a Jones vector
 *  in world XYZ. Pass up to three (basis vector, complex amplitude) pairs. */
export function jonesFromBasis(
    a: Complex, ea: Vector3,
    b?: Complex, eb?: Vector3,
    c?: Complex, ec?: Vector3,
): JonesVector {
    const acc = { xr: 0, xi: 0, yr: 0, yi: 0, zr: 0, zi: 0 };
    const add = (amp: Complex | undefined, e: Vector3 | undefined) => {
        if (!amp || !e) return;
        acc.xr += amp.re * e.x; acc.xi += amp.im * e.x;
        acc.yr += amp.re * e.y; acc.yi += amp.im * e.y;
        acc.zr += amp.re * e.z; acc.zi += amp.im * e.z;
    };
    add(a, ea); add(b, eb); add(c, ec);
    return {
        x: { re: acc.xr, im: acc.xi },
        y: { re: acc.yr, im: acc.yi },
        z: { re: acc.zr, im: acc.zi },
    };
}

/** Magnitude-squared of the Jones vector (|E|²). */
export function jonesMagSq(j: JonesVector): number {
    return j.x.re * j.x.re + j.x.im * j.x.im
         + j.y.re * j.y.re + j.y.im * j.y.im
         + j.z.re * j.z.re + j.z.im * j.z.im;
}

/** Compute a polariscope-style RGB color from a ray's polarization state.
 *
 *  - The Jones vector (Ex, Ey, Ez) is projected onto the ray's transverse
 *    plane using a stable reference basis: e_h = (d × ẑ)/‖·‖ (the "horizontal"
 *    transverse direction in the table plane), e_v = d × e_h. Falls back to
 *    world X when d itself is along world Z.
 *  - The 2-component complex Jones in that basis gives the polarization
 *    ellipse: orientation angle ψ ∈ [0, π) and ellipticity χ ∈ [-π/4, π/4].
 *  - Map ψ → hue (a full rotation in real angle ψ corresponds to half a
 *    rotation in the polariscope, since polarization is 180°-periodic, so
 *    we use hue = 2ψ in degrees / 360 to cover all hues).
 *  - Map |sin(2χ)| → 1 − saturation (linear is fully saturated, circular
 *    desaturates to white).
 */
export function polarizationToColor(
    jones: JonesVector,
    direction: Vector3,
): { r: number; g: number; b: number } {
    const d = direction.clone().normalize();
    let eH = new Vector3().crossVectors(d, new Vector3(0, 0, 1));
    if (eH.lengthSq() < 1e-12) eH.set(1, 0, 0);
    eH.normalize();
    const eV = new Vector3().crossVectors(d, eH).normalize();

    const Eh = jonesProject(jones, eH);
    const Ev = jonesProject(jones, eV);

    const Ihh = Eh.re * Eh.re + Eh.im * Eh.im;
    const Ivv = Ev.re * Ev.re + Ev.im * Ev.im;
    // Re(Eh* · Ev) and Im(Eh* · Ev) — Eh-conjugate dotted with Ev.
    const reEhcEv = Eh.re * Ev.re + Eh.im * Ev.im;
    const imEhcEv = Eh.re * Ev.im - Eh.im * Ev.re;
    const total = Ihh + Ivv;
    if (total < 1e-12) return { r: 0.4, g: 0.4, b: 0.4 };

    // Standard polarization-ellipse formulas (Born & Wolf §1.4.2).
    const psi = 0.5 * Math.atan2(2 * reEhcEv, Ihh - Ivv); // major-axis angle ∈ (−π/2, π/2]
    const sin2Chi = (2 * imEhcEv) / total; // ∈ [−1, 1]; ±1 = circular.
    const psiNorm = ((psi % Math.PI) + Math.PI) % Math.PI; // wrap to [0, π)
    const hueDeg = (psiNorm / Math.PI) * 360; // hue covers all of [0, 360)
    const sat = 1 - Math.min(1, Math.abs(sin2Chi));

    return hsvToRgb(hueDeg, sat, 1.0);
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    const hh = ((h % 360) + 360) % 360 / 60;
    const c = v * s;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; b = 0; }
    else if (hh < 2) { r = x; g = c; b = 0; }
    else if (hh < 3) { r = 0; g = c; b = x; }
    else if (hh < 4) { r = 0; g = x; b = c; }
    else if (hh < 5) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return { r: r + m, g: g + m, b: b + m };
}

/** Pick a default linear polarization that's transverse to a propagation
 *  direction. Used by source factories so the emitted ray's E-field is
 *  always physical regardless of how the source was rotated. */
export function defaultTransversePolarization(direction: Vector3): JonesVector {
    const d = direction.clone().normalize();
    let upHint = new Vector3(0, 1, 0);
    if (Math.abs(d.dot(upHint)) > 0.9) upHint = new Vector3(0, 0, 1);
    const right = new Vector3().crossVectors(d, upHint).normalize();
    return {
        x: { re: right.x, im: 0 },
        y: { re: right.y, im: 0 },
        z: { re: right.z, im: 0 },
    };
}

/** Reproject a Jones vector onto the transverse plane of a refracted ray.
 *
 *  In a lossless refraction (Snell's law, no Fresnel amplitude loss) the S and
 *  P field amplitudes are preserved. The S basis vector — perpendicular to the
 *  incidence plane — is unchanged, but the P basis vector lies *in* that
 *  plane perpendicular to the propagation direction, so it rotates with the
 *  ray as the direction tilts at the interface. Without this rotation the
 *  Jones vector would acquire a non-physical longitudinal component, which
 *  later optics (PBSs especially) would misread as a mix of S and P. Calling
 *  this after every direction change keeps the E-field transverse.
 *
 *  At normal incidence the incidence plane is undefined and the input Jones
 *  is already transverse to both directions, so we pass it through. */
export function refractJones(
    jones: JonesVector,
    incidentDir: Vector3,
    surfaceNormal: Vector3,
    refractedDir: Vector3,
): JonesVector {
    const d = incidentDir.clone().normalize();
    const dp = refractedDir.clone().normalize();
    const n = surfaceNormal.clone().normalize();
    const s = new Vector3().crossVectors(d, n);
    const sLen = s.length();
    if (sLen < 1e-9) {
        return { x: { ...jones.x }, y: { ...jones.y }, z: { ...jones.z } };
    }
    s.divideScalar(sLen);
    const pIn = new Vector3().crossVectors(s, d).normalize();
    const pOut = new Vector3().crossVectors(s, dp).normalize();
    const Es = jonesProject(jones, s);
    const Ep = jonesProject(jones, pIn);
    // Lossless: rs = +1, rp = +1.
    return jonesFromBasis(Es, s, Ep, pOut);
}

/** Apply an ideal-mirror reflection to a Jones vector. The E-field is
 *  decomposed in the incidence-plane S/P basis, S-component is π-shifted
 *  (rs = -1), P-component is preserved (rp = +1, perfect-conductor convention)
 *  but expressed against the outgoing ray's P-direction. This automatically
 *  keeps the reflected E-field transverse to the new propagation direction.
 *
 *  At normal incidence (S/P degenerate) it falls back to the naive E → -E,
 *  which is the correct limit. */
export function reflectJones(
    jones: JonesVector,
    incidentDir: Vector3,
    surfaceNormal: Vector3,
    reflectedDir: Vector3,
): JonesVector {
    const d = incidentDir.clone().normalize();
    const dp = reflectedDir.clone().normalize();
    const n = surfaceNormal.clone().normalize();
    const s = new Vector3().crossVectors(d, n);
    const sLen = s.length();
    if (sLen < 1e-9) {
        // Normal incidence — S/P degenerate. The classical "E → −E" applies.
        return {
            x: { re: -jones.x.re, im: -jones.x.im },
            y: { re: -jones.y.re, im: -jones.y.im },
            z: { re: -jones.z.re, im: -jones.z.im },
        };
    }
    s.divideScalar(sLen);
    const pIn = new Vector3().crossVectors(s, d).normalize();
    const pOut = new Vector3().crossVectors(s, dp).normalize();
    const Es = jonesProject(jones, s);
    const Ep = jonesProject(jones, pIn);
    // Perfect-conductor Fresnel: rs = -1, rp = +1.
    return jonesFromBasis(
        { re: -Es.re, im: -Es.im }, s,
        { re: Ep.re, im: Ep.im }, pOut,
    );
}

export enum Coherence {
    Coherent,
    Incoherent
}

export interface Ray {
    origin: Vector3;    // World Position [mm]
    direction: Vector3; // World Direction (Normalized)
    wavelength: number; // Meters (SI)
    bandwidth?: number; // Meters (SI)
    intensity: number;  // Linear power weight
    powerWeight?: number; // Optional canonical power weight (mirrors intensity)
    currentMediumIndex?: number; // Refractive index of the medium the ray is currently inside
    polarization: JonesVector;
    phase?: number; // Explicit optical phase [rad]
    opticalPathLength: number; // Accumulated phase [mm]
    interactionDistance?: number; // Distance to next intersection (if any)
    interactionComponentId?: string; // ID of the component that was hit
    footprintRadius: number; // [mm] — local Gaussian beam radius
    coherenceMode: Coherence;
    sourcePosition?: Vector3;

    // Quantum (future)
    entanglementId?: number;

    // Representative path marker used by visual overlays and split recovery.
    isMainRay?: boolean;

    // Identifies rays traced from the sensor backward to the source.
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

function cloneJonesVector(jones: JonesVector): JonesVector {
    return {
        x: { re: jones.x.re, im: jones.x.im },
        y: { re: jones.y.re, im: jones.y.im },
        z: { re: jones.z.re, im: jones.z.im },
    };
}

function rayPhaseFromOpl(opticalPathLength: number, wavelength: number): number {
    const wavelengthMm = wavelength * 1e3;
    if (!Number.isFinite(wavelengthMm) || Math.abs(wavelengthMm) < 1e-12) return 0;
    return (2 * Math.PI * opticalPathLength) / wavelengthMm;
}

function finalizeRay(rayState: Ray): Ray {
    const direction = rayState.direction.clone().normalize();
    const refractiveIndex = rayState.currentMediumIndex ?? 1;

    return {
        ...rayState,
        origin: rayState.origin.clone(),
        direction,
        bandwidth: rayState.bandwidth ?? 0,
        powerWeight: rayState.powerWeight ?? rayState.intensity,
        currentMediumIndex: refractiveIndex,
        footprintRadius: Math.max(rayState.footprintRadius ?? MIN_PHYSICAL_PACKET_RADIUS_MM, MIN_PHYSICAL_PACKET_RADIUS_MM),
        polarization: cloneJonesVector(rayState.polarization),
        phase: rayState.phase ?? rayPhaseFromOpl(rayState.opticalPathLength, rayState.wavelength),
        sourcePosition: (rayState.sourcePosition ?? rayState.origin).clone(),
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

/**
 * Create a child ray from a parent, stripping visualization-only fields that
 * belong to the parent's history (entryPoint, internalPath, terminationPoint,
 * interactionDistance, exitSurfaceId, suppressVisualization). Without this,
 * chained components like prism → lens would have the parent's internal bounce
 * points leak into the child's visualization.
 */
export function childRay(parent: Ray, overrides: Partial<Ray>): Ray {
    const draft: Ray = {
        ...parent,
        entryPoint: undefined,
        internalPath: undefined,
        terminationPoint: undefined,
        interactionDistance: undefined,
        interactionComponentId: undefined,
        exitSurfaceId: undefined,
        suppressVisualization: undefined,
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
