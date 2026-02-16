import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Card } from '../physics/components/Card';
import { Waveplate } from '../physics/components/Waveplate';

/**
 * Polarization Zoo Preset — three classic polarization demonstrations
 *
 * Path 1 (top):    Half-Wave Plate Polarization Rotation
 *   Laser → Pol@0° → HWP@45° → Pol@90° → Card
 *   The HWP at 45° rotates horizontal polarization by 2×45° = 90°,
 *   converting it to vertical. The crossed analyzer at 90° now passes
 *   everything — compared to total blocking without the HWP.
 *
 * Path 2 (middle): Crossed Polarizers with λ/4 Waveplate
 *   Laser → Pol@0° → QWP@45° → Pol@90° → Card
 *   The QWP converts linear→circular, and the crossed analyzer projects
 *   the circular state onto its axis → ~50% transmission.
 *
 * Path 3 (bottom): Three-Polarizer Paradox
 *   Laser → Pol@0° → Pol@45° → Pol@90° → Card
 *   Without the middle polarizer, 0° and 90° are crossed → total block.
 *   Inserting a 45° polarizer between them lets light through!
 *   Each step transmits cos²(45°) ≈ 50%, so total ≈ 25%.
 *   This is the famous "quantum eraser" classroom demo.
 */
export const createPolarizationZooScene = (): OpticalComponent[] => [
    (() => {
        const c = new Laser("HWP Laser");
        c.wavelength = 532;
        c.power = 1.0;
        c.setPosition(-200, 80, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
        c.setPosition(-120, 80, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('half', 12.5, Math.PI / 4, 'λ/2 @ 45°');
        c.setPosition(-50, 80, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
        c.setPosition(20, 80, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Card(20, 20, "HWP Card");
        c.setPosition(100, 80, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    (() => {
        const c = new Laser("QWP Laser");
        c.wavelength = 632;  // HeNe red
        c.power = 1.0;
        c.setPosition(-200, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
        c.setPosition(-120, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 @ 45°');
        c.setPosition(-50, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
        c.setPosition(20, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Card(20, 20, "QWP Card");
        c.setPosition(100, -20, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    (() => {
        const c = new Laser("3-Pol Laser");
        c.wavelength = 473;  // Blue
        c.power = 1.0;
        c.setPosition(-200, -120, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
        c.setPosition(-120, -120, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, Math.PI / 4, 'Pol @ 45°');
        c.setPosition(-50, -120, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
        c.setPosition(20, -120, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Card(20, 20, "3-Pol Card");
        c.setPosition(100, -120, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
];
