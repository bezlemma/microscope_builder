import { OpticalComponent } from '../physics/Component';
import { Laser } from '../parts/Laser';
import { Mirror } from '../parts/Mirror';
import { BeamSplitter } from '../parts/BeamSplitter';
import { Card } from '../parts/Card';

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
 */
export function createMZInterferometerScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    const laser = new Laser("MZ Laser (532nm)");
    laser.wavelength = 532;
    laser.power = 1.0;
    laser.setPosition(-200, 0, 0);
    laser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser);

    const bs1 = new BeamSplitter(20, 2, 0.5, "BS1 (50/50)");
    bs1.setPosition(-100, 0, 0);
    bs1.pointAlong(1, -1, 0)
    scene.push(bs1);

    const mirrorA = new Mirror(20, 2, "Mirror A");
    mirrorA.setPosition(-100, 80, 0);
    mirrorA.pointAlong(-1, 1, 0); 
    scene.push(mirrorA);

    const mirrorB = new Mirror(20, 2, "Mirror B");
    mirrorB.setPosition(0, 0, 0);
    mirrorB.pointAlong(1, -1, 0);
    scene.push(mirrorB);

    const bs2 = new BeamSplitter(20, 2, 0.5, "BS2 (50/50)");
    bs2.setPosition(0, 80, 0);
    bs2.pointAlong(1, 1, 0); 
    scene.push(bs2);

    const card = new Card(30, 30, "MZ Detector");
    card.setPosition(80, 80, 0);
    card.pointAlong(1, 0, 0);  // faces beam traveling +X
    scene.push(card);

    return scene;
}
