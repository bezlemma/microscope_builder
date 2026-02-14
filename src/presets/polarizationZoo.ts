import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Card } from '../physics/components/Card';
import { Waveplate } from '../physics/components/Waveplate';
import { Mirror } from '../physics/components/Mirror';
import { BeamSplitter } from '../physics/components/BeamSplitter';

/**
 * Polarization Zoo Preset — stress-test demos for the optics engine
 * 
 * Path 1 (top):    Mach-Zehnder Interferometer
 *   Laser → BS1 → Mirror_A (reflected arm) + Mirror_B (transmitted arm) → BS2 → Card
 *   Tests: OPL accumulation, beam splitting, coherent recombination, interference fringes
 *   Expected: Card shows interference pattern that shifts if a mirror is moved
 *
 * Path 2 (middle): Crossed Polarizers with Waveplate
 *   Laser → Polarizer@0° → λ/4@45° → Polarizer@90° → Card
 *   Tests: Jones matrix chain accuracy — the waveplate converts
 *   linear→circular→linear(rotated), allowing light through "crossed" polarizers
 *   Expected: ~50% transmission through otherwise-blocking configuration
 *
 * Path 3 (bottom): Two-Beam Coherent Overlap
 *   Laser_A + Laser_B (same λ, slight vertical offset) → Card
 *   Tests: Multi-beam card rendering, spatial overlap, coherent interference
 *   Expected: Where beams overlap, interference fringes appear
 */
export const createPolarizationZooScene = (): OpticalComponent[] => [

    // ═══ Path 1: Mach-Zehnder Interferometer ═══
    //
    //  Laser ──→ BS1 ──(transmitted)──→ Mirror_B ──→ (down)
    //               │                                    │
    //          (reflected, up)                            │
    //               │                                    ↓
    //          Mirror_A ──→ (right) ──→ BS2 ──→ Card
    //
    // Layout (all at z=0, XY plane):
    //   Laser at x=-200, y=80
    //   BS1   at x=-100, y=80  (45° → reflects up)
    //   Mirror_A at x=-100, y=160 (reflects right)
    //   Mirror_B at x=0, y=80   (reflects down → toward BS2)
    //   BS2   at x=0, y=160    (recombines beams → Card)
    //   Card  at x=80, y=160

    (() => {
        const c = new Laser("MZ Laser (532nm)");
        c.wavelength = 532;
        c.power = 1.0;
        c.setPosition(-200, 80, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new BeamSplitter(20, 2, 0.5, "BS1 (50/50)");
        c.setPosition(-100, 80, 0);
        // 45° to reflect upward (+Y) and transmit forward (+X)
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        // Mirror A: at top-left, reflects the upward beam to the right
        const c = new Mirror(20, 2, "Mirror A");
        c.setPosition(-100, 160, 0);
        // Normal pointing down-right at 45° → reflects +Y beam to +X
        c.setRotation(0, 0, -Math.PI / 4);
        return c;
    })(),
    (() => {
        // Mirror B: at bottom-right, reflects the rightward beam upward
        const c = new Mirror(20, 2, "Mirror B");
        c.setPosition(0, 80, 0);
        // Normal pointing up-left at 45° → reflects +X beam to +Y
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        const c = new BeamSplitter(20, 2, 0.5, "BS2 (50/50)");
        c.setPosition(0, 160, 0);
        // 45° to recombine beams
        c.setRotation(0, 0, 3 * Math.PI / 4);
        return c;
    })(),
    (() => {
        const c = new Card(30, 30, "MZ Detector");
        c.setPosition(80, 160, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    // ═══ Path 2: Crossed Polarizers with λ/4 Waveplate ═══
    //
    //  Laser → Pol@0° → λ/4@45° → Pol@90° → Card
    //
    //  Without the waveplate, crossed polarizers would block all light.
    //  The λ/4 plate converts horizontal linear → circular, and the
    //  second polarizer projects the circular state onto its axis.
    //  Result: ~50% of photons pass through (not blocked!).
    //  This is the quantum eraser concept in classical optics.

    (() => {
        const c = new Laser("Crossed Pol Laser");
        c.wavelength = 632;  // HeNe red
        c.power = 1.0;
        c.setPosition(-200, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        // First polarizer: horizontal (0°)
        const c = new Waveplate('polarizer', 12.5, 0, 'Pol @ 0°');
        c.setPosition(-120, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        // λ/4 plate at 45°: converts linear → circular
        const c = new Waveplate('quarter', 12.5, Math.PI / 4, 'λ/4 @ 45°');
        c.setPosition(-50, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        // Second polarizer: vertical (90°) — "crossed" with the first
        const c = new Waveplate('polarizer', 12.5, Math.PI / 2, 'Pol @ 90°');
        c.setPosition(20, -20, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Card(20, 20, "Crossed Pol Card");
        c.setPosition(100, -20, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    // ═══ Path 3: Two-Beam Coherent Overlap ═══
    //
    //  Laser_A (532nm, y=-100) ──→ Card (shared)
    //  Laser_B (532nm, y=-110) ──→ Card (shared)
    //
    //  Both lasers are same λ, slightly offset vertically.
    //  Where beams overlap on the card, coherent interference
    //  should produce fringes based on OPL difference.
    //  Tests: multi-beam card profiling, spatial overlap detection.

    (() => {
        const c = new Laser("Overlap Laser A");
        c.wavelength = 532;
        c.power = 1.0;
        c.setPosition(-150, -100, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Laser("Overlap Laser B");
        c.wavelength = 532;
        c.power = 1.0;
        c.setPosition(-150, -115, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new Card(30, 30, "Overlap Card");
        c.setPosition(50, -107, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })()
];
