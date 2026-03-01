import { OpticalComponent } from '../physics/Component';
import { Laser } from '../parts/Laser';
import { Lamp } from '../parts/Lamp';
import { SphericalLens } from '../parts/SphericalLens';
import { PrismLens } from '../parts/PrismLens';
import { Quaternion, Vector3 } from 'three';

/**
 * Prism Debug — Two prism demonstrations.
 *
 * Path 1 (y=-40):  Orange laser → tilted 60° prism → focusing lens
 * Path 2 (y=-120): White lamp → tilted 60° prism → rainbow dispersion
 */
export function createPrismDebugScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // ── Path 1: Single wavelength ──

    const laser = new Laser("Orange Laser (600nm)");
    laser.wavelength = 600;
    laser.setPosition(-200, -40, 0);
    laser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser);

    // Prism with Z-axis tilt (X-forward: triangle already in XY plane)
    const prism1 = new PrismLens(Math.PI / 3, 25, 25, "60° Prism", 1.5168);
    prism1.setPosition(-50, -40, 0);
    const tiltQuat1 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 30 * Math.PI / 180);
    prism1.rotation.copy(tiltQuat1);
    prism1.version++;
    scene.push(prism1);

    const lens = new SphericalLens(1 / 50, 15, 4, "Biconvex f=50mm");
    lens.setPosition(6.1, 33.04, 0);
    lens.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(lens);

    // ── Path 2: White light rainbow ──

    const lamp = new Lamp("White Light Source");
    lamp.beamRadius = 1;
    lamp.power = 1.0;
    lamp.setPosition(-200, -120, 0);
    lamp.pointAlong(1, 0, 0);  // emit along +X
    scene.push(lamp);

    // Prism with Z-axis tilt (X-forward: triangle already in XY plane)
    const prism2 = new PrismLens(Math.PI / 3, 30, 25, "Rainbow Prism", 1.65);
    prism2.setPosition(-128, -130, 0);
    const tiltQuat2 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -45 * Math.PI / 180);
    prism2.rotation.copy(tiltQuat2);
    prism2.version++;
    scene.push(prism2);

    return scene;
}
