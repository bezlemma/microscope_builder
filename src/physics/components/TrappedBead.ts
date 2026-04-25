import { Vector3, Box3 } from 'three';
import { OpticalComponent } from '../Component';
import { Ray, HitRecord, InteractionResult, childRay, Coherence } from '../types';
import { OpticMesh } from '../OpticMesh';
import { reflectVector } from '../math_solvers';
import { Solver2, type GaussianBeamSegment } from '../Solver2';

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
 * 1. During Solver 1's forward trace, every ray that enters the bead causes a
 *    single `interact()` call.  We trace the ray's full chord through the
 *    sphere (refract at entry → straight line inside → refract at exit) in
 *    one shot and add the photon-momentum change
 *
 *        Δp = (n_medium · I_ray / c) · (d_in − d_out)
 *
 *    to `forceAccumulator`.  Because Solver 1 calls `interact()` once per ray
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
    /** Scale for the beam-envelope gradient force accumulated from Solver 2
     *  Gaussian segments. */
    gradientForceScale: number;

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
        this.gradientForceScale = 0.08;
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

    /**
     * Ray-sphere intersection in the bead's local frame, with the sphere
     * centre at `specimenOffset` (NOT the component origin) so the dynamic
     * displacement is honoured by the trace.
     */
    intersect(rayLocal: Ray): HitRecord | null {
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
        // matches Solver 1's anti-self-intersection threshold.
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
            this.accumulateMomentum(ray, ray.direction, reflectedWorld);
            return {
                rays: [childRay(ray, {
                    origin: hit.point,
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
            return { rays: [childRay(ray, {
                origin: hit.point,
                direction: ray.direction.clone(),
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

        // Total per-ray momentum change (Newton 3rd law on the bead):
        //   Δp = (n_medium · I / c) · (d_in − d_out)
        // We absorb the constant (n_medium / c) into a single per-ray
        // coefficient inside accumulateMomentum.  When the exit was a TIR,
        // d_out ≠ the original ray's eventual direction, but for the demo
        // the entry-refraction contribution dominates and we accept the
        // small error.
        this.accumulateMomentum(ray, ray.direction, dirOutWorld);

        const exitWorld = exitLocal.clone().applyMatrix4(this.localToWorld);
        const internalChord = tExit;
        return {
            rays: [childRay(ray, {
                origin: exitWorld,
                direction: dirOutWorld,
                // No Fresnel-driven intensity loss in this first cut — we'd
                // double-count the radiation pressure if we attenuated rays
                // here, since the per-ray Δp already accounts for the full
                // momentum transfer of an intensity-I beam through the sphere.
                intensity: ray.intensity,
                opticalPathLength: ray.opticalPathLength
                    + hit.t * this.iorMedium
                    + internalChord * this.iorBead,
                // Mark the entry/exit so the visualizer can draw the internal
                // chord nicely if it wants to (currently unused but cheap).
                entryPoint: hit.point.clone(),
                terminationPoint: exitedNormally ? undefined : exitWorld.clone(),
            })],
        };
    }

    /**
     * Add one ray's photon-momentum change to this frame's force accumulator.
     * `dirIn` and `dirOut` are unit vectors in the WORLD frame.
     */
    private accumulateMomentum(ray: Ray, dirIn: Vector3, dirOut: Vector3): void {
        // (n_medium · I / c) · (d_in − d_out).  The 1/c (c = 3e8 m/s) makes
        // the absolute force tiny in real units; we fold a single global gain
        // into `displayScale` later, so here we use a normalised coefficient
        // that keeps the per-ray contribution numerically meaningful.
        const coeff = this.iorMedium * Math.max(0, ray.intensity) * this.rayMomentumScale;
        if (coeff <= 0) return;
        this.forceAccumulator.x += coeff * (dirIn.x - dirOut.x);
        this.forceAccumulator.y += coeff * (dirIn.y - dirOut.y);
        this.forceAccumulator.z += coeff * (dirIn.z - dirOut.z);
        this.hitsThisFrame += 1;
    }

    /**
     * Add a dipole-gradient force from the traced Gaussian beam envelope.
     * Direct ray hits alone miss the usual optical-tweezers behaviour when the
     * bead starts slightly off-axis; the bead should feel the gradient of the
     * focused field even before a traced centerline intersects the sphere.
     */
    accumulateGradientTrapForce(beamSegments: GaussianBeamSegment[][]): void {
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
        const step = Math.max(this.radius * 0.75, 0.15);
        const intensityAt = (x: number, y: number, z: number) => {
            let total = 0;
            for (const branch of trapBranches) {
                total += Solver2.queryIntensity(x, y, z, branch)?.intensity ?? 0;
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
            new Vector3(dx, dy, dz).multiplyScalar(this.gradientForceScale * polarizabilityScale),
        );
    }

    /**
     * Drive one integrator step.  Called from OpticalTable's per-frame loop
     * AFTER Solver 1 finishes its trace, so `forceAccumulator` already holds
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
     * Returns true if the bead actually moved this step (so the caller can
     * decide whether to bump `version` and trigger a re-trace).
     */
    applyForceStep(nowMs: number): boolean {
        const lastMs = this.lastStepTimeMs;
        this.lastStepTimeMs = nowMs;
        if (lastMs === null) {
            // First frame — nothing to integrate against.
            this.resetAccumulator();
            return false;
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

        // Brownian kick magnitude per axis: σ = √(2 k_B T γ / dt).  We use a
        // dimensionless k_B T scaled to the simulator's intensity units; the
        // user can effectively tune trap depth by changing temperatureK.
        const kBT = this.temperatureK * 1.38e-5;   // arbitrary-units scaling
        const sigma = Math.sqrt(Math.max(0, 2 * kBT * safeGamma / dt));
        const brownianX = sigma * gaussianRandom();
        const brownianY = sigma * gaussianRandom();
        const brownianZ = sigma * gaussianRandom();

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
        const fx = localForce.x + brownianX;
        const fy = localForce.y + brownianY;
        const fz = localForce.z + brownianZ;
        // dx = F · dt / γ, blown up by displayScale so the visible drift is
        // legible at mm-world scale.
        const k = (dt / safeGamma) * this.displayScale;
        const dxX = fx * k;
        const dxY = fy * k;
        const dxZ = fz * k;
        const movedSq = dxX * dxX + dxY * dxY + dxZ * dxZ;
        // Cap per-step displacement to one bead radius so a transient huge
        // force from numerical edge cases can't yeet the bead off-screen.
        const maxStep = r * 2;
        if (movedSq > maxStep * maxStep) {
            const len = Math.sqrt(movedSq);
            const scale = maxStep / len;
            this.specimenOffset.x += dxX * scale;
            this.specimenOffset.y += dxY * scale;
            this.specimenOffset.z += dxZ * scale;
        } else {
            this.specimenOffset.x += dxX;
            this.specimenOffset.y += dxY;
            this.specimenOffset.z += dxZ;
        }

        this.resetAccumulator();
        const moved = movedSq > 1e-12;
        if (moved) this.version += 1;
        return moved;
    }

    /** Zero the per-frame accumulator without integrating.  Used on bead
     *  reset and as the tail of `applyForceStep`. */
    resetAccumulator(): void {
        this.forceAccumulator.set(0, 0, 0);
        this.hitsThisFrame = 0;
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
