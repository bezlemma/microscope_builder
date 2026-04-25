import { Vector3 } from 'three';

import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Waveplate } from '../physics/components/Waveplate';
import { GalvoScanHead } from '../physics/components/GalvoScanHead';
import { IdealLens } from '../physics/components/IdealLens';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { PMT } from '../physics/components/PMT';
import { SpectralProfile } from '../physics/SpectralProfile';
import { AnimationChannel, generateChannelId } from '../physics/PropertyAnimator';
import type { PresetResult } from '../state/store';

/**
 * Yu et al., Optica 13(3):409 (March 2026):
 *   "Non-inertial scan angle multiplier for expanded fields-of-view"
 *
 * Reproduces Figure 3 — the angle-doubled two-photon microscope. The trick:
 * the scanned beam is sent through a 4-f relay to a (slow) retroreflecting
 * mirror, which sends it back to strike the SAME resonant mirror a second
 * time. Each bounce contributes 2Δθ, so a ±5° resonant scanner produces a
 * ±10° optical scan with no penalty in mirror size or scan frequency.
 *
 * Beam path (excitation):
 *   Laser → PBS (S→reflect) → resonant galvo (1st bounce) →
 *   scan lens 1 → QWP → scan lens 2 → slow galvo (retro) →
 *   ... beam returns through the relay, P-polarized after 2× λ/4 ...
 *   resonant galvo (2nd bounce, doubled angle) → PBS (P→transmit) →
 *   imaging scan lens → tube lens → dichroic → objective → sample
 *
 * Beam path (emission, descanned NDD):
 *   sample → objective → dichroic (reflect 510 nm) → collection lens → PMT
 *
 * Hardware called out by the paper (modeled with idealized equivalents):
 *   - Resonant scanner: CRS 12 kHz, ±5° optical (Cambridge Technology)
 *   - Slow galvo: 6220H, ±20° (Cambridge Technology), used as retroreflector
 *   - Scan lenses: LSM54-1050, EFL 54 mm (Thorlabs) ×2
 *   - Tube lens: TTL200MP, EFL 200 mm (Thorlabs)
 *   - Dichroic: DI03-R785-T1 (AVR Optics) — longpass at 785 nm
 *   - Objective: Nikon 16×/0.8 NA water immersion (EFL 12.5 mm)
 *   - PBS: PBS513 (Thorlabs); QWP: 39-046 (Edmund Optics)
 *   - PMT: PMT2102 (Thorlabs)
 */
export function createCheHangYu2026Scene(): PresetResult {
    const scene: OpticalComponent[] = [];

    // Geometry — top-down view, all components on z = 0.
    // Vertical column at x = 20 carries PBS, imaging arm, and objective.
    // Horizontal arm at y = 100 carries the angle-doubling 4-f relay.
    const xCol = 20;
    const yArm = 100;
    const fScan = 54;   // mm — LSM54-1050 effective focal length
    const fTube = 200;  // mm — TTL200MP effective focal length

    // ── Laser: 920 nm Ti:Sapph, 5 mm beam ──────────────────────────────────
    const laser = new Laser('920 nm Ti:Sapph');
    laser.setPosition(-300, 0, 0);
    laser.pointAlong(1, 0, 0);
    laser.wavelength = 460;
    laser.beamRadius = 2.5;
    laser.power = 1.0;
    scene.push(laser);

    // ── λ/2 plate at 45°: rotates the laser's default x-polarization to
    //    y-polarization so the PBS sees an S-polarized input and reflects it
    //    into the angle-doubling arm.
    const hwp = new Waveplate('half', 12.5, Math.PI / 4, 'λ/2 Polarization Rotator');
    hwp.setPosition(-100, 0, 0);
    hwp.pointAlong(1, 0, 0);
    scene.push(hwp);

    // ── PBS at the junction: S-pol reflects up to the angle doubler,
    //    P-pol returning from the doubler transmits down to the imaging arm.
    const pbs = new PolarizingBeamSplitter(25.4, 2, 'PBS513 (S→up, P→down)');
    pbs.setPosition(xCol, 0, 0);
    // n = normalize(d_in − d_out) = normalize((+1,0,0) − (0,+1,0))
    pbs.pointAlong(1, -1, 0);
    scene.push(pbs);

    // ═══ ANGLE-DOUBLING ARM (Fig. 3a, top of unit) ═════════════════════════
    // The resonant scan mirror is hit TWICE — once on the way out and once
    // on the return path from the slow galvo — doubling the optical angle.

    // Resonant 12 kHz scan mirror (fast / x-axis). pointAlong(-1,+1,0):
    //   beam from PBS (going +Y) reflects off this mirror toward +X.
    const resonant = new GalvoScanHead(15, 2, '12 kHz Resonant Scanner (CRS)');
    resonant.setPosition(xCol, yArm, 0);
    resonant.pointAlong(-1, 1, 0);
    scene.push(resonant);

    // Scan lens 1 of the angle-doubling 4-f relay.
    const scanLens1 = new IdealLens(fScan, 12.5, 'LSM54-1050 (f=54)');
    scanLens1.setPosition(xCol + fScan, yArm, 0);
    scanLens1.pointAlong(1, 0, 0);
    scene.push(scanLens1);

    // Scan lens 2 of the angle-doubling 4-f relay.
    const scanLens2 = new IdealLens(fScan, 12.5, 'LSM54-1050 (f=54)');
    scanLens2.setPosition(xCol + 3 * fScan, yArm, 0);
    scanLens2.pointAlong(1, 0, 0);
    scene.push(scanLens2);

    // Quarter-wave plate at 45° fast axis. The beam passes through twice
    // (S → circular outbound, circular → P on return), so the round-trip
    // polarization rotation is 90° — exactly what the PBS needs to switch
    // the return beam from "reflect" to "transmit".
    const qwp = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 Plate (fast axis 45°)');
    qwp.setPosition(xCol + 3 * fScan + 25, yArm, 0);
    qwp.pointAlong(1, 0, 0);
    scene.push(qwp);

    // Slow galvo (linear servo, ±20°) acting as the retroreflector that
    // closes the 4-f loop. Normal points back along -X so the beam returns
    // straight along the relay; small scanY values steer the slow axis.
    const slow = new GalvoScanHead(15, 2, 'Slow Galvo (6220H, ±20°)');
    slow.setPosition(xCol + 4 * fScan, yArm, 0);
    slow.pointAlong(1, 0, 0);
    scene.push(slow);

    // ═══ IMAGING ARM (below the PBS) ═══════════════════════════════════════
    // After the second bounce off the resonant mirror, the beam is now
    // P-polarized (two QWP passes) and exits the PBS heading -Y with the
    // doubled scan angle.

    // Scan lens of the imaging arm (forms intermediate scan focus).
    const imagingScanLens = new IdealLens(fScan, 12.5, 'Imaging Scan Lens (f=54)');
    imagingScanLens.setPosition(xCol, -fScan, 0);
    imagingScanLens.pointAlong(0, -1, 0);
    scene.push(imagingScanLens);

    // Tube lens (TTL200MP). Combined with the scan lens, this gives a
    // 200/54 ≈ 3.7× beam expansion onto the objective back aperture and
    // a 0.27× angle minification, matching the paper's geometry.
    const tubeLens = new IdealLens(fTube, 18, 'TTL200MP Tube Lens (f=200)');
    tubeLens.setPosition(xCol, -fScan - fTube, 0);
    tubeLens.pointAlong(0, -1, 0);
    scene.push(tubeLens);

    // Dichroic: longpass @ 785 nm — transmits 920 nm excitation toward the
    // objective, reflects ~510 nm GCaMP emission sideways into the PMT arm.
    const yDichroic = -fScan - fTube - 60;
    const dichroic = new DichroicMirror(
        50.8, 2,
        new SpectralProfile('longpass', 390, [], 10),
        'Dichroic DI03-R785 (LP 785)',
    );
    dichroic.setPosition(xCol, yDichroic, 0);
    // Reflect emission from -Y-traveling fluorescence to +X.
    // n = normalize(d_in − d_out) = normalize((0,+1,0) − (+1,0,0))
    dichroic.pointAlong(-1, 1, 0);
    scene.push(dichroic);

    // Objective: Nikon 16×/0.8 NA water immersion (paper's primary objective).
    const objective = new Objective({
        magnification: 16,
        NA: 0.8,
        immersionIndex: 1.33,
        workingDistance: 3.0,
        tubeLensFocal: fTube,
        diameter: 30,
        name: 'Nikon 16×/0.8 W',
    });
    objective.setImmersionMedium('water');
    objective.setPosition(xCol, yDichroic - 60, 0);
    objective.pointAlong(0, -1, 0);
    scene.push(objective);

    // Sample: place at the objective's front focal plane.
    const sampleHolderGapMm = 0.25;
    objective.updateMatrices();
    const focusWorld = new Vector3(0, 0, -objective.focalLength).applyMatrix4(objective.localToWorld);
    const sampleNormal = objective.getSampleSideNormalWorld();
    const holderCenter = focusWorld.clone().add(sampleNormal.clone().multiplyScalar(sampleHolderGapMm));

    const sample = new Sample('GCaMP6s mouse cortex (V1)');
    // GCaMP6s 2P excitation peak ~920 nm, emission ~510 nm.
    sample.excitationSpectrum = new SpectralProfile('bandpass', 920, [{ center: 920, width: 80 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 510, [{ center: 510, width: 50 }]);
    sample.fluorescenceEfficiency = 0.6;
    sample.setPosition(holderCenter.x, holderCenter.y, holderCenter.z);
    sample.pointAlong(0, 1, 0);
    sample.specimenOffset.set(0, 0, -sampleHolderGapMm);
    scene.push(sample);

    // ── PMT collection arm (off the dichroic, +X side) ─────────────────────
    const collectionLens = new IdealLens(50, 12.5, 'Collection Lens (f=50)');
    collectionLens.setPosition(xCol + 80, yDichroic, 0);
    collectionLens.pointAlong(1, 0, 0);
    scene.push(collectionLens);

    const pmt = new PMT(10, 10, 'PMT2102');
    pmt.setPosition(xCol + 160, yDichroic, 0);
    pmt.pointAlong(-1, 0, 0);
    pmt.sensorNA = 0.05;
    pmt.samplesPerPixel = 24;
    pmt.pmtSampleHz = 4096;
    pmt.connectGalvo(resonant);
    scene.push(pmt);

    // ── Animation channels ─────────────────────────────────────────────────
    // Resonant scanner: ±5° optical (= ±2.5° mechanical) at 12 kHz.
    // Slow galvo: ±5° optical at 32 Hz, frame-rate-ish pacing for the demo.
    const RES_HALF_ANGLE_RAD = (5 * Math.PI) / 180;
    const SLOW_HALF_ANGLE_RAD = (5 * Math.PI) / 180;

    const channels: AnimationChannel[] = [
        {
            id: generateChannelId(),
            targetId: resonant.id,
            property: 'scanX',
            from: -RES_HALF_ANGLE_RAD,
            to: RES_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            // Slowed from physical 12 kHz → 32 Hz for visual sweep.
            periodMs: 1000 / 32,
            repeat: true,
            restoreValue: 0,
        },
        {
            id: generateChannelId(),
            targetId: slow.id,
            property: 'scanY',
            from: -SLOW_HALF_ANGLE_RAD,
            to: SLOW_HALF_ANGLE_RAD,
            easing: 'sinusoidal',
            periodMs: 1000,
            repeat: true,
            restoreValue: 0,
        },
    ];

    return {
        scene,
        channels,
        animationPlaying: false,
        animationSpeed: 0.1,
        description:
            'Yu et al., Optica 13(3):409 (2026) — "Non-inertial scan angle multiplier for expanded ' +
            'fields-of-view." Angle-doubled two-photon microscope: a 4-f relay sends the scanned ' +
            'beam to a slow-galvo retroreflector and back through the SAME resonant mirror, doubling ' +
            'the optical scan angle (±5° → ±10°) with no loss in scan frequency or mirror size.',
    };
}
