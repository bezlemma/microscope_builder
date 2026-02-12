import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Quaternion, Vector3 } from 'three';

/**
 * Prism Debug — Minimal reproduction scene for phantom ray investigation.
 * 
 * Layout:
 *   Laser (600nm) → Prism at 30° (Z-axis) → Spherical Lens (on upper split beam)
 */
export const createPrismDebugScene = (): OpticalComponent[] => [
    // Laser
    (() => {
        const c = new Laser("Orange Laser (600nm)");
        c.wavelength = 600;
        c.setPosition(-200, -40, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),

    // Equilateral prism rotated 30° about world Z axis
    (() => {
        const c = new PrismLens(Math.PI / 3, 25, 25, "60° Prism", 1.5168);
        c.setPosition(-50, -40, 0);
        // Compose: first base rotation Y(π/2) to face beam, then world-Z(30°)
        const baseQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        const worldZQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 30 * Math.PI / 180);
        const finalQuat = worldZQuat.multiply(baseQuat);
        c.rotation.copy(finalQuat);
        c.updateMatrices();
        return c;
    })(),

    // Spherical lens on the upper exit beam at user-specified position
    (() => {
        const c = new SphericalLens(1 / 50, 15, 4, "Biconvex f=50mm");
        c.setPosition(6.1, 33.04, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
];
