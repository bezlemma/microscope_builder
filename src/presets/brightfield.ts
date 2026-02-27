import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Lamp } from '../physics/components/Lamp';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { Aperture } from '../physics/components/Aperture';

/**
 * Brightfield Microscope — absorption/shadow imaging with white light.
 *
 * Light path (Köhler-style illumination):
 *   LED (550 nm) → Condenser → Sample → Objective → [ Infinity Space ] → Tube Lens → Camera
 *
 * Nikon standard: tube lens focal length = 200 mm.
 * Objective: 10×/0.25 → f_obj = 200/10 = 20 mm.
 *
 * The condenser focuses the collimated beam to illuminate the sample.
 * The sample absorbs/scatters light, creating a shadow image.
 * The objective collects the transmitted light, and the tube lens
 * focuses it onto the camera sensor.
 *
 * Unlike fluorescence, there is no wavelength shift — the image contrast
 * comes from absorption and scattering by the sample.
 */
export function createBrightfieldScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // --- Geometry ---
    //
    //  X: -80       -25          0       20                   220          420
    //      LED       Condenser   Sample  Objective            TubeLens     Camera
    //      ═══▶      (|)         |██|    [OBJ]  ────────────  (|)          ▐██▌
    //                                            parallel rays
    //                                           (infinity space = 200mm)

    // 1. Lamp — broadband white light source (7-band ROYGBIV)
    const lamp = new Lamp("White Light Source");
    lamp.setPosition(-100, 0, 0);
    lamp.pointAlong(1, 0, 0);  // emit along +X
    lamp.beamRadius = 3;
    lamp.power = 1.0;
    scene.push(lamp);

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

    //   B. Condenser Lens 1 (Rear) - flat surface faces lamp, curved surface faces sample
    const condenser1 = new SphericalLens(1/30, 25.4, 5.0, "Condenser Element 1", 1e9, -15, 1.5);
    condenser1.setPosition(-25, 0, 0);
    condenser1.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(condenser1);

    //   C. Condenser Lens 2 (Front) - curved surface faces lamp, flat surface faces sample
    const condenser2 = new SphericalLens(1/15, 25.4, 5.0, "Condenser Element 2", 7.5, 1e9, 1.5);
    condenser2.setPosition(-15, 0, 0);
    condenser2.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(condenser2);

    // 4. Sample — brightfield, no fluorescence metadata
    //    Image contrast from absorption/scattering (shadow imaging)
    const sample = new Sample("Specimen");
    // Disable fluorescence completely so it acts purely as an absorption shadow
    sample.fluorescenceEfficiency = 0;
    sample.setPosition(0, 0, 0);
    sample.pointAlong(-1, 0, 0);  // faces -X (towards beam)
    scene.push(sample);

    // 5. Objective — 10×/0.25, infinity-corrected (Nikon 200mm standard)
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

    // 6. Tube Lens — Achromatic Doublet (Thorlabs AC254-200-A eq)
    // Element 1: Crown Glass (N-SSK5, n=1.658)
    const tubeLensCrown = new SphericalLens(0, 25.4, 4.0, "Tube Lens (Crown)", 77.4, -87.6, 1.658);
    tubeLensCrown.setPosition(220, 0, 0); 
    tubeLensCrown.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(tubeLensCrown);
    
    // Element 2: Flint Glass (N-SF7, n=1.750)
    // Crown center is 220. Thickness 4.0. Back vertex is 222.
    // Gap 0.01. Flint front is 222.01. Thickness 2.5. Center is 223.26.
    const tubeLensFlint = new SphericalLens(0, 25.4, 2.5, "Tube Lens (Flint)", -87.6, 291.1, 1.750);
    tubeLensFlint.setPosition(223.26, 0, 0); 
    tubeLensFlint.pointAlong(1, 0, 0);  // optical axis along +X
    scene.push(tubeLensFlint);

    // 7. Camera — at tube lens BFP  
    const camera = new Camera(13, 13, "CMOS Sensor");
    // Back focal length (BFL) of this doublet is 196.4 mm from the back vertex.
    // Back vertex is at x = 223.26 + 1.25 = 224.51 mm.
    // Focal plane = 224.51 + 196.4 = 420.91 mm.
    camera.setPosition(420.91, 0, 0);
    camera.pointAlong(-1, 0, 0);  // faces -X (towards incoming beam)
    scene.push(camera);

    return scene;
}
