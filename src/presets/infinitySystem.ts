import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SpectralProfile } from '../physics/SpectralProfile';


export const createTransFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // 1. Laser — 488 nm excitation for GFP fluorescence
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-80, 0, 0);
    laser.setRotation(0, 0, 0);
    laser.beamRadius = 3;
    laser.wavelength = 488;
    scene.push(laser);

    // 3. Sample — GFP fluorescence; at condenser focus = objective FFP
    const sample = new Sample("Specimen (GFP)");
    sample.excitationNm = 488;
    sample.emissionNm = 520;
    sample.excitationBandwidth = 30;
    sample.setPosition(0, 0, 0);
    sample.setRotation(0, Math.PI / 2, 0);
    scene.push(sample);

    // 4. Objective — 10×/0.25, infinity-corrected (200mm standard)
    const objective = new Objective({
        magnification: 10,
        NA: 0.25,
        workingDistance: 20,
        tubeLensFocal: 200,
        name: '10×/0.25 Objective'
    });
    objective.setPosition(20, 0, 0);
    objective.setRotation(0, Math.PI / 2, 0);
    scene.push(objective);

    // 5. Tube Lens — plano-convex, f = 200 mm
    const tubeLens = new SphericalLens(1/200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(220, 0, 0);
    tubeLens.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeLens);

    // 6. Emission Filter — longpass 505 nm in infinity space
    const emFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  
        "Em Filter (LP 505)"
    );
    emFilter.setPosition(120, 0, 0);
    emFilter.setRotation(0, 0, 0);  
    scene.push(emFilter);

    // 6. Camera — at tube lens BFP  (220 + 200 = 420)
    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(420, 0, 0);
    camera.setRotation(0, -Math.PI / 2, 0);
    scene.push(camera);

    return scene;
};

