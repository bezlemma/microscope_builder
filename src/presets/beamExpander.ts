import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { SphericalLens } from '../physics/components/SphericalLens';

export const createBeamExpanderScene = (): OpticalComponent[] => [
    // Laser Source
    (() => {
        const c = new Laser("Green Laser (532nm)");
        c.setPosition(-150, 0, 0); // Start on the left
        c.setRotation(0, 0, 0);
        return c;
    })(),
    // Beam Expander - Element 1 (f = 50mm)
    (() => {
        const c = new SphericalLens(1/50.0, 15, 4, "Expander Lens 1 (f=50)");
        c.setPosition(-100, 0, 0); // 50mm from Laser
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    // Beam Expander - Element 2 (f = 100mm)
    // Separation for afocal = f1 + f2 = 50 + 100 = 150mm.
    // Pos = -100 + 150 = 50mm.
    (() => {
        const c = new SphericalLens(1/100.0, 25, 4, "Expander Lens 2 (f=100)");
        c.setPosition(50, 0, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })()
];
