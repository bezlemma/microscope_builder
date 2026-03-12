import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Card } from '../physics/components/Card';
import { Waveplate } from '../physics/components/Waveplate';

/**
 * Polarization Zoo — three classic polarization demonstrations.
 *
 * All beams travel along +X.
 *
 * Path 1 (y=80):  Half-Wave Plate Polarization Rotation
 *   Laser → Pol@0° → HWP@45° → Pol@90° → Card
 *
 * Path 2 (y=-20): Crossed Polarizers with λ/4 Waveplate
 *   Laser → Pol@0° → QWP@45° → Pol@90° → Card
 *
 * Path 3 (y=-120): Three-Polarizer Paradox
 *   Laser → Pol@0° → Pol@45° → Pol@90° → Card
 */
export function createPolarizationZooScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // ── Path 1: HWP Rotation ──

    const hwpLaser = new Laser("HWP Laser");
    hwpLaser.wavelength = 532;
    hwpLaser.power = 1.0;
    hwpLaser.setPosition(-200, 80, 0);
    hwpLaser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(hwpLaser);

    const hwpPol1 = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
    hwpPol1.setPosition(-120, 80, 0);
    hwpPol1.pointAlong(1, 0, 0);  // along beam
    scene.push(hwpPol1);

    const hwp = new Waveplate('half', 12.5, Math.PI / 4, 'λ/2 @ 45°');
    hwp.setPosition(-50, 80, 0);
    hwp.pointAlong(1, 0, 0);  // along beam
    scene.push(hwp);

    const hwpPol2 = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
    hwpPol2.setPosition(20, 80, 0);
    hwpPol2.pointAlong(1, 0, 0);  // along beam
    scene.push(hwpPol2);

    const hwpCard = new Card(20, 20, "HWP Card");
    hwpCard.setPosition(100, 80, 0);
    hwpCard.pointAlong(1, 0, 0);  // faces beam
    scene.push(hwpCard);

    // ── Path 2: QWP Crossed Polarizers ──

    const qwpLaser = new Laser("QWP Laser");
    qwpLaser.wavelength = 632;
    qwpLaser.power = 1.0;
    qwpLaser.setPosition(-200, -20, 0);
    qwpLaser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(qwpLaser);

    const qwpPol1 = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
    qwpPol1.setPosition(-120, -20, 0);
    qwpPol1.pointAlong(1, 0, 0);  // along beam
    scene.push(qwpPol1);

    const qwp = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 @ 45°');
    qwp.setPosition(-50, -20, 0);
    qwp.pointAlong(1, 0, 0);  // along beam
    scene.push(qwp);

    const qwpPol2 = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
    qwpPol2.setPosition(20, -20, 0);
    qwpPol2.pointAlong(1, 0, 0);  // along beam
    scene.push(qwpPol2);

    const qwpCard = new Card(20, 20, "QWP Card");
    qwpCard.setPosition(100, -20, 0);
    qwpCard.pointAlong(1, 0, 0);  // faces beam
    scene.push(qwpCard);

    // ── Path 3: Three-Polarizer Paradox ──

    const tpLaser = new Laser("3-Pol Laser");
    tpLaser.wavelength = 473;
    tpLaser.power = 1.0;
    tpLaser.setPosition(-200, -120, 0);
    tpLaser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(tpLaser);

    const tpPol1 = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
    tpPol1.setPosition(-120, -120, 0);
    tpPol1.pointAlong(1, 0, 0);  // along beam
    scene.push(tpPol1);

    const tpPol45 = new Waveplate('polarizer', 12.5, Math.PI / 4, 'Pol @ 45°');
    tpPol45.setPosition(-50, -120, 0);
    tpPol45.pointAlong(1, 0, 0);  // along beam
    scene.push(tpPol45);

    const tpPol2 = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
    tpPol2.setPosition(20, -120, 0);
    tpPol2.pointAlong(1, 0, 0);  // along beam
    scene.push(tpPol2);

    const tpCard = new Card(20, 20, "3-Pol Card");
    tpCard.setPosition(100, -120, 0);
    tpCard.pointAlong(1, 0, 0);  // faces beam
    scene.push(tpCard);

    return scene;
}
