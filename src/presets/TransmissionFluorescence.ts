import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Aperture } from '../physics/components/Aperture';
import { Camera } from '../physics/components/Camera';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SpectralProfile } from '../physics/SpectralProfile';

/**
 * Transmission Fluorescence Microscope — laser-excited fluorescence imaging.
 *
 * Beam path (along +X):
 *   Laser (488 nm) → Focusing Lens → Condenser → Sample → Objective
 *   → Emission Filter → Tube Lens → Camera
 *
 * Excitation is delivered through the condenser (trans-illumination).
 * The emission filter blocks excitation light, passing only fluorescence
 * to the camera.
 */
export function createTransFluorescenceScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // 1. Laser — 488 nm excitation for GFP fluorescence
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-100, 0, 0); 
    laser.pointAlong(1, 0, 0);  // emit along +X
    laser.beamRadius = 2;
    laser.wavelength = 488;
    scene.push(laser);

    // 2. Focusing Lens — a plano-convex lens (f=25mm) to create a point source for Köhler illumination
    const focusingLens = new SphericalLens(1/25, 25.4, 5.3, "Focusing Lens (LA1560-A eq)", 12.9, 1e9, 1.517);
    focusingLens.setPosition(-53.32, 0, 0);
    focusingLens.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(focusingLens);

    // 3. Abbe Condenser Assembly
    //   A. Aperture Diaphragm - Placed exactly at the condenser's front focal plane (x = -29.17)
    //      This acts as the aperture diaphragm in Köhler illumination, creating perfectly collimated widefield light.
    const aperture = new Aperture(5, 25, "Condenser Iris");
    aperture.setPosition(-29.17, 0, 0);
    aperture.pointAlong(1, 0, 0);  // faces along beam
    scene.push(aperture);

    //   B. Condenser Lens 1 (Rear) - flat surface faces laser, curved surface faces sample
    const condenser1 = new SphericalLens(1/30, 25.4, 5.0, "Condenser Element 1", 1e9, -15, 1.5);
    condenser1.setPosition(-25, 0, 0);
    condenser1.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(condenser1);

    //   C. Condenser Lens 2 (Front) - curved surface faces laser, flat surface faces sample
    const condenser2 = new SphericalLens(1/15, 25.4, 5.0, "Condenser Element 2", 7.5, 1e9, 1.5);
    condenser2.setPosition(-15, 0, 0);
    condenser2.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(condenser2);

    // 3. Sample — GFP fluorescence; at condenser focus = objective FFP
    const sample = new Sample("Specimen (GFP)");
    sample.excitationSpectrum = new SpectralProfile('bandpass', 500, [{ center: 488, width: 30 }]);
    sample.emissionSpectrum = new SpectralProfile('bandpass', 500, [{ center: 520, width: 40 }]);
    sample.setPosition(0, 0, 0);
    sample.pointAlong(-1, 0, 0);  // faces -X (towards beam)
    scene.push(sample);

    // 4. Objective — 10×/0.25, infinity-corrected (200mm standard)
    const objective = new Objective({
        magnification: 10,
        NA: 0.25,
        workingDistance: 10.6,
        tubeLensFocal: 200,
        name: '10×/0.25 Objective'
    });
    objective.setPosition(20, 0, 0);
    objective.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(objective);

    // A true Nikon tube lens is an extensive multi-element achromatic/apochromatic array.
    // We represent this using a standard 200mm Achromatic Doublet (Thorlabs AC254-200-A eq)
    // Element 1: Crown Glass (N-SSK5, n=1.658)
    const tubeLensCrown = new SphericalLens(0, 25.4, 4.0, "Tube Lens (Crown)", 77.4, -87.6, 1.658);
    tubeLensCrown.setPosition(220, 0, 0); 
    tubeLensCrown.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(tubeLensCrown);
    
    // Gap of 0.01mm between optical cement faces to avoid coplanar tracing issues
    
    // Element 2: Flint Glass (N-SF7, n=1.750)
    // Crown center is 220. Thickness 4.0. Back vertex is 222.
    // Gap 0.01. Flint front is 222.01. Thickness 2.5. Center is 223.26.
    const tubeLensFlint = new SphericalLens(0, 25.4, 2.5, "Tube Lens (Flint)", -87.6, 291.1, 1.750);
    tubeLensFlint.setPosition(223.26, 0, 0); 
    tubeLensFlint.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(tubeLensFlint);

    // 6. Emission Filter — longpass 505 nm in infinity space
    const emFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  
        "Em Filter (LP 505)"
    );
    emFilter.setPosition(120, 0, 0);
    emFilter.pointAlong(-1, 0, 0);  // faces -X (towards beam)
    scene.push(emFilter);

    // 6. Camera — at tube lens BFP  
    const camera = new Camera(13, 13, "CMOS Sensor");
    // Back focal length (BFL) of this doublet is 196.4 mm from the back vertex.
    // Back vertex is at x = 223.26 + 1.25 = 224.51 mm.
    // Focal plane = 224.51 + 196.4 = 420.91 mm.
    camera.setPosition(420.91, 0, 0);
    camera.pointAlong(-1, 0, 0);  // faces -X (towards incoming beam)
    scene.push(camera);

    return scene;
}

