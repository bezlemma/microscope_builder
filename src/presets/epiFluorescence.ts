import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { Camera } from '../physics/components/Camera';
import { SpectralProfile } from '../physics/SpectralProfile';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Filter } from '../physics/components/Filter';

export const createEpiFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    const laser = new Laser("488 nm Laser");
    laser.setPosition(-350, -125, 0);
    laser.setRotation(0, 0, 0);
    laser.beamRadius = 2;       
    laser.wavelength = 488;   
    laser.power = 1.0;
    scene.push(laser);

    // We need to make the beam bigger if we are going to use it in widefield

    // Beam Expander - Element 1 (f = 50mm)
    const be1 = new SphericalLens(1/50.0, 15, 4, "Expander Lens 1 (f=50)");
    be1.setPosition(-300, -125, 0); // 50mm from Laser
    be1.setRotation(0, Math.PI / 2, 0);
    scene.push(be1);

    // Beam Expander - Element 2 (f = 100mm)
    const be2 = new SphericalLens(1/100.0, 25, 4, "Expander Lens 2 (f=100)");
    be2.setPosition(-150, -125, 0);
    be2.setRotation(0, Math.PI / 2, 0);
    scene.push(be2);

    // To achieve widefield illumination, the laser must be focused onto the Back Focal Plane (BFP)
    // of the objective.
    const exLens = new SphericalLens(1/100, 12.7, 3.6, "Focusing Lens", 51.5, 1e9, 1.517);
    exLens.setPosition(-83.2, -125, 0); // Front vertex at -85mm for precise focus
    exLens.setRotation(0, Math.PI / 2, 0); // local Z faces +X, matching beam direction
    scene.push(exLens);


    const dichroic = new DichroicMirror(
        25,     // diameter mm
        2,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  // sharp 5nm edge to cleanly separate 488/520
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, -125, 0);
    dichroic.setRotation(0, 0, Math.PI / 4);  // 45° in XY plane
    scene.push(dichroic);

    const sample = new Sample("Specimen (GFP)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(0, -180, 0);  // Sample sits exactly at y=-180
    sample.setRotation(0, 0, -Math.PI / 2);  // holder faces -Y (beam), ears +Z (up)
    scene.push(sample);

    const objective = new Objective({
        magnification: 10,
        NA: 0.30,
        workingDistance: 6.0,
        tubeLensFocal: 200,
        name: '10×/0.30 Objective'
    });
    // Objective principal plane must be exactly f = 200/10 = 20mm from sample
    // In local space, the focal plane is at Z = -f
    // With local -Z mapped to world -Y, placing the objective at y=-160 puts the focus exactly at y=-180
    objective.setPosition(0, -160, 0);
    objective.setRotation(-Math.PI / 2, 0, 0);  // local -Z → world -Y (faces sample)
    scene.push(objective);

    // ── Emission Filter (Barrier Filter) ──
    // Physically blocks 488nm excitation light from reaching the camera.
    // Placed between the objective and tube lens in the infinity space (e.g., at Y=15).
    const emissionFilter = new Filter(
        35, // diameter
        2,  // thickness
        new SpectralProfile('longpass', 515, [], 5), // blocks < 515nm
        "Emission Filter (LP 515)"
    );
    emissionFilter.setPosition(0, 15, 0);
    emissionFilter.setRotation(0, 0, Math.PI / 2); // local X (normal) faces world Y
    scene.push(emissionFilter);

    // A true Nikon tube lens is an extensive multi-element achromatic/apochromatic array.
    // We represent this using a standard 200mm Achromatic Doublet (Thorlabs AC254-200-A eq)
    // Element 1: Crown Glass (N-SSK5, n=1.658)
    const tubeLensCrown = new SphericalLens(0, 25.4, 4.0, "Tube Lens (Crown)", 77.4, -87.6, 1.658);
    tubeLensCrown.setPosition(0, 30, 0); 
    tubeLensCrown.setRotation(-Math.PI / 2, 0, 0);  // local Z -> world +Y
    scene.push(tubeLensCrown);
    
    // Gap of 0.01mm between optical cement faces to avoid coplanar tracing issues
    
    // Element 2
    const tubeLensFlint = new SphericalLens(0, 25.4, 2.5, "Tube Lens (Flint)", -87.6, 291.1, 1.750);
    tubeLensFlint.setPosition(0, 30 + 4.0 + 0.01, 0); 
    tubeLensFlint.setRotation(-Math.PI / 2, 0, 0); 
    scene.push(tubeLensFlint);

    const camera = new Camera(13, 13, "CMOS Sensor");
    // Back focal length (BFL) of this doublet is 196.4 mm from the back vertex.
    // Back vertex is at y = 30 + 4.0 + 0.01 + 2.5 = 36.51 mm.
    // Focal plane = 36.51 + 196.4 = 232.91 mm.
    camera.setPosition(0, 232.91, 0); 
    camera.setRotation(Math.PI / 2, 0, 0);  // local +Z → world -Y (sensor faces incoming light)
    
    // Tube lens aperture = 15mm, distance = 200mm. tan(theta) = 15/200 = 0.075. NA ~ 0.075.
    camera.sensorNA = 0.075;
    camera.samplesPerPixel = 64; // High sample count for a clean focused image

    scene.push(camera);

    return scene;
};
