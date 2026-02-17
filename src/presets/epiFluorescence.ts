import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { SpectralProfile } from '../physics/SpectralProfile';


export const createEpiFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];


    const laser = new Laser("488 nm Laser");
    laser.setPosition(-200, -125, 0);
    laser.setRotation(0, 0, 0);  // default: fires +X
    laser.beamRadius = 2;
    laser.wavelength = 488;      // nm — blue
    laser.power = 1.0;
    scene.push(laser);


    const exFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('bandpass', 480, [{ center: 480, width: 20 }]),
        "Ex Filter (BP 480/20)"
    );
    exFilter.setPosition(-75, -125, 0);
    exFilter.setRotation(0, 0, 0);  // local X faces +X beam
    scene.push(exFilter);

    const dichroic = new DichroicMirror(
        25,     // diameter mm
        2,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  // sharp 5nm edge to cleanly separate 488/520
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, -125, 0);
    dichroic.setRotation(0, 0, Math.PI / 4);  // 45° in XY plane
    scene.push(dichroic);

    const objective = new Objective({
        magnification: 20,
        NA: 0.65,
        workingDistance: 5,
        tubeLensFocal: 200,
        name: '20×/0.65 Objective'
    });
    objective.setPosition(0, -155, 0);
    objective.setRotation(Math.PI / 2, 0, 0);  // local Z → world -Y
    scene.push(objective);

    const sample = new Sample("Specimen (GFP)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(0, -160, 0);  // f = 5mm from objective at y=-155
    sample.setRotation(0, 0, -Math.PI / 2);  // holder faces -Y (beam), ears +Z (up)
    scene.push(sample);

    const tubeLens = new SphericalLens(1 / 200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(0, -50, 0);
    tubeLens.setRotation(-Math.PI / 2, 0, 0);  // local Z → world +Y
    scene.push(tubeLens);

    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(0, 150, 0);
    camera.setRotation(Math.PI / 2, 0, 0);  // local +Z → world -Y (sensor faces incoming light)
    scene.push(camera);

    return scene;
};
