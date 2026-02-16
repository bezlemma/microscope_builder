import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Lamp } from '../physics/components/Lamp';
import { SphericalLens } from '../physics/components/SphericalLens';
import { PrismLens } from '../physics/components/PrismLens';
import { Quaternion, Vector3 } from 'three';

export const createPrismDebugScene = (): OpticalComponent[] => [
    // Laser
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
        const baseQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        const worldZQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 30 * Math.PI / 180);
        const finalQuat = worldZQuat.multiply(baseQuat);
        c.rotation.copy(finalQuat);
        c.updateMatrices();
        return c;
    })(),

    (() => {
        const c = new SphericalLens(1 / 50, 15, 4, "Biconvex f=50mm");
        c.setPosition(6.1, 33.04, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),

    // ─── White Light Rainbow ───
    (() => {
        const c = new Lamp("White Light Source");
        c.beamRadius = 1;
        c.power = 1.0;
        c.setPosition(-200, -120, 0);
        c.setRotation(0, 0, 0);
        return c;
    })(),

    (() => {
        const c = new PrismLens(Math.PI / 3, 30, 25, "Rainbow Prism", 1.65);
        c.setPosition(-128, -130, 0);
        const baseQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        const tiltQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -45 * Math.PI / 180);
        const finalQuat = tiltQuat.multiply(baseQuat);
        c.rotation.copy(finalQuat);
        c.updateMatrices();
        return c;
    })(),
];
