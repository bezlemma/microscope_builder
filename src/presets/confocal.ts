import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { Blocker } from '../physics/components/Blocker';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { IdealLens } from '../physics/components/IdealLens';
import { PMT } from '../physics/components/PMT';
import { Aperture } from '../physics/components/Aperture';
import { SpectralProfile } from '../physics/SpectralProfile';
import { AnimationChannel, generateChannelId } from '../physics/PropertyAnimator';

/** Rich preset result — scene + animation + playback config. */
export interface ConfocalPresetResult {
    scene: OpticalComponent[];
    channels: AnimationChannel[];
    animationPlaying: boolean;
    animationSpeed: number;
}

/**
 * Confocal Laser-Scanning Microscope — Compact folded U-shape layout.
 *
 * GALVO PAIR: Two separate galvo mirrors (M1 fast X, M2 slow Y) create a
 * two-bounce 90° turn. Beam enters +X, exits -Y.  Each mirror animates
 * panAngle for scanning.
 *
 * 4f RELAY: scan lens (f₁=50mm) →[250mm]→ tube lens (f₂=200mm)
 *
 * Beam path (compact U-shape, folds back on itself):
 *
 *   Laser(0,-50) fires +Y
 *     → Dichroic(0,0) reflects +Y→+X
 *     → Galvo M1(35,0) reflects +X → 45° down-right
 *     → Galvo M2(50,-15) reflects 45° → -Y
 *     → ScanLens(50,-65) ──[-Y 125mm]──
 *     → Fold1(50,-190) reflects -Y→-X
 *     ──[-X 125mm]── TubeLens(-75,-190) ──[-X 100mm]──
 *     → Fold2(-175,-190) reflects -X→+Y
 *     ──[+Y 100mm]──
 *     → Objective(-175,-90) pointAlong(0,-1,0)
 *     → Sample(-175,-70)
 *     → Blocker(-175,-40)
 *
 * Emission (de-scanned, transmitted through dichroic -X):
 *   → RelayLens(-50,0) → EmFilter(-100,0) → Pinhole(-150,0) → PMT(-200,0)
 *
 * Distance verification:
 *   M2→ScanLens     = 50mm  = f₁ (telecentric)
 *   ScanLens→TubeLens = 125+125 = 250mm = f₁+f₂
 *   TubeLens→Objective = 100+100 = 200mm = f₂
 *   Objective→Sample   = 20mm   = f_obj
 */
export function createConfocalScene(): ConfocalPresetResult {
    const scene: OpticalComponent[] = [];

    const mirrorThickness = 2;

    // Galvo mirror angles: two mirrors split the 90° turn equally.
    // M1 deflects beam 45°, M2 deflects another 45°.
    // Mirror normals bisect incoming and outgoing beam directions.
    const a = Math.PI / 8;  // 22.5°

    // ══════════════════════════════════════════════════════════════════
    //  LASER (fires +Y toward dichroic)
    // ══════════════════════════════════════════════════════════════════
    const laser = new Laser("488 nm Laser");
    laser.setPosition(0, -50, 0);
    laser.pointAlong(0, 1, 0);  // fires +Y
    laser.beamRadius = 0.5;
    laser.wavelength = 488;
    laser.power = 1.0;
    scene.push(laser);

    // ══════════════════════════════════════════════════════════════════
    //  DICHROIC — reflects 488nm (+Y→+X), transmits 520nm emission (-X)
    // ══════════════════════════════════════════════════════════════════
    const dichroic = new DichroicMirror(
        25, mirrorThickness,
        new SpectralProfile('longpass', 505, [], 5),
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, 0, 0);
    dichroic.pointAlong(Math.sin(Math.PI / 4), -Math.cos(Math.PI / 4), 0);
    scene.push(dichroic);

    // ══════════════════════════════════════════════════════════════════
    //  DUAL GALVO PAIR — two separate mirrors, two-bounce 90° turn
    //  Beam: +X → M1 → (√2/2, -√2/2) → M2 → -Y
    // ══════════════════════════════════════════════════════════════════

    // ── Galvo M1 (X scan, fast axis) ──
    // Normal bisects +X and (√2/2,-√2/2): points at (-sin(π/8), -cos(π/8))
    const galvoM1 = new Mirror(12, mirrorThickness, "Galvo M1 (X)");
    galvoM1.setPosition(35, 0, 0);
    galvoM1.pointAlong(-Math.sin(a), -Math.cos(a), 0);
    scene.push(galvoM1);

    // ── Galvo M2 (Y scan, slow axis) ──
    // Normal bisects (√2/2,-√2/2) and (0,-1): points at (-cos(π/8), -sin(π/8))
    // Position: 15mm from M1 along the (√2/2, -√2/2) intermediate beam direction,
    // with x=50 so beam exits -Y aligned with the scan lens column.
    const galvoM2 = new Mirror(12, mirrorThickness, "Galvo M2 (Y)");
    galvoM2.setPosition(50, -15, 0);
    galvoM2.pointAlong(-Math.cos(a), -Math.sin(a), 0);
    scene.push(galvoM2);

    // ══════════════════════════════════════════════════════════════════
    //  EXCITATION PATH: ScanLens → Fold1 → TubeLens → Fold2
    //                   → Objective → Sample → Blocker
    // ══════════════════════════════════════════════════════════════════

    // ── Scan Lens (f₁ = 50mm, 50mm below M2) ──
    const scanLens = new IdealLens(50, 12.5, "Scan Lens");
    scanLens.setPosition(50, -65, 0);
    scanLens.pointAlong(0, -1, 0);
    scene.push(scanLens);

    // ── Fold Mirror 1 (125mm below scan lens) ──
    // Reflects -Y → -X.
    const fold1 = new Mirror(25, mirrorThickness, "Fold Mirror 1");
    fold1.setPosition(50, -190, 0);
    fold1.pointAlong(-1, 1, 0);  // normal bisects +Y and -X → reflects -Y→-X
    scene.push(fold1);

    // ── Tube Lens (f₂ = 200mm, 125mm left of fold1) ──
    // Total scan lens → tube lens = 125+125 = 250 = f₁+f₂ ✓
    const tubeLens = new IdealLens(200, 12.5, "Tube Lens");
    tubeLens.setPosition(-75, -190, 0);
    tubeLens.pointAlong(-1, 0, 0);
    scene.push(tubeLens);

    // ── Fold Mirror 2 (100mm left of tube lens) ──
    // Reflects -X → +Y.
    const fold2 = new Mirror(30, mirrorThickness, "Fold Mirror 2");
    fold2.setPosition(-175, -190, 0);
    fold2.pointAlong(1, 1, 0);  // normal bisects +X and +Y → reflects -X→+Y
    scene.push(fold2);

    // ── Objective (10×/0.5W) ──
    // 100mm above fold2. Total tube→obj = 100+100 = 200mm = f₂ ✓
    // pointAlong(0,-1,0) → nosepiece faces +Y toward sample.
    const objective = new Objective({
        magnification: 10,
        NA: 0.5,
        immersionIndex: 1.33,
        workingDistance: 5.0,
        tubeLensFocal: 200,
        name: '10×/0.5W Objective'
    });
    objective.setPosition(-175, -90, 0);
    objective.pointAlong(0, -1, 0);
    scene.push(objective);

    // ── Fluorescent Sample ──
    // f_obj = 200/10 = 20mm above objective.
    const sample = new Sample("Specimen (Fluo)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(-175, -70, 0);
    sample.pointAlong(0, -1, 0);
    scene.push(sample);

    // ── Blocker after sample — stops stray rays ──
    const blocker = new Blocker(30, 2, "Beam Stop");
    blocker.setPosition(-175, -40, 0);
    blocker.pointAlong(0, 1, 0);
    scene.push(blocker);

    // ══════════════════════════════════════════════════════════════════
    //  EMISSION PATH (de-scanned, transmitted through dichroic going -X)
    // ══════════════════════════════════════════════════════════════════

    const relayLens = new IdealLens(50, 12.5, "Relay Lens");
    relayLens.setPosition(-50, 0, 0);
    relayLens.pointAlong(-1, 0, 0);
    scene.push(relayLens);

    const emFilter = new Filter(
        25, 2,
        new SpectralProfile('bandpass', 520, [{ center: 520, width: 40 }]),
        "Em Filter (BP520/40)"
    );
    emFilter.setPosition(-100, 0, 0);
    emFilter.pointAlong(-1, 0, 0);
    scene.push(emFilter);

    const pinhole = new Aperture(0.05, 12.5, "Confocal Pinhole");
    pinhole.setPosition(-150, 0, 0);
    pinhole.pointAlong(-1, 0, 0);
    scene.push(pinhole);

    const pmt = new PMT(10, 10, "PMT");
    pmt.setPosition(-200, 0, 0);
    pmt.pointAlong(1, 0, 0);
    scene.push(pmt);

    // ══════════════════════════════════════════════════════════════════
    //  ANIMATION CHANNELS (galvo sweep — panAngle oscillation)
    // ══════════════════════════════════════════════════════════════════
    const halfAngle = 3.0 * Math.PI / 180;  // ±3° mechanical scan angle

    // Nominal panAngle values (extracted by pointAlong)
    const m1NomPan = galvoM1.panAngle;
    const m2NomPan = galvoM2.panAngle;

    const channels: AnimationChannel[] = [
        {
            id: generateChannelId(),
            targetId: galvoM1.id,
            property: 'panAngle',
            from: m1NomPan - halfAngle,
            to: m1NomPan + halfAngle,
            easing: 'sinusoidal',
            periodMs: 1000 / 32,
            repeat: true,
            restoreValue: m1NomPan,
        },
        {
            id: generateChannelId(),
            targetId: galvoM2.id,
            property: 'panAngle',
            from: m2NomPan - halfAngle,
            to: m2NomPan + halfAngle,
            easing: 'sinusoidal',
            periodMs: 1000 / 0.5,
            repeat: true,
            restoreValue: m2NomPan,
        },
    ];

    // ── PMT axis bindings ──
    pmt.xAxisComponentId = galvoM1.id;
    pmt.xAxisProperty = 'panAngle';
    pmt.yAxisComponentId = galvoM2.id;
    pmt.yAxisProperty = 'panAngle';
    pmt.pmtSampleHz = 2048;
    pmt.scanResX = 64;
    pmt.scanResY = 64;

    return {
        scene,
        channels,
        animationPlaying: true,
        animationSpeed: 0.1,
    };
}
