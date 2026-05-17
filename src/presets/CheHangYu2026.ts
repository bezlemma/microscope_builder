import { Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Waveplate } from '../physics/components/Waveplate';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Card } from '../physics/components/Card';
import { AnimationChannel, generateChannelId } from '../physics/PropertyAnimator';
import type { PresetResult } from '../state/store';

/**
 * Yu et al., Optica 13(3):409 (March 2026):
 *   "Non-inertial scan angle multiplier for expanded fields-of-view"
 *
 * A minimal scene to *demonstrate the trick*. The paper's central idea is
 * that the same resonant scan mirror is hit **twice** in one beam path,
 * doubling the optical scan angle (±5° → ±10°) without paying for a bigger
 * or slower mirror.
 *
 * Beam path:
 *   Laser → PBS (S→reflect) → resonant scanner (1st bounce) → scan lens 1
 *      → λ/4 → scan lens 2 → slow galvo (retroreflects + slow-axis tilt)
 *      → back through λ/4 → scan lens 1 → resonant scanner (2nd bounce,
 *        doubled angle) → PBS (P→transmit) → viewing card.
 *
 * The viewing card at the PBS exit catches the *doubled* scan line. The
 * "Polarization View" toggle in the inspector makes the trick legible:
 * the S-polarized entry beam, the circularly-polarized doubler arm, and
 * the P-polarized doubled exit all show up as distinct colors.
 *
 * The full two-photon imaging arm and PMT collection optics from the
 * paper are intentionally omitted to keep the demo focused.
 */
export function createCheHangYu2026Scene(): PresetResult {
    const scene: OpticalComponent[] = [];

    // Geometry — top-down view, all components on z = 0.
    // Vertical column at x = 20 carries laser, PBS, and the viewing card.
    // Horizontal arm at y = yArm carries the angle-doubling 4-f relay.
    const xCol = 20;
    const yJunction = -12;
    const yArm = 36;
    const fScan = 54;       // mm — LSM54-1050 effective focal length

    // ── Laser ──
    // 1040 nm two-photon excitation source — matches the wavelength range the
    // paper's imaging arm runs at (Mai-Tai / InSight class systems for deeper
    // tissue). This preset launches world +Z polarization (laser setting 0°),
    // which is S-polarized for the 45° PBS in the XY plane → reflects upward
    // into the doubler arm. Sits a short way off the PBS so the housing
    // doesn't visually dwarf the rest of the unit. The laser wavelength is
    // NIR, so the wavelength-based ray color is essentially invisible — in
    // Polarization View the only thing the beam color reflects is the
    // polarization state, which is the whole point of the demo.
    const laser = new Laser('1040 nm 2P laser');
    laser.setPosition(-50, yJunction, 0);
    laser.pointAlong(1, 0, 0);
    laser.wavelength = 1040;
    laser.beamRadius = 2.5;
    laser.power = 1.0;
    laser.polarizationAngle = 0;
    scene.push(laser);

    // ── PBS at the junction ──
    // S-pol reflects up into the doubler; P-pol returning from the doubler
    // transmits straight down to the viewing card. Oversized 90 mm aperture
    // (much larger than a catalog PBS optic) so the doubled-scan exit
    // at the full ±5° mechanical resonant extreme — which leaves the second
    // mirror bounce at 4·5° = 20° optical and hits the PBS face at ~14 mm
    // off-center — has obvious visual margin to the rim. The actual coating
    // surface is a 45° internal plane; an undersized aperture made the
    // demo's beam look like it was grazing the edge.
    const pbs = new PolarizingBeamSplitter(90, 2, 'PBS513 (S→up, P→down)');
    pbs.setPosition(xCol, yJunction, 0);
    // n = normalize(d_in − d_out) = normalize((+1,0,0) − (0,+1,0))
    pbs.pointAlong(1, -1, 0);
    scene.push(pbs);

    // ═══ ANGLE-DOUBLING ARM (top of the unit) ════════════════════════════
    // Apertures are oversized vs. the real hardware so the demo doesn't
    // clip at the dramatic ±5° mechanical scan amplitude we crank to below.
    // Resonant scan mirror — gets hit twice. A real CRS is a single-axis
    // resonant galvo, so we model it as a plain flat mirror whose normal
    // pans in the table plane (animated via panAngle below). We use
    // reflectAt() rather than setPosition+pointAlong directly so the
    // front-surface (the reflective coating) lands exactly on the pivot we
    // care about — at (xCol, yArm, 0). Doing it the naive way puts the
    // mirror's *center* there, which would offset the surface by
    // thickness/2 ≈ 1.4 mm along the normal and walk the beam off-axis at
    // the scan lenses.
    const resonant = new Mirror(50, 4, '12 kHz Resonant Scanner (CRS)');
    resonant.reflectAt(
        xCol, yArm, 0,
        new Vector3(0, 1, 0),     // beam arrives going +Y from the PBS below
        new Vector3(1, 0, 0),     // and leaves going +X into the relay
    );
    const RESONANT_BASE_PAN = resonant.panAngle;   // ¾π for the 90° fold
    scene.push(resonant);

    // Scan lenses (4-f relay). Real refracting singlets — biconvex BK7-grade
    // crown at f=54 mm. Aperture and thickness picked so the rim has positive
    // glass at the chosen sag, and so the ±10°-optical beam from the resonant
    // mirror still lands inside the clear aperture on the return pass.
    const scanLens1 = new SphericalLens(1 / fScan, 25, 14, 'Scan Lens 1 (f=54)');
    scanLens1.setPosition(xCol + fScan, yArm, 0);
    scanLens1.pointAlong(1, 0, 0);
    scene.push(scanLens1);

    const scanLens2 = new SphericalLens(1 / fScan, 25, 14, 'Scan Lens 2 (f=54)');
    scanLens2.setPosition(xCol + 3 * fScan, yArm, 0);
    scanLens2.pointAlong(1, 0, 0);
    scene.push(scanLens2);

    // λ/4 plate at 45° — the round trip through it (forward + return) rotates
    // S-pol into P-pol so the PBS switches the return beam from reflect to
    // transmit on its second pass. Design wavelength matches the laser (1040 nm).
    const qwp = new Waveplate('quarter', 25, Math.PI / 4, 'λ/4 Plate (fast axis 45°, 1040 nm)', 1040);
    qwp.setPosition(xCol + 3 * fScan + 25, yArm, 0);
    qwp.pointAlong(1, 0, 0);
    scene.push(qwp);

    // Slow galvo — flat mirror at neutral tilt sends the beam back; a small
    // out-of-plane tilt adds the slow Y-axis scan on top of the resonant
    // fast X scan. Animated via tiltAngle (rotates the normal in the XZ
    // plane), so the returning beam picks up a Z-component that survives the
    // PBS reflection and lands as the orthogonal scan axis on the card.
    // reflectAt() again, so the silvered front face is exactly at the back
    // focal plane of scan lens 2 (xCol + 4·fScan) rather than offset by
    // half the substrate thickness.
    const slow = new Mirror(30, 4, 'Slow Galvo (6220H, ±20°)');
    slow.reflectAt(
        xCol + 4 * fScan, yArm, 0,
        new Vector3(1, 0, 0),     // beam arrives going +X from the relay
        new Vector3(-1, 0, 0),    // retroreflects straight back -X
    );
    scene.push(slow);

    // ── Viewing card at the doubled-scan exit ──
    // Sits directly below the PBS along -Y. With the resonant scanner at
    // ±5° mechanical, the doubled exit fan is ±20° optical — the card sees
    // a much wider scan line than the resonant mirror alone could produce.
    // Width chosen so the ±20° fan plus the lateral offset of the exit ray
    // at the PBS face (~10 mm at the extremes) clears the edge with margin.
    const card = new Card(140, 80, 'Doubled-scan viewing card');
    const yCard = yJunction - 80;
    card.setPosition(xCol, yCard, 0);
    // pointAlong(0,1,0) → card faces +Y (toward the PBS, which is above).
    card.pointAlong(0, 1, 0);
    // Phosphor afterglow on the inspector preview, so the swept scan leaves
    // a visible line instead of a flickering dot.
    card.persistTrail = true;
    card.opaque = true;
    scene.push(card);

    // ── Animation ──
    // Crank the resonant mirror to its full ±5° mechanical (=±10° optical
    // per single bounce, ±20° after the Nisam2× double-bounce). Slowed well
    // below the physical 12 kHz to a leisurely teaching speed so the eye can
    // follow the doubled scan line across the card.
    const RES_HALF_ANGLE_RAD = (5 * Math.PI) / 180;
    const SLOW_HALF_ANGLE_RAD = (2.5 * Math.PI) / 180;

    const channels: AnimationChannel[] = [
        {
            id: generateChannelId(),
            targetId: resonant.id,
            property: 'panAngle',
            from: RESONANT_BASE_PAN - RES_HALF_ANGLE_RAD,
            to: RESONANT_BASE_PAN + RES_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            periodMs: 3000,
            repeat: true,
            restoreValue: RESONANT_BASE_PAN,
        },
        {
            id: generateChannelId(),
            targetId: slow.id,
            property: 'tiltAngle',
            from: -SLOW_HALF_ANGLE_RAD,
            to: SLOW_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            periodMs: 12000,
            repeat: true,
            restoreValue: 0,
        },
    ];

    return {
        scene,
        channels,
        animationPlaying: true,
        animationSpeed: 1.0,
        rayConfig: { colorByPolarization: true },
        description:
            'Yu et al., Optica 13(3):409 (2026) — "Non-inertial scan angle multiplier." ' +
            'The resonant mirror is hit twice in one beam path: each bounce contributes ' +
            '2Δθ, so a ±5° resonant scan exits the unit as ±20° optical with no penalty ' +
            'in mirror size or scan frequency. Polarization View highlights how a PBS + ' +
            'λ/4 round-trip separates the entry beam (S) from the doubled exit (P).',
    };
}
