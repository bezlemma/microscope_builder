import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { IdealLens } from '../physics/components/IdealLens';
import { PMT } from '../physics/components/PMT';
import { Aperture } from '../physics/components/Aperture';
import { SpectralProfile } from '../physics/SpectralProfile';
import { AnimationChannel, generateChannelId } from '../physics/PropertyAnimator';
import { Euler } from 'three';

/** Rich preset result — scene + animation + playback config. */
export interface ConfocalPresetResult {
    scene: OpticalComponent[];
    channels: AnimationChannel[];
    animationPlaying: boolean;
    animationSpeed: number;
}

/**
 * Confocal Laser-Scanning Microscope — Standard Nikon layout.
 *
 * 4f RELAY (scan lens + tube lens):
 *   scan lens (f₁=50mm) →[250mm]→ tube lens (f₂=200mm)
 *   Tube lens to objective BFP = f₂ = 200mm
 *
 * Compact U-shaped beam path (two fold mirrors on the right):
 *   Y Galvo → (+X) → Scan Lens → (+X, 125mm) → Fold 1 → (-Y, 125mm) → Tube Lens
 *   → (-Y, 50mm) → Fold 2 → (-X, 150mm) → Objective → (-X, 50mm) → Sample
 *
 * Emission (de-scanned):
 *   Sample → Objective → Fold 2 → Fold 1 → Scan Lens → Y Galvo → X Galvo
 *   → Dichroic (transmits 520) → Relay Lens → Em Filter → Pinhole → PMT
 */
export const createConfocalScene = (): ConfocalPresetResult => {
    const scene: OpticalComponent[] = [];
    const mOff = (2 / 2) * Math.cos(Math.PI / 4);  // mirror thickness offset ≈ 0.707

    // ══════════════════════════════════════════════════════════════════
    //  LASER (fires +Y from below dichroic)
    // ══════════════════════════════════════════════════════════════════
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-112.5, -62.5, 0);
    laser.setRotation(0, 0, Math.PI / 2);  // fires +Y
    laser.beamRadius = 1;
    laser.wavelength = 488;
    laser.power = 1.0;
    scene.push(laser);

    // ══════════════════════════════════════════════════════════════════
    //  DICHROIC — LP 505: reflects 488nm, transmits 520nm.
    // ══════════════════════════════════════════════════════════════════
    const dichroic = new DichroicMirror(
        25, 2,
        new SpectralProfile('longpass', 505, [], 5),
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(-112.5, -12.5, 0);
    dichroic.setRotation(0, 0, -Math.PI / 4);  // -45°: +Y → +X
    scene.push(dichroic);

    // ══════════════════════════════════════════════════════════════════
    //  GALVO PAIR → SCAN LENS → 4f RELAY → OBJECTIVE → SAMPLE
    // ══════════════════════════════════════════════════════════════════

    // ── X Galvo Mirror ──
    const xGalvo = new Mirror(15, 2, "X Galvo");
    xGalvo.setPosition(-87.5 + mOff, -12.5 + mOff, 0);
    xGalvo.setRotation(0, 0, Math.PI / 4);  // +X → -Y
    scene.push(xGalvo);

    // ── Y Galvo Mirror ──
    // At f₁=50mm from scan lens (telecentric condition).
    const yGalvo = new Mirror(15, 2, "Y Galvo");
    yGalvo.setPosition(-87.5 - mOff, -37.5 - mOff, 0);
    yGalvo.setRotation(0, 0, Math.PI / 4);  // -Y → +X
    scene.push(yGalvo);

    // ── Scan Lens (f₁ = 50mm) ──
    // 50mm from Y galvo → telecentric.
    const scanLens = new IdealLens(50, 12.5, "Scan Lens");
    scanLens.setPosition(-37.5, -37.5, 0);
    scanLens.setRotation(0, Math.PI / 2, 0);  // faces ±X
    scene.push(scanLens);

    // ── Fold Mirror 1 ──
    // 125mm from scan lens (going +X). Reflects +X → -Y.
    const fold1 = new Mirror(25, 2, "Fold Mirror 1");
    fold1.setPosition(87.5 + mOff, -37.5 + mOff, 0);
    fold1.setRotation(0, 0, Math.PI / 4);  // +X → -Y
    scene.push(fold1);

    // ── Tube Lens (f₂ = 200mm, Nikon standard) ──
    // 125mm from fold 1 (going -Y). Total from scan lens: 125+125 = 250 = f₁+f₂.
    const tubeLens = new IdealLens(200, 12.5, "Tube Lens");
    tubeLens.setPosition(87.5, -162.5, 0);
    tubeLens.setRotation(Math.PI / 2, 0, 0);  // faces ±Y (beam goes -Y)
    scene.push(tubeLens);

    // ── Fold Mirror 2 ──
    // 50mm from tube lens (going -Y). Reflects -Y → -X (back left).
    const fold2 = new Mirror(30, 2, "Fold Mirror 2");
    fold2.setPosition(87.5 + mOff, -212.5 - mOff, 0);
    fold2.setRotation(0, 0, -Math.PI / 4);  // -Y → -X
    scene.push(fold2);

    // ── Objective (20×/0.85W) ──
    // 150mm from fold 2 (going -X). Total tube→obj: 50+150 = 200 = f₂.
    const objective = new Objective({
        magnification: 20,
        NA: 0.85,
        immersionIndex: 1.33,
        workingDistance: 2.0,
        tubeLensFocal: 200,
        name: '20×/0.85W Objective'
    });
    objective.setPosition(-62.5, -212.5, 0);
    objective.setRotation(0, Math.PI / 2, 0);  // local -Z faces sample (world -X)
    scene.push(objective);

    // ── Fluorescent Sample ──
    // f_obj = 200/20 = 10mm from objective (going -X).
    const sample = new Sample("Specimen (Fluo)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(-72.5, -212.5, 0);
    sample.setRotation(0, 0, 0);
    scene.push(sample);

    // ══════════════════════════════════════════════════════════════════
    //  EMISSION PATH (going -X from dichroic)
    // ══════════════════════════════════════════════════════════════════

    // ── Relay Lens (f = 50mm) ──
    const relayLens = new IdealLens(50, 12.5, "Pinhole Lens");
    relayLens.setPosition(-162.5, -12.5, 0);
    relayLens.setRotation(0, Math.PI / 2, 0);
    scene.push(relayLens);

    // ── Emission Filter ──
    const emFilter = new Filter(
        25, 3,
        new SpectralProfile('bandpass', 520, [{ center: 525, width: 50 }]),
        "Em Filter (BP 525/50)"
    );
    emFilter.setPosition(-212.5, -12.5, 0);
    emFilter.setRotation(0, 0, 0);
    scene.push(emFilter);

    // ── Confocal Pinhole ──
    const pinhole = new Aperture(0.5, 15, "Confocal Pinhole");
    pinhole.setPosition(-262.5, -12.5, 0);
    pinhole.setRotation(0, 0, 0);
    scene.push(pinhole);

    // ── PMT Detector ──
    const pmt = new PMT(10, 10, "PMT");
    pmt.setPosition(-312.5, -12.5, 0);
    pmt.setRotation(0, Math.PI / 2, 0);
    scene.push(pmt);

    // ══════════════════════════════════════════════════════════════════
    //  ANIMATION CHANNELS (galvo sweep)
    // ══════════════════════════════════════════════════════════════════
    const xEuler = new Euler().setFromQuaternion(xGalvo.rotation);
    const yEuler = new Euler().setFromQuaternion(yGalvo.rotation);
    // X galvo: h_sample_Y = f_obj × 2θ × (f₁/f₂) = 50 × 2θ × 0.25 = 25θ
    // Y galvo: h_sample_Z = f_obj × √2θ × (f₁/f₂) ≈ 17.7θ (Z-deflection from rotation.y)
    // Mickey extents: Y ≈ ±0.75mm, Z ≈ ±0.625mm
    // At 2.5°: X covers ±1.09mm (>0.75), Y covers ±0.77mm (>0.625)
    const halfAngle = 2.5 * Math.PI / 180;  // ±2.5° galvo

    const channels: AnimationChannel[] = [
        {
            id: generateChannelId(),
            targetId: xGalvo.id,
            property: 'rotation.z',
            from: xEuler.z - halfAngle,
            to: xEuler.z + halfAngle,
            easing: 'sinusoidal',
            periodMs: 1000 / 32,
            repeat: true,
            restoreValue: xEuler.z,
        },
        {
            id: generateChannelId(),
            targetId: yGalvo.id,
            property: 'rotation.y',
            from: yEuler.y - halfAngle,
            to: yEuler.y + halfAngle,
            easing: 'sinusoidal',
            periodMs: 1000 / 0.5,
            repeat: true,
            restoreValue: yEuler.y,
        },
    ];

    // ── PMT axis bindings ──
    pmt.xAxisComponentId = xGalvo.id;
    pmt.xAxisProperty = 'rotation.z';
    pmt.yAxisComponentId = yGalvo.id;
    pmt.yAxisProperty = 'rotation.y';
    pmt.pmtSampleHz = 2048;
    pmt.scanResX = 64;
    pmt.scanResY = 64;

    return {
        scene,
        channels,
        animationPlaying: true,
        animationSpeed: 0.1,
    };
};
