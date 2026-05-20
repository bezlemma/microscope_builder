import { Vector3, Box3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, Coherence } from '../types';
import { OpticMesh } from '../OpticMesh';
import { reflectVector } from '../math_solvers';
import { BeamField, type GaussianBeamSegment } from '../BeamField';

/**
 * TrappedBead — a small dielectric microsphere whose position responds to the
 * radiation pressure of the rays that hit it (the Ashkin ray-optics model of
 * an optical trap).
 *
 * The bead is intentionally NOT a Sample subclass. Sample is the pass-through
 * Mickey-shaped fluorophore used for imaging presets; the bead is a refractive
 * micron-scale sphere with dynamic state. Conflating them would pollute both.
 *
 * Per-frame physics, in two halves:
 *
 * 1. During forward tracer's forward trace, every ray that enters the bead causes a
 *    single `interact()` call.  We trace the ray's full chord through the
 *    sphere (refract at entry → straight line inside → refract at exit) in
 *    one shot and add the photon-momentum change
 *
 *        Δp = (n_medium · I_ray / c) · (d_in − d_out)
 *
 *    to `forceAccumulator`.  Because forward tracer calls `interact()` once per ray
 *    serially, the accumulator is naturally collected without race conditions.
 *
 * 2. Once per frame (driven from OpticalTable's render loop), the integrator
 *    calls `applyForceStep(dtSeconds)` which:
 *
 *        - reads `forceAccumulator`
 *        - adds an overdamped Brownian kick √(2 k_B T γ / dt) η(t)
 *        - integrates the bead's `specimenOffset` via overdamped Langevin
 *
 *              dx/dt = (F_optical + F_brownian) / γ
 *
 *          where γ = 6π η_water R is Stokes drag for a sphere of radius R.
 *        - resets `forceAccumulator` to zero for the next frame
 *        - bumps `version` so the visualizer & React subtree update
 *
 * The model is intentionally simplified — no separate scattering vs gradient
 * decomposition, no Mie regime, no polarization-dependent trapping — but the
 * qualitative behaviour is correct:
 *
 *   · Increase the laser power → forceAccumulator scales linearly → trap
 *     stiffens → bead jitters less.
 *   · Use a lower-NA objective → focus widens → fewer rays converge on the
 *     bead per frame → trap weakens.
 *   · Mis-orient a PBS upstream → ray intensities collapse → no force → bead
 *     drifts away with pure Brownian motion.
 *   · Block the laser wavelength with a filter → zero rays hit the bead → no
 *     trap.
 *
 * Each of these emerges from the same per-ray accumulation; nothing is
 * scripted or special-cased.
 */
export class TrappedBead extends OpticalComponent {
    private static readonly EXIT_NUDGE_MM = 1e-3;
    /** Sphere diameter in **mm**. Real beads are µm; we keep simulator units
     *  consistent (mm) and let `displayScale` exaggerate the dynamics so the
     *  bead is visible against an mm-scale optical bench. */
    diameter: number;
    /** Refractive index of the bead material (polystyrene ≈ 1.59). */
    iorBead: number;
    /** Refractive index of the suspending medium (water ≈ 1.33). */
    iorMedium: number;
    /** Stokes drag η in Pa·s (water ≈ 1e-3). */
    viscosity: number;
    /** Temperature in Kelvin (room temp ≈ 295). */
    temperatureK: number;
    /** Visibility scaling for the position update.  Real bead displacements
     *  in a working trap are nm-scale and invisible at mm world units;
     *  `displayScale` blows that up so the user can see the bead jitter and
     *  drift.  The PHYSICS (relative stiffness, escape thresholds, etc.) is
     *  unaffected — only the absolute displacement scale is amplified. */
    displayScale: number;
    /** Scale for direct ray momentum. Kept below 1 because the envelope
     *  gradient term below carries the trap stiffness. */
    rayMomentumScale: number;
    /** Multiplier for the physical bead-surface Fresnel reflection. */
    surfaceReflectionScale: number;
    /** Whether microscopic bead surface reflections should be drawn as table
     *  rays. Momentum still includes the Fresnel term either way. */
    showSurfaceReflectionRays: boolean;
    /** Whether escaped refracted post-bead rays should draw open table tails.
     *  Component-to-component segments are still visible so dumps and QPDs
     *  show the collected return beam, but uncollected bead scatter does not
     *  turn into long bench-wide lines. */
    showOutgoingRayVisualization: boolean;
    /** Scale for the beam-envelope gradient force accumulated from Beam field
     *  Gaussian segments. */
    gradientForceScale: number;
    /** Lateral capture radius around the optical focus. Outside this range the
     *  gradient trap cannot pull a bead back from arbitrary flow-cell positions. */
    trapCaptureRadius: number;
    /** Axial capture half-range around focus, in local optical-axis units. */
    trapAxialCaptureRange: number;
    /** Brownian motion multiplier; keep at 1 for physical room-temperature diffusion. */
    thermalMotionScale: number;
    /** Visible halo color. The core sphere still uses the physical bead radius. */
    glowColor: string;
    /** Viewer/table halo radius in mm, separate from the physical bead radius. */
    visualGlowRadius: number;
    /** Optional hard-wall flow-cell bounds for specimenOffset in local bead
     *  coordinates. When set, the bead can move and jitter, but it cannot
     *  drift through the sample chamber walls. */
    confinementHalfSize: Vector3 | null = null;
    /** Sample/flow-cell that owns this bead when it is managed as specimen
     *  state instead of a separate user-draggable component. */
    parentSampleId: string | null = null;

    /** Per-frame radiation-pressure force accumulator (world frame, mm-scaled
     *  units — we work in arbitrary units throughout; γ below uses the same
     *  scale).  Zeroed at the end of every integration step. */
    forceAccumulator: Vector3 = new Vector3(0, 0, 0);
    /** Number of ray hits accumulated this frame, for diagnostics. */
    hitsThisFrame: number = 0;
    /** Position of the bead's centre RELATIVE to the component's `position`.
     *  Mutated each frame by the integrator; the visualizer renders the bead
     *  at `position + specimenOffset`.  Storing the offset (not the absolute
     *  position) keeps the user's original placement intact while the bead
     *  drifts. */
    specimenOffset: Vector3 = new Vector3(0, 0, 0);
    /** Last-frame integration timestamp; the integrator computes dt itself
     *  from this so the bead is robust to variable frame rates. */
    private lastStepTimeMs: number | null = null;
    private smoothedLocalForce: Vector3 = new Vector3();

    constructor(
        diameter: number = 1.0,
        iorBead: number = 1.59,
        iorMedium: number = 1.33,
        name: string = 'Trapped Bead',
    ) {
        super(name);
        this.diameter = diameter;
        this.iorBead = iorBead;
        this.iorMedium = iorMedium;
        this.viscosity = 1e-3;       // water at ~20 °C, Pa·s
        this.temperatureK = 295;
        this.displayScale = 50;      // tuned so a 100-mW trap holds a bead in
                                     // a few-mm capture region; presets can
                                     // override
        this.rayMomentumScale = 0.02;
        this.surfaceReflectionScale = 1;
        this.showSurfaceReflectionRays = false;
        this.showOutgoingRayVisualization = false;
        this.gradientForceScale = 0.08;
        this.trapCaptureRadius = 0.02;
        this.trapAxialCaptureRange = 0.006;
        this.thermalMotionScale = 1;
        this.glowColor = '#007fff';
        this.visualGlowRadius = 0.012;
        // AABB encloses the entire range the bead might wander to under load.
        // 10 mm in each direction is plenty of room for the Brownian wiggle
        // before escape; if displayScale is cranked very high a preset can
        // resize this manually.
        const r = diameter / 2;
        const wander = 10;
        this.bounds = new Box3(
            new Vector3(-wander - r, -wander - r, -wander - r),
            new Vector3( wander + r,  wander + r,  wander + r),
        );
    }

    /** Sphere radius helper. */
    get radius(): number {
        return this.diameter / 2;
    }

    getConfinementLimit(): Vector3 | null {
        if (!this.confinementHalfSize) return null;
        const r = this.radius;
        return new Vector3(
            Math.max(0, this.confinementHalfSize.x - r),
            Math.max(0, this.confinementHalfSize.y - r),
            Math.max(0, this.confinementHalfSize.z - r),
        );
    }

    getConfinedSpecimenOffset(): Vector3 {
        const limit = this.getConfinementLimit();
        if (!limit) return this.specimenOffset.clone();
        return new Vector3(
            Math.max(-limit.x, Math.min(limit.x, this.specimenOffset.x)),
            Math.max(-limit.y, Math.min(limit.y, this.specimenOffset.y)),
            Math.max(-limit.z, Math.min(limit.z, this.specimenOffset.z)),
        );
    }

    constrainToFlowCell(): boolean {
        const confined = this.getConfinedSpecimenOffset();
        const changed = confined.distanceToSquared(this.specimenOffset) > 1e-18;
        if (changed) this.specimenOffset.copy(confined);
        return changed;
    }

    /**
     * Ray-sphere intersection in the bead's local frame, with the sphere
     * centre at `specimenOffset` (NOT the component origin) so the dynamic
     * displacement is honoured by the trace.
     */
    intersect(rayLocal: Ray): HitRecord | null {
        this.constrainToFlowCell();
        const c = this.specimenOffset;
        const r = this.radius;
        // Solve |o + t·d − c|² = r²
        const ox = rayLocal.origin.x - c.x;
        const oy = rayLocal.origin.y - c.y;
        const oz = rayLocal.origin.z - c.z;
        const dx = rayLocal.direction.x;
        const dy = rayLocal.direction.y;
        const dz = rayLocal.direction.z;
        const b = ox * dx + oy * dy + oz * dz;            // ½ × (2 o·d)
        const cc = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - cc;
        if (disc < 0) return null;
        const sq = Math.sqrt(disc);
        // Two intersections; take the nearest in front of the ray.  Epsilon
        // matches forward tracer's anti-self-intersection threshold.
        let t = -b - sq;
        if (t < 0.001) t = -b + sq;
        if (t < 0.001) return null;
        const point = rayLocal.origin.clone().add(rayLocal.direction.clone().multiplyScalar(t));
        const normal = point.clone().sub(c).normalize();  // outward
        return { t, point, normal, localPoint: point.clone(), localNormal: normal.clone() };
    }

    /**
     * Refract through the bead in one call: entry refraction, internal chord,
     * exit refraction.  Accumulates the total photon-momentum change as the
     * trap force.  Returns the single ray that emerges from the far side of
     * the sphere (or the reflected ray on TIR / grazing-angle absorption).
     */
    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Work entirely in the bead's local frame; transform back at the end.
        const localDirIn = ray.direction.clone().transformDirection(this.worldToLocal).normalize();
        const entryLocal = hit.localPoint!;
        const entryNormal = hit.localNormal!.clone().normalize();   // outward

        // Entry refraction (medium → bead).  `incidentNormal` faces the ray.
        const nEntry = entryNormal.clone();
        if (nEntry.dot(localDirIn) > 0) nEntry.negate();
        const dirInside = OpticMesh.refract(localDirIn, nEntry, this.iorMedium, this.iorBead);
        if (!dirInside) {
            // External TIR is rare for medium → bead (n2 > n1), but if it
            // happens we just reflect off the surface.  No force accumulated
            // beyond the simple reflection momentum change to keep the model
            // honest — this branch is mostly defensive.
            const reflectedWorld = reflectVector(ray.direction, hit.normal).normalize();
            const reflectedOrigin = hit.point.clone().addScaledVector(reflectedWorld, TrappedBead.EXIT_NUDGE_MM);
            this.accumulateMomentum(ray, ray.direction, reflectedWorld);
            return {
                rays: [childRay(ray, {
                    origin: reflectedOrigin,
                    direction: reflectedWorld,
                    intensity: ray.intensity,
                    opticalPathLength: ray.opticalPathLength + hit.t * this.iorMedium,
                })],
            };
        }

        // Internal chord: solve |entry + t·dirInside − sphereCenter|² = r²
        // for the FAR intersection.
        const c = this.specimenOffset;
        const r = this.radius;
        const oxI = entryLocal.x - c.x;
        const oyI = entryLocal.y - c.y;
        const ozI = entryLocal.z - c.z;
        const bI = oxI * dirInside.x + oyI * dirInside.y + ozI * dirInside.z;
        const ccI = oxI * oxI + oyI * oyI + ozI * ozI - r * r;
        const discI = bI * bI - ccI;
        if (discI < 0) {
            // Numerical edge case (entry point right at rim); just pass the
            // ray through unchanged with no force accumulation.
            const passDirection = ray.direction.clone().normalize();
            return { rays: [childRay(ray, {
                origin: hit.point.clone().addScaledVector(passDirection, TrappedBead.EXIT_NUDGE_MM),
                direction: passDirection,
                intensity: ray.intensity,
                opticalPathLength: ray.opticalPathLength + hit.t * this.iorMedium,
            })] };
        }
        const tExit = -bI + Math.sqrt(discI);   // far root
        const exitLocal = entryLocal.clone().add(dirInside.clone().multiplyScalar(tExit));
        const exitNormal = exitLocal.clone().sub(c).normalize();   // outward

        // Exit refraction (bead → medium).  `incidentNormal` faces the
        // internal ray, i.e. -outward (ray dotted with outward normal > 0).
        const nExit = exitNormal.clone();
        if (nExit.dot(dirInside) > 0) nExit.negate();
        const dirOutLocal = OpticMesh.refract(dirInside, nExit, this.iorBead, this.iorMedium);
        let dirOutWorld: Vector3;
        let exitedNormally = true;
        if (!dirOutLocal) {
            // Internal TIR at the exit surface.  In a real bead this would
            // bounce around inside until it leaks out; we approximate by
            // reflecting off the exit face and passing the ray on.  The
            // momentum change for THIS frame is just the entry refraction.
            const internalReflect = dirInside.clone().sub(
                exitNormal.clone().multiplyScalar(2 * dirInside.dot(exitNormal))
            ).normalize();
            dirOutWorld = internalReflect.transformDirection(this.localToWorld).normalize();
            exitedNormally = false;
        } else {
            dirOutWorld = dirOutLocal.transformDirection(this.localToWorld).normalize();
        }

        const reflectedEntryWorld = reflectVector(ray.direction, hit.normal).normalize();
        const fresnelR = this.entryReflectionFraction(localDirIn, entryNormal);
        const transmitFraction = Math.max(0, 1 - fresnelR);
        const weightedOut = dirOutWorld.clone().multiplyScalar(transmitFraction)
            .add(reflectedEntryWorld.clone().multiplyScalar(fresnelR));
        this.accumulateMomentumVector(ray, ray.direction, weightedOut);

        const exitWorld = exitLocal.clone().applyMatrix4(this.localToWorld);
        const exitOrigin = exitWorld.clone().addScaledVector(dirOutWorld, TrappedBead.EXIT_NUDGE_MM);
        const internalChord = tExit;
        const outRays: Ray[] = [];
        if (fresnelR > 1e-6) {
            outRays.push(childRay(ray, {
                origin: hit.point.clone().addScaledVector(reflectedEntryWorld, TrappedBead.EXIT_NUDGE_MM),
                direction: reflectedEntryWorld,
                intensity: ray.intensity * fresnelR,
                opticalPathLength: ray.opticalPathLength + hit.t * this.iorMedium,
                suppressVisualization: !this.showSurfaceReflectionRays,
            }));
        }
        outRays.push(childRay(ray, {
            origin: exitOrigin,
            direction: dirOutWorld,
            // Fresnel reflection at the entry surface removes that fraction
            // from the transmitted branch.
            intensity: ray.intensity * transmitFraction,
            opticalPathLength: ray.opticalPathLength
                + hit.t * this.iorMedium
                + internalChord * this.iorBead,
            // Mark the entry/exit so the visualizer can draw the internal
            // chord nicely if it wants to (currently unused but cheap).
            entryPoint: hit.point.clone(),
            terminationPoint: exitedNormally ? undefined : exitWorld.clone(),
            suppressOpenTail: !this.showOutgoingRayVisualization && ray.isMainRay !== true,
        }));
        return {
            rays: outRays,
        };
    }

    /**
     * Add one ray's photon-momentum change to this frame's force accumulator.
     * `dirIn` and `dirOut` are unit vectors in the WORLD frame.
     */
    private accumulateMomentum(ray: Ray, dirIn: Vector3, dirOut: Vector3): void {
        this.accumulateMomentumVector(ray, dirIn, dirOut);
    }

    private accumulateMomentumVector(ray: Ray, dirIn: Vector3, weightedOut: Vector3): void {
        // (n_medium · I / c) · (d_in − d_out).  The 1/c (c = 3e8 m/s) makes
        // the absolute force tiny in real units; we fold a single global gain
        // into `displayScale` later, so here we use a normalised coefficient
        // that keeps the per-ray contribution numerically meaningful.
        const coeff = this.iorMedium * Math.max(0, ray.intensity) * this.rayMomentumScale;
        if (coeff <= 0) return;
        this.forceAccumulator.x += coeff * (dirIn.x - weightedOut.x);
        this.forceAccumulator.y += coeff * (dirIn.y - weightedOut.y);
        this.forceAccumulator.z += coeff * (dirIn.z - weightedOut.z);
        this.hitsThisFrame += 1;
    }

    private entryReflectionFraction(localDirIn: Vector3, outwardNormal: Vector3): number {
        if (this.surfaceReflectionScale <= 0) return 0;
        const cosI = Math.max(0, Math.min(1, Math.abs(localDirIn.dot(outwardNormal))));
        const r0 = Math.pow((this.iorMedium - this.iorBead) / (this.iorMedium + this.iorBead), 2);
        const schlick = r0 + (1 - r0) * Math.pow(1 - cosI, 5);
        return Math.max(0, Math.min(0.25, schlick * this.surfaceReflectionScale));
    }

    /**
     * Add a dipole-gradient force from the traced Gaussian beam envelope.
     * Direct ray hits alone miss the usual optical-tweezers behaviour when the
     * bead starts slightly off-axis; the bead should feel the gradient of the
     * focused field even before a traced centerline intersects the sphere.
     */
    accumulateGradientTrapForce(beamSegments: GaussianBeamSegment[][]): void {
        this.constrainToFlowCell();
        const captureWeight = this.trapCaptureWeight();
        if (captureWeight <= 0) return;
        const trapBranches: GaussianBeamSegment[][] = [];
        for (const branch of beamSegments) {
            const first = branch[0];
            if (!first || first.coherenceMode !== Coherence.Coherent || first.power <= 1e-12) {
                continue;
            }

            const incidentBranch: GaussianBeamSegment[] = [];
            for (const segment of branch) {
                const key = segment.bundleKey ?? '';
                const touchesThisBead = key.includes(this.id);
                if (touchesThisBead && key.includes('|glass|')) break;
                incidentBranch.push(segment);
                if (touchesThisBead) break;
            }
            if (incidentBranch.length > 0) trapBranches.push(incidentBranch);
        }
        if (trapBranches.length === 0) return;

        this.updateMatrices();
        const center = this.specimenOffset.clone().applyMatrix4(this.localToWorld);
        // Query the beam envelope over a bead-scale probe radius. Sampling too
        // close to the center lets the discrete ray/beamlet caustic dominate
        // the finite difference and can flip the apparent gradient between
        // neighboring beamlets; a finite bead responds to the smoothed field
        // across its own volume.
        const step = Math.max(this.radius * 2, 0.0025);
        const intensityAt = (x: number, y: number, z: number) => {
            let total = 0;
            for (const branch of trapBranches) {
                total += BeamField.queryIntensity(x, y, z, branch)?.intensity ?? 0;
            }
            return total;
        };

        const dx =
            (intensityAt(center.x + step, center.y, center.z) -
                intensityAt(center.x - step, center.y, center.z)) /
            (2 * step);
        const dy =
            (intensityAt(center.x, center.y + step, center.z) -
                intensityAt(center.x, center.y - step, center.z)) /
            (2 * step);
        const dz =
            (intensityAt(center.x, center.y, center.z + step) -
                intensityAt(center.x, center.y, center.z - step)) /
            (2 * step);

        const relativeIndex = this.iorBead / Math.max(1e-6, this.iorMedium);
        const indexTerm =
            (relativeIndex * relativeIndex - 1) / (relativeIndex * relativeIndex + 2);
        const polarizabilityScale =
            Math.max(0, indexTerm) * ((4 * Math.PI * this.radius * this.radius * this.radius) / 3);
        if (polarizabilityScale <= 0) return;

        this.forceAccumulator.add(
            new Vector3(dx, dy, dz).multiplyScalar(this.gradientForceScale * polarizabilityScale * captureWeight),
        );
    }

    private trapCaptureWeight(): number {
        const lateralLimit = Math.max(this.trapCaptureRadius, 0);
        const axialLimit = Math.max(this.trapAxialCaptureRange, 0);
        if (lateralLimit <= 0 && axialLimit <= 0) return 1;

        const offset = this.specimenOffset;
        const lateral = lateralLimit > 0 ? Math.hypot(offset.x, offset.y) / lateralLimit : 0;
        const axial = axialLimit > 0 ? Math.abs(offset.z) / axialLimit : 0;
        const normalized = Math.max(lateral, axial);
        if (normalized >= 1) return 0;
        if (normalized <= 0.65) return 1;
        const t = (1 - normalized) / 0.35;
        return t * t * (3 - 2 * t);
    }

    /**
     * Drive one integrator step.  Called from OpticalTable's per-frame loop
     * AFTER forward tracer finishes its trace, so `forceAccumulator` already holds
     * every ray contribution for this frame.
     *
     * Overdamped Langevin in the world frame:
     *
     *     γ · ẋ  =  F_optical + √(2 k_B T γ / dt) · η          (η ~ N(0, 1))
     *
     * Position update: x(t + dt) = x(t) + ẋ · dt.  No inertia term — beads in
     * water at room temperature relax their momentum on µs timescales, far
     * faster than the simulator's frame budget, so an overdamped solver is
     * the right asymptotic limit.
     *
     * Returns true if the bead actually moved this step. Motion is dynamic
     * state, not an optical layout edit; callers should redraw the bead, but
     * should not treat it as a component-version change that invalidates the
     * whole forward trace every frame.
     */
    applyForceStep(nowMs: number): boolean {
        const lastMs = this.lastStepTimeMs;
        this.lastStepTimeMs = nowMs;
        if (lastMs === null) {
            // First frame — nothing to integrate against, but still snap any
            // loaded/stale bead state back inside the flow cell.
            const clamped = this.constrainToFlowCell();
            this.resetAccumulator();
            return clamped;
        }
        const dt = Math.max(1e-4, Math.min(0.1, (nowMs - lastMs) / 1000));
        // Stokes drag: γ = 6π η R.  Using mm for R keeps γ in whatever-units
        // matches our intensity scaling; the physics is in the RATIOS (γ/F)
        // rather than absolute SI values, which is fine for a pedagogical
        // demo.  Larger beads are harder to push, smaller ones are easier —
        // that's the relationship that has to be right and it is.
        const r = this.radius;
        const gamma = 6 * Math.PI * this.viscosity * r;
        const safeGamma = Math.max(gamma, 1e-9);

        // Brownian displacement per axis in mm:
        //   σ = sqrt(2 kBT dt / γ), with γ = 6πηr in SI units.
        // Keep thermal diffusion in real units instead of mixing it into the
        // arbitrary optical-force scale; otherwise micron-sized beads jump
        // millimeters per frame and appear to leave the flow cell.
        const radiusMeters = Math.max(this.radius * 1e-3, 1e-12);
        const gammaSI = 6 * Math.PI * this.viscosity * radiusMeters;
        const kBTsi = 1.380649e-23 * this.temperatureK;
        const brownianSigmaMm = Math.sqrt(Math.max(0, 2 * kBTsi * dt / gammaSI)) * 1e3 * this.thermalMotionScale;
        const brownianX = brownianSigmaMm * gaussianRandom();
        const brownianY = brownianSigmaMm * gaussianRandom();
        const brownianZ = brownianSigmaMm * gaussianRandom();

        // Force was accumulated in world frame (because dirIn / dirOut in
        // `interact` are world vectors), but specimenOffset lives in the
        // bead's LOCAL frame.  Transform the world force into the local
        // frame as a direction vector before integrating, so a bead placed
        // with `pointAlong(1, 0, 0)` doesn't visibly drift along the wrong
        // axis. Brownian noise is independent and added in local frame.
        this.updateMatrices();
        const worldForce = new Vector3(
            this.forceAccumulator.x,
            this.forceAccumulator.y,
            this.forceAccumulator.z,
        );
        const localForce = worldForce.clone().transformDirection(this.worldToLocal);
        // `transformDirection` normalises, but we need the magnitude to
        // survive — recompose by scaling by the original force magnitude.
        const fmag = worldForce.length();
        if (fmag > 0) localForce.multiplyScalar(fmag);
        if (fmag <= 1e-15) {
            this.smoothedLocalForce.set(0, 0, 0);
        } else {
            this.smoothedLocalForce.multiplyScalar(0.65).addScaledVector(localForce, 0.35);
        }
        const fx = this.smoothedLocalForce.x;
        const fy = this.smoothedLocalForce.y;
        const fz = this.smoothedLocalForce.z;
        // dx = F · dt / γ, blown up by displayScale so the visible drift is
        // legible at mm-world scale.
        const k = (dt / safeGamma) * this.displayScale;
        const opticalStep = new Vector3(fx * k, fy * k, fz * k);
        this.limitOpticalStep(opticalStep);
        const stepX = opticalStep.x + brownianX;
        const stepY = opticalStep.y + brownianY;
        const stepZ = opticalStep.z + brownianZ;
        const movedSq = stepX * stepX + stepY * stepY + stepZ * stepZ;
        // Cap per-step displacement to one bead radius so a transient huge
        // force from numerical edge cases can't yeet the bead off-screen.
        const maxStep = r;
        if (movedSq > maxStep * maxStep) {
            const len = Math.sqrt(movedSq);
            const scale = maxStep / len;
            this.specimenOffset.x += stepX * scale;
            this.specimenOffset.y += stepY * scale;
            this.specimenOffset.z += stepZ * scale;
        } else {
            this.specimenOffset.x += stepX;
            this.specimenOffset.y += stepY;
            this.specimenOffset.z += stepZ;
        }
        const clamped = this.constrainToFlowCell();

        this.resetAccumulator();
        return movedSq > 1e-12 || clamped;
    }

    /** Zero the per-frame accumulator without integrating.  Used on bead
     *  reset and as the tail of `applyForceStep`. */
    resetAccumulator(): void {
        this.forceAccumulator.set(0, 0, 0);
        this.hitsThisFrame = 0;
    }

    pauseIntegrator(): void {
        this.lastStepTimeMs = null;
        this.resetAccumulator();
    }

    private limitOpticalStep(step: Vector3): void {
        const maxStep = Math.max(this.radius * 0.35, 0.00025);
        const len = step.length();
        if (len > maxStep) step.multiplyScalar(maxStep / len);

        const offsetLen = this.specimenOffset.length();
        if (offsetLen <= 1e-9) return;
        const towardFocus = step.dot(this.specimenOffset) < 0;
        if (!towardFocus) return;
        const maxTowardStep = offsetLen * 0.45;
        const limitedLen = step.length();
        if (limitedLen > maxTowardStep) step.multiplyScalar(maxTowardStep / limitedLen);
    }

}

/** Box-Muller standard-normal sample. */
function gaussianRandom(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
