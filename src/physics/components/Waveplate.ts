import { OpticalComponent } from '../Component';
import {
    Ray, HitRecord, InteractionResult, Complex,
    childRay, jonesFromBasis, jonesProject,
} from '../types';
import { Vector3, Box3 } from 'three';
import { OpticMesh } from '../OpticMesh';

export type WaveplateMode = 'half' | 'quarter' | 'polarizer';

/**
 * Waveplate / Polarizer component — modeled as a real birefringent slab.
 *
 * Component-local frame uses the engine's UVW convention (ENGINE.md §1):
 *   U, V = transverse plane (the slab face)
 *   W    = optical axis (slab normal); slab faces sit at W = ±thickness/2
 *
 * The fast axis lies in the U-V plane at angle `fastAxisAngle` measured from
 * local +U. The slab is a uniaxial birefringent medium whose optic axis is the
 * fast axis. We model it with a single bulk refractive index for ray bending
 * (small Δn between o and e doesn't visibly bend rays), and apply the
 * fast/slow retardation as a phase difference accumulated along the **actual
 * path length the ray travels through the slab** — not as a normal-incidence
 * Jones matrix evaluated at z = 0.
 *
 * What's modelled:
 *   - Snell refraction at both faces.
 *   - Path-length-dependent retardation: φ = φ_design · (L_internal / thickness)
 *     · (λ_design / λ_actual). At normal incidence and the design wavelength
 *     this reduces to the textbook φ_design (π for HWP, π/2 for QWP).
 *   - The fast/slow basis is built in the ray's actual transverse plane inside
 *     the slab, projected from the slab's fixed fast-axis direction.
 *
 * What's NOT modelled (would be the next step if you want full anisotropic
 * ray tracing):
 *   - Ordinary/extraordinary ray *splitting*: the o and e rays refract at
 *     slightly different angles. With Δn ≈ 0.009 for quartz, the angular
 *     split is < 0.5° and the walk-off across a 2 mm slab is microns —
 *     negligible for visualization but real physics.
 *   - Direction-dependent extraordinary index n_e(angle).
 *
 * The convention is "slow axis sees the extra phase": for a HWP at design,
 * the slow component picks up π relative to the fast, giving the canonical
 * E_fast → E_fast, E_slow → −E_slow. Same convention as the textbook Jones
 * matrix `diag(1, −1)`.
 */
export class Waveplate extends OpticalComponent {
    waveplateMode: WaveplateMode;
    /** Angle of the fast axis in the local U-V plane, measured from +U (rad). */
    fastAxisAngle: number;
    apertureRadius: number; // mm

    /** Physical slab thickness along W (mm). */
    thickness: number = 2;
    /** Bulk refractive index used for ray bending at the slab faces. */
    bulkIndex: number = 1.55;
    /** Wavelength at which the design retardation (π for HWP, π/2 for QWP)
     *  is achieved at normal incidence. Off-design wavelengths scale by 1/λ. */
    designWavelengthNm: number = 532;

    constructor(
        mode: WaveplateMode = 'half',
        apertureRadius: number = 12.5,
        fastAxisAngle: number = 0,
        name?: string,
        designWavelengthNm: number = 532,
    ) {
        const defaultNames: Record<WaveplateMode, string> = {
            'half': 'λ/2 Plate',
            'quarter': 'λ/4 Plate',
            'polarizer': 'Linear Polarizer',
        };
        super(name ?? defaultNames[mode]);
        this.waveplateMode = mode;
        this.apertureRadius = apertureRadius;
        this.fastAxisAngle = fastAxisAngle;
        this.designWavelengthNm = designWavelengthNm;

        const halfW = this.thickness / 2;
        const r = this.apertureRadius;
        this.bounds = new Box3(
            new Vector3(-r, -r, -halfW),
            new Vector3(r, r, halfW),
        );
    }

    /** Find which of the two W = ±t/2 faces the ray hits first. Either face
     *  is valid both for entering and exiting; `interact` traces the full
     *  slab traversal from whichever face we caught here. */
    intersect(rayLocal: Ray): HitRecord | null {
        const dW = rayLocal.direction.z;
        if (Math.abs(dW) < 1e-6) return null;
        const halfW = this.thickness / 2;
        const r2 = this.apertureRadius * this.apertureRadius;

        let bestT = Infinity;
        let bestHit: HitRecord | null = null;
        for (const planeW of [-halfW, halfW]) {
            const t = (planeW - rayLocal.origin.z) / dW;
            if (t < 0.001 || t >= bestT) continue;
            const point = rayLocal.origin.clone().addScaledVector(rayLocal.direction, t);
            if (point.x * point.x + point.y * point.y > r2) continue;
            bestT = t;
            // Outward normal at this face — points away from the slab interior.
            const outward = new Vector3(0, 0, planeW > 0 ? 1 : -1);
            bestHit = {
                t,
                point,
                normal: outward,
                localPoint: point.clone(),
            };
        }
        return bestHit;
    }

    interact(ray: Ray, hit: HitRecord): InteractionResult {
        // Stay in local coordinates as long as possible. The component framework
        // already cached the ray's local direction on `hit.localDirection` and
        // the face's outward normal as `hit.localNormal`.
        const dirIn = (hit.localDirection?.clone()
            ?? ray.direction.clone().transformDirection(this.worldToLocal))
            .normalize();
        const entryPoint = hit.localPoint!.clone();
        // Outward face normal in local coords. The intersect() helper returns
        // it pointing along +W or −W depending on which face was hit.
        const faceNormal = (hit.localNormal?.clone() ?? new Vector3(0, 0, hit.normal.z >= 0 ? 1 : -1)).normalize();

        // For Snell.refract the surface normal must point AGAINST the incoming
        // ray. faceNormal points outward; if it agrees with dirIn we flip.
        const entryNormalAgainst = (dirIn.dot(faceNormal) > 0)
            ? faceNormal.clone().negate()
            : faceNormal.clone();

        // ── 1) Refract at the entry face: air (n=1) → slab (n=bulkIndex)
        const n1 = 1.0;
        const n2 = this.bulkIndex;
        const dirInside = OpticMesh.refract(dirIn, entryNormalAgainst, n1, n2);
        if (!dirInside) {
            // TIR on entry from air → glass shouldn't physically happen for
            // n2 > n1; treat as a sanity-failure absorbtion.
            return { rays: [] };
        }

        // ── 2) Geometrically intersect the refracted ray with the OPPOSITE
        //       face of the slab. Entry face was at W = ±t/2; exit face is at
        //       W = ∓t/2.
        const halfW = this.thickness / 2;
        const exitFaceW = (entryPoint.z >= 0) ? -halfW : halfW;
        const dWInside = dirInside.z;
        if (Math.abs(dWInside) < 1e-9) {
            // Ray inside the slab is travelling parallel to the faces — should
            // be physically impossible because Snell refraction never produces
            // a 90° internal angle from a non-90° external angle. Abort safely.
            return { rays: [] };
        }
        const tInside = (exitFaceW - entryPoint.z) / dWInside;
        if (tInside <= 0) {
            // Numerical edge case; ignore.
            return { rays: [] };
        }
        const exitPoint = entryPoint.clone().addScaledVector(dirInside, tInside);

        // ── 3) Aperture check at the exit. Rays that would exit through the
        //       side of the slab fall outside the clear aperture and are
        //       absorbed by the mount.
        const exitR2 = exitPoint.x * exitPoint.x + exitPoint.y * exitPoint.y;
        if (exitR2 > this.apertureRadius * this.apertureRadius) {
            return { rays: [] };
        }

        // ── 4) Refract at the exit face: slab (n=bulkIndex) → air (n=1).
        const exitFaceNormalOutward = new Vector3(0, 0, exitFaceW > 0 ? 1 : -1);
        // refract() wants the normal against the incoming side of the surface.
        // Inside the slab, the ray approaches the exit face moving toward +W
        // (or −W) and the outward face normal points the same way → flip.
        const exitNormalAgainst = (dirInside.dot(exitFaceNormalOutward) > 0)
            ? exitFaceNormalOutward.clone().negate()
            : exitFaceNormalOutward.clone();
        const dirOut = OpticMesh.refract(dirInside, exitNormalAgainst, n2, n1);
        if (!dirOut) {
            // Total internal reflection at the exit. Rare for thin
            // waveplates and a useful failure to surface — treat as absorbed
            // so the bench-view shows the ray terminating inside the slab.
            return { rays: [] };
        }

        // ── 5) Build the fast/slow polarization basis. The fast axis lies in
        //       local U-V at angle `fastAxisAngle` from +U:
        //
        //          fHat_local = (cos θ, sin θ, 0)
        //
        //       …but the *ray's* transverse plane (perpendicular to dirInside)
        //       is slightly tilted relative to U-V for oblique incidence. The
        //       physically correct fast axis is the projection of fHat into
        //       the ray's transverse plane.
        const cosA = Math.cos(this.fastAxisAngle);
        const sinA = Math.sin(this.fastAxisAngle);
        const fHatLocal = new Vector3(cosA, sinA, 0);
        const fastInside = fHatLocal.clone()
            .addScaledVector(dirInside, -fHatLocal.dot(dirInside))
            .normalize();
        const slowInside = new Vector3().crossVectors(dirInside, fastInside).normalize();

        // Same basis but built around the OUTGOING ray direction — the field
        // we hand back to Solver 1 must be transverse to dirOut.
        const fastOutside = fHatLocal.clone()
            .addScaledVector(dirOut, -fHatLocal.dot(dirOut))
            .normalize();
        const slowOutside = new Vector3().crossVectors(dirOut, fastOutside).normalize();

        // Express the local basis vectors in world coords for projecting and
        // rebuilding the world-frame Jones vector.
        this.updateMatrices();
        const fastInsideWorld = fastInside.clone().transformDirection(this.localToWorld);
        const slowInsideWorld = slowInside.clone().transformDirection(this.localToWorld);
        const fastOutsideWorld = fastOutside.clone().transformDirection(this.localToWorld);
        const slowOutsideWorld = slowOutside.clone().transformDirection(this.localToWorld);

        // ── 6) Decompose the incoming world-frame E-field onto (fast, slow)
        //       inside the slab. (This is also where any longitudinal piece
        //       gets ignored, because the projection is onto two transverse
        //       basis vectors only.)
        const Ef: Complex = jonesProject(ray.polarization, fastInsideWorld);
        const Es: Complex = jonesProject(ray.polarization, slowInsideWorld);

        // ── 7) Apply the retardation. The slow axis picks up extra phase φ
        //       relative to the fast. φ scales linearly with the actual path
        //       length inside the slab and inversely with wavelength.
        const lambdaActualNm = ray.wavelength * 1e9;
        const wavelengthScale = lambdaActualNm > 0 ? (this.designWavelengthNm / lambdaActualNm) : 1;
        const pathScale = tInside / this.thickness;
        const designRetardation = this.designRetardation();

        let EfOut: Complex;
        let EsOut: Complex;
        let throughput = 1;

        if (this.waveplateMode === 'polarizer') {
            // Ideal linear polarizer: keep only the fast-axis component,
            // attenuate by the projection's magnitude squared. Output Jones
            // is the unit vector along the fast (transmission) axis — we
            // encode the amplitude loss in `intensity`, not the Jones magnitude.
            const inPow = Ef.re * Ef.re + Ef.im * Ef.im + Es.re * Es.re + Es.im * Es.im;
            const outPow = Ef.re * Ef.re + Ef.im * Ef.im;
            throughput = inPow > 0 ? outPow / inPow : 0;
            EfOut = { re: 1, im: 0 };
            EsOut = { re: 0, im: 0 };
        } else {
            const phi = designRetardation * pathScale * wavelengthScale;
            const cosP = Math.cos(phi);
            const sinP = Math.sin(phi);
            // diag(1, e^{iφ}) — slow gets the extra phase.
            EfOut = Ef;
            EsOut = {
                re: Es.re * cosP - Es.im * sinP,
                im: Es.re * sinP + Es.im * cosP,
            };
        }

        // ── 8) Rebuild the world-frame Jones vector using the OUTGOING ray's
        //       transverse basis (fast/slow rotated to be perpendicular to dirOut).
        const polarizationWorld = jonesFromBasis(EfOut, fastOutsideWorld, EsOut, slowOutsideWorld);

        // ── 9) Optical path length: extra geometric length to the entry face
        //       (hit.t, already in world units), plus the optical path inside
        //       the slab (geometric path × bulk index).
        const exitPointWorld = exitPoint.clone().applyMatrix4(this.localToWorld);
        const dirOutWorld = dirOut.clone().transformDirection(this.localToWorld).normalize();
        const opl = ray.opticalPathLength + hit.t + tInside * this.bulkIndex;

        return {
            rays: [childRay(ray, {
                origin: exitPointWorld,
                direction: dirOutWorld,
                polarization: polarizationWorld,
                intensity: ray.intensity * throughput,
                opticalPathLength: opl,
                entryPoint: hit.point.clone(),
            })],
        };
    }

    private designRetardation(): number {
        switch (this.waveplateMode) {
            case 'half':    return Math.PI;
            case 'quarter': return Math.PI / 2;
            case 'polarizer': return 0; // unused
        }
    }

    getApertureRadius(): number {
        return this.apertureRadius;
    }
}
