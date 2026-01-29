import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Sample } from '../physics/components/Sample';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Objective } from '../physics/components/Objective';

export const createInfinitySystemScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // 1. Light Source (Laser)
    const laser = new Laser("Green Laser (532nm)");
    laser.setPosition(-50, 0, 0); // Start at X=-50
    scene.push(laser);

    // 2. Sample (Mickey Mouse) - Placed at Focus
    // We want the light to hit the sample.
    // Laser emits at +X.
    const sample = new Sample("Mickey Sample");
    sample.setPosition(0, 0, 0);
    // Align Sample to be "Standing Up" in XY plane (Normal along X)
    sample.setRotation(0, Math.PI / 2, 0);
    scene.push(sample);

    // 3. Objective (Multi-element Composite)
    // Objective f_eff ~ 10mm. Working Distance ~ 2-5mm.
    // Placed at X=10.
    // Built-in elements: Front (-5 => X=5), Rear (+5 => X=15).
    const objective = new Objective(10, "20x Objective");
    objective.setPosition(10, 0, 0);
    objective.setRotation(0, Math.PI / 2, 0); // Face X
    scene.push(objective);
    
    // Lenses combined power approx 1/10? 1/15 + 1/30 - d...
    // Just illustrative for now.

    // 4. Tube Lens (Achromatic Doublet)
    // Spaced 150mm from Objective.
    const tubePos = 160;
    
    // Element A (Positive) f=100
    const tubeA = new SphericalLens(1/100, 25, 4, "Tube Element A");
    tubeA.setPosition(tubePos, 0, 0);
    tubeA.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeA);

    // Element B (Negative/Corrector) f=-200
    const tubeB = new SphericalLens(-1/200, 25, 2, "Tube Element B");
    tubeB.setPosition(tubePos + 5, 0, 0); // Cemented doublet? Closely spaced.
    tubeB.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeB);

    // 5. Camera
    // Focal length of tube doublet ~ 200mm? (1/100 + -1/200 = 1/200).
    // Camera at TubePos + f = 160 + 200 = 360mm.
    const camera = new Camera(50, 25, "CMOS Sensor");
    camera.setPosition(360, 0, 0);
    camera.setRotation(0, -Math.PI / 2, 0); // Face -X
    scene.push(camera);

    return scene;
};
