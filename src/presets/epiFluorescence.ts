import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { Camera } from '../physics/components/Camera';
import { SpectralProfile } from '../physics/SpectralProfile';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Filter } from '../physics/components/Filter';

/**
 * Epi-Fluorescence Microscope — widefield fluorescence via back-illumination.
 *
 * Beam path:
 *   Laser (488 nm) → Beam Expander → Focusing Lens → Dichroic (reflects 488)
 *   → Objective → Sample → (emission 520 nm) → Objective → Dichroic (transmits 520)
 *   → Emission Filter → Tube Lens → Camera
 *
 * The dichroic separates excitation and emission by wavelength.
 * The objective serves as both condenser and collection optic.
 */
export function createEpiFluorescenceScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    const laser = new Laser("488 nm Laser");
    laser.setPosition(-350, -125, 0);
    laser.pointAlong(1, 0, 0);  // emit along +X
    laser.beamRadius = 2;       
    laser.wavelength = 488;   
    laser.power = 1.0;
    scene.push(laser);

    // We need to make the beam bigger if we are going to use it in widefield

    // Beam Expander - Element 1 (f = 50mm)
    const be1 = new SphericalLens(1/50.0, 15, 4, "Expander Lens 1 (f=50)");
    be1.setPosition(-300, -125, 0);
    be1.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(be1);

    // Beam Expander - Element 2 (f = 100mm)
    const be2 = new SphericalLens(1/100.0, 25, 4, "Expander Lens 2 (f=100)");
    be2.setPosition(-150, -125, 0);
    be2.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(be2);

    // To achieve widefield illumination, the laser must be focused onto the Back Focal Plane (BFP)
    // of the objective.
    const exLens = new SphericalLens(1/100, 12.7, 3.6, "Focusing Lens", 51.5, 1e9, 1.517);
    exLens.setPosition(-83.2, -125, 0);
    exLens.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(exLens);


    const dichroic = new DichroicMirror(
        25,     // diameter mm
        2,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  // sharp 5nm edge to cleanly separate 488/520
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, -125, 0);
    dichroic.setRotation(Math.PI / 2, -Math.PI / 4, 0); // 45° reflector
    scene.push(dichroic);

    const sample = new Sample("Specimen (GFP)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(0, -180, 0); 
    sample.pointAlong(0, 1, 0);  // faces +Y (towards objective above)
    scene.push(sample);

    const objective = new Objective({
        magnification: 10,
        NA: 0.30,
        workingDistance: 6.0,
        tubeLensFocal: 200,
        name: '10×/0.30 Objective'
    });
    objective.setPosition(0, -160, 0);
    objective.pointAlong(0, -1, 0);  // faces -Y (towards sample below)
    scene.push(objective);

   const emissionFilter = new Filter(
        35, // diameter
        2,  // thickness
        new SpectralProfile('longpass', 515, [], 5), // blocks < 515nm
        "Emission Filter (LP 515)"
    );
    emissionFilter.setPosition(0, 15, 0);
    emissionFilter.pointAlong(0, 1, 0);  // faces +Y (emission goes up)
    scene.push(emissionFilter);


    const tubeLensCrown = new SphericalLens(0, 25.4, 4.0, "Tube Lens (Crown)", 77.4, -87.6, 1.658);
    tubeLensCrown.setPosition(0, 30, 0); 
    tubeLensCrown.pointAlong(0, 1, 0);  // optical axis along +Y
    scene.push(tubeLensCrown);
    const tubeLensFlint = new SphericalLens(0, 25.4, 2.5, "Tube Lens (Flint)", -87.6, 291.1, 1.750);
    tubeLensFlint.setPosition(0, 33.26, 0); 
    tubeLensFlint.pointAlong(0, 1, 0);  // optical axis along +Y
    scene.push(tubeLensFlint);

    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(0, 230.91, 0); 
    camera.pointAlong(0, -1, 0);  // faces -Y (toward emission coming from below)
    
    // Tube lens aperture = 15mm, distance = 200mm. tan(theta) = 15/200 = 0.075. NA ~ 0.075.
    camera.sensorNA = 0.075;
    camera.samplesPerPixel = 64; // High sample count for a clean focused image

    scene.push(camera);

    return scene;
}
