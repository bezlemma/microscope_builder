import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';

/**
 * Lens Zoo — A showcase preset with multiple lens types and lasers.
 *
 * Layout (all along +X):
 *   Row 1 (y=30):  Laser 500nm → Biconvex → Biconcave → Plano-convex
 *   Row 2 (y=0):   Laser 550nm → Cylindrical
 *   Row 3 (y=-40): Laser 600nm → Prism (refraction + potential TIR)
 */
export function createLensZooScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // ── Row 1: Spherical lenses ──

    const laser1 = new Laser("Cyan Laser (500nm)");
    laser1.wavelength = 500;
    laser1.setPosition(-200, 30, 0);
    laser1.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser1);

    const biconvex = new SphericalLens(1 / 50, 15, 4, "Biconvex f=50mm");
    biconvex.setPosition(-100, 30, 0);
    biconvex.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(biconvex);

    const biconcave = new SphericalLens(-1 / 30, 15, 5, "Biconcave f=-30mm");
    biconcave.setPosition(0, 30, 0);
    biconcave.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(biconcave);

    const planoconvex = new SphericalLens(1 / 25, 12, 4, "Plano-convex f≈50mm", 1e9, -25, 1.5168);
    planoconvex.setPosition(100, 30, 0);
    planoconvex.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(planoconvex);

    // ── Row 2: Cylindrical lens ──

    const laser2 = new Laser("Green Laser (550nm)");
    laser2.wavelength = 550;
    laser2.setPosition(-200, 0, 0);
    laser2.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser2);

    const cyl = new CylindricalLens(40, 1e9, 12, 24, 3, "Cylindrical R=40mm", 1.5168);
    cyl.setPosition(-50, 0, 0);
    cyl.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(cyl);

    // ── Row 3: Prism ──

    const laser3 = new Laser("Orange Laser (600nm)");
    laser3.wavelength = 600;
    laser3.setPosition(-200, -40, 0);
    laser3.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser3);

    const prism = new PrismLens(Math.PI / 3, 25, 25, "60° Prism", 1.5168);
    prism.setPosition(-50, -40, 0);
    prism.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(prism);

    return scene;
}
