import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';
import { Card } from '../physics/components/Card';

/**
 * Mach-Zehnder Interferometer (standalone)
 *
 * Copied directly from the working MZ setup in polarizationZoo.ts.
 *
 *  Laser ──→ BS1 ──(transmitted)──→ Mirror_B ──→ (down)
 *               │                                    │
 *          (reflected, up)                            │
 *               │                                    ↓
 *          Mirror_A ──→ (right) ──→ BS2 ──→ Card
 *
 * Layout (all at z=0, XY plane):
 *   Laser    at x=-200, y=0
 *   BS1      at x=-100, y=0   (45° → reflects up)
 *   Mirror_A at x=-100, y=80  (reflects right)
 *   Mirror_B at x=0,    y=0   (reflects down → toward BS2)
 *   BS2      at x=0,    y=80  (recombines beams → Card)
 *   Card     at x=80,   y=80
 */
export const createMZInterferometerScene = (): OpticalComponent[] => [
    (() => {
        const c = new Laser("MZ Laser (532nm)");
        c.wavelength = 532;
        c.power = 1.0;
        c.setPosition(-200, 0, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new BeamSplitter(20, 2, 0.5, "BS1 (50/50)");
        c.setPosition(-100, 0, 0);
        // 45° to reflect upward (+Y) and transmit forward (+X)
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        // Mirror A: at top-left, reflects the upward beam to the right
        const c = new Mirror(20, 2, "Mirror A");
        c.setPosition(-100, 80, 0);
        // Normal pointing down-right at 45° → reflects +Y beam to +X
        c.setRotation(0, 0, -Math.PI / 4);
        return c;
    })(),
    (() => {
        // Mirror B: at bottom-right, reflects the rightward beam upward
        const c = new Mirror(20, 2, "Mirror B");
        c.setPosition(0, 0, 0);
        // Normal pointing up-left at 45° → reflects +X beam to +Y
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        const c = new BeamSplitter(20, 2, 0.5, "BS2 (50/50)");
        c.setPosition(0, 80, 0);
        // 45° to recombine beams
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        const c = new Card(30, 30, "MZ Detector");
        c.setPosition(80, 80, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
];
