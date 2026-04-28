import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Card } from '../physics/components/Card';
import { PupilMaskElement } from '../physics/components/PupilMaskElement';
import { Blocker } from '../physics/components/Blocker';

/**
 * Mach-Zehnder Interferometer
 *
 * Beam path (XY plane):
 *   Laser → BS1 ──(transmitted +X)──→ Mirror_B ──(reflected -Y)──→ BS2 → Card
 *                ╰─(reflected +Y)──→ Mirror_A ──(reflected +X)──╯
 *
 * Layout:
 *   Laser    at (-200, 0)  — emits +X
 *   BS1      at (-100, 0)  — 45° splits
 *   Mirror_A at (-100, 80) — redirects +Y → +X
 *   Mirror_B at (0, 0)     — redirects +X → +Y
 *   BS2      at (0, 80)    — recombines
 *   Card     at (80, 80)   — detector
 *   Dump     at (0, 130)   — catches the unused BS2 output
 */
export function createMZInterferometerScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    const laser = new Laser("MZ Laser (532nm)");
    laser.wavelength = 532;
    laser.power = 1.0;
    laser.setPosition(-200, 0, 0);
    laser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser);

    // Use explicit surface normals so the optics stay correct under the current
    // component orientation convention.
    const bs1 = new BeamSplitter(20, 2, 0.5, "BS1 (50/50)");
    bs1.setPosition(-100, 0, 0);
    bs1.pointAlong(1, -1, 0);  // reflects +X -> +Y, transmits +X
    scene.push(bs1);

    const mirrorA = new Mirror(20, 2, "Mirror A");
    mirrorA.setPosition(-100, 80, 0);
    mirrorA.pointAlong(-1, 1, 0);  // reflects +Y -> +X
    scene.push(mirrorA);

    const phaseTrim = new PupilMaskElement("Arm A Phase Trim");
    phaseTrim.mode = 'phaseRing';
    phaseTrim.radius = 12;
    phaseTrim.innerRadius = 0;
    phaseTrim.outerRadius = 1;
    phaseTrim.ringTransmission = 1;
    phaseTrim.ringPhaseShift = 0;
    phaseTrim.backgroundTransmission = 1;
    phaseTrim.backgroundPhaseShift = 0;
    phaseTrim.updateBounds();
    phaseTrim.rebuildMask();
    phaseTrim.setPosition(-50, 80, 0);
    phaseTrim.pointAlong(1, 0, 0);
    scene.push(phaseTrim);

    const mirrorB = new Mirror(20, 2, "Mirror B");
    mirrorB.setPosition(0, 0, 0);
    mirrorB.pointAlong(1, -1, 0);  // reflects +X -> +Y
    scene.push(mirrorB);

    const bs2 = new BeamSplitter(20, 2, 0.5, "BS2 (50/50)");
    bs2.setPosition(0, 80, 0);
    bs2.pointAlong(-1, 1, 0);  // reflects +Y -> +X, transmits +X
    scene.push(bs2);

    const bs2Dump = new Blocker(24, 3, "BS2 Upper Beam Dump");
    bs2Dump.setPosition(0, 130, 0);
    bs2Dump.pointAlong(0, 1, 0);
    scene.push(bs2Dump);

    const card = new Card(30, 30, "MZ Detector");
    card.opaque = true;
    card.setPosition(80, 80, 0);
    card.pointAlong(1, 0, 0);  // faces beam traveling +X
    scene.push(card);

    return scene;
}
