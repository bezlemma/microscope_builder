import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';

/**
 * Beam Expander — Galilean 2× beam expander.
 *
 * Beam path (along +X):
 *   Laser → Diverging Lens (f=50) → Collimating Lens (f=100) → expanded beam
 *
 * Separation is f1 + f2 = 50 + 100 = 150mm for an afocal system.
 */
export function createBeamExpanderScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    const laser = new Laser("Green Laser (532nm)");
    laser.setPosition(-150, 0, 0);
    laser.pointAlong(1, 0, 0);  // emit along +X
    scene.push(laser);

    const lens1 = new SphericalLens(1 / 50.0, 15, 4, "Expander Lens 1 (f=50)");
    lens1.setPosition(-100, 0, 0);
    lens1.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(lens1);

    const lens2 = new SphericalLens(1 / 100.0, 25, 4, "Expander Lens 2 (f=100)");
    lens2.setPosition(50, 0, 0);
    lens2.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(lens2);

    return scene;
}
