import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { PrismLens } from '../physics/components/PrismLens';

/**
 * Lens Zoo — A showcase preset with multiple lens types and lasers.
 * 
 * Layout (along world X axis):
 *   Row 1: Laser (500nm) → Biconvex → Biconcave → Plano-convex
 *   Row 2: Laser (550nm) → Cylindrical
 *   Row 3: Laser (600nm) → Prism (refraction + potential TIR)
 */
export const createLensZooScene = (): OpticalComponent[] => [
    (() => {
        const c = new Laser("Cyan Laser (500nm)");
        c.wavelength = 500;
        c.setPosition(-200, 30, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new SphericalLens(1 / 50, 15, 4, "Biconvex f=50mm");
        c.setPosition(-100, 30, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new SphericalLens(-1 / 30, 15, 5, "Biconcave f=-30mm");
        c.setPosition(0, 30, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new SphericalLens(1 / 25, 12, 4, "Plano-convex f≈50mm", 1e9, -25, 1.5168);
        c.setPosition(100, 30, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new Laser("Green Laser (550nm)");
        c.wavelength = 550;
        c.setPosition(-200, 0, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new CylindricalLens(40, 1e9, 12, 24, 3, "Cylindrical R=40mm", 1.5168);
        c.setPosition(-50, 0, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    (() => {
        const c = new Laser("Orange Laser (600nm)");
        c.wavelength = 600;
        c.setPosition(-200, -40, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),
    (() => {
        const c = new PrismLens(Math.PI / 3, 25, 25, "60° Prism", 1.5168);
        c.setPosition(-50, -40, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
];
