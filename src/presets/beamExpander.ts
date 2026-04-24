import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';

/**
 * Beam Expander — side-by-side comparison of the two classic designs.
 *
 * Both expanders target 2× magnification with f1 = 50 mm and f2 = 100 mm.
 *
 *   Top row (+Y):  Keplerian — two converging lenses, separation = f1 + f2 = 150 mm.
 *                  Real intermediate focus between the lenses (visible as a waist).
 *
 *   Bottom row (-Y): Galilean — diverging input lens (f = -50 mm) + converging
 *                    output lens (f = +100 mm), separation = f2 - |f1| = 50 mm.
 *                    Shorter, no internal focus, higher power handling.
 *
 * Both are afocal: a collimated input beam exits collimated and 2× wider.
 */
export function createBeamExpanderScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // ── Row 1 (Keplerian) at Y = +40 ──────────────────────────────────
    const laserK = new Laser("Keplerian Laser (Cyan, 490nm)");
    laserK.wavelength = 490;
    laserK.setPosition(-150, 40, 0);
    laserK.pointAlong(1, 0, 0);
    scene.push(laserK);

    const kepL1 = new SphericalLens(1 / 50.0, 15, 4, "Keplerian Lens 1 (f=+50)");
    kepL1.setPosition(-100, 40, 0);
    kepL1.pointAlong(1, 0, 0);
    scene.push(kepL1);

    const kepL2 = new SphericalLens(1 / 100.0, 25, 4, "Keplerian Lens 2 (f=+100)");
    kepL2.setPosition(50, 40, 0);
    kepL2.pointAlong(1, 0, 0);
    scene.push(kepL2);

    // ── Row 2 (Galilean) at Y = -40 ───────────────────────────────────
    const laserG = new Laser("Galilean Laser (Orange, 605nm)");
    laserG.wavelength = 605;
    laserG.setPosition(-150, -40, 0);
    laserG.pointAlong(1, 0, 0);
    scene.push(laserG);

    // Diverging input: plano-concave with f = -50 mm.
    // Lensmaker (thin, n = 1.5168, R2 = ∞): 1/f = (n-1)/R1 → R1 = (n-1)·f = -25.84 mm.
    const galL1 = new SphericalLens(
        -1 / 50.0, 15, 3,
        "Galilean Lens 1 (f=-50)",
        -25.84, 1e9, 1.5168,
    );
    galL1.setPosition(-100, -40, 0);
    galL1.pointAlong(1, 0, 0);
    scene.push(galL1);

    // Converging output at f2 - |f1| = 50 mm from the diverging lens.
    const galL2 = new SphericalLens(1 / 100.0, 25, 4, "Galilean Lens 2 (f=+100)");
    galL2.setPosition(-50, -40, 0);
    galL2.pointAlong(1, 0, 0);
    scene.push(galL2);

    return scene;
}
