import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Card } from '../physics/components/Card';
import { Waveplate } from '../physics/components/Waveplate';

/**
 * Polarization Zoo Preset
 * 
 * Three beam paths demonstrating different polarization states:
 * 
 * Path 1 (top):    Laser → λ/4 @ 45° → Card — produces circular polarization
 * Path 2 (middle): Laser → λ/2 @ 22.5° → Card — rotates linear by 45°
 * Path 3 (bottom): Laser → Polarizer @ 45° → Card — 45° linear (50% power loss)
 */
export const createPolarizationZooScene = (): OpticalComponent[] => [
    // ═══ Path 1: Linear → Circular (λ/4 plate) ═══
    (() => {
        const c = new Laser("Laser 1 (532nm)");
        c.power = 1.0;
        c.setPosition(-150, 60, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 @ 45°');
        c.setPosition(-50, 60, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new Card(25, 25, "Card 1 (Circular)");
        c.setPosition(50, 60, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    // ═══ Path 2: Rotated Linear (λ/2 plate) ═══
    (() => {
        const c = new Laser("Laser 2 (532nm)");
        c.power = 1.0;
        c.setPosition(-150, 0, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('half', 12.5, Math.PI / 8, 'λ/2 @ 22.5°');
        c.setPosition(-50, 0, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new Card(25, 25, "Card 2 (Rotated)");
        c.setPosition(50, 0, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    // ═══ Path 3: Polarizer projection (Linear Polarizer) ═══
    (() => {
        const c = new Laser("Laser 3 (532nm)");
        c.power = 1.0;
        c.setPosition(-150, -60, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Waveplate('polarizer', 12.5, Math.PI / 4, 'Polarizer @ 45°');
        c.setPosition(-50, -60, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new Card(25, 25, "Card 3 (Filtered)");
        c.setPosition(50, -60, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })()
];
