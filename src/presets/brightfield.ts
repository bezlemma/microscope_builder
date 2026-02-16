import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Lamp } from '../physics/components/Lamp';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';

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
export const createBrightfieldScene = (): OpticalComponent[] => {
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
    lamp.setPosition(-80, 0, 0);
    lamp.setRotation(0, 0, 0);
    lamp.beamRadius = 3;
    lamp.power = 1.0;
    scene.push(lamp);

    // 2. Condenser — plano-convex, f = 25 mm
    //    Focuses illumination onto the sample plane
    const condenser = new SphericalLens(1/25, 10, 4, "Condenser", 1e9, -12.5, 1.5);
    condenser.setPosition(-25, 0, 0);
    condenser.setRotation(0, Math.PI / 2, 0);
    scene.push(condenser);

    // 3. Sample — brightfield, no fluorescence metadata
    //    Image contrast from absorption/scattering (shadow imaging)
    const sample = new Sample("Specimen");
    // No excitationNm/emissionNm set — this triggers brightfield mode in Solver 3
    sample.setPosition(0, 0, 0);
    sample.setRotation(0, Math.PI / 2, 0);
    scene.push(sample);

    // 4. Objective — 10×/0.25, infinity-corrected (Nikon 200mm standard)
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

    // 5. Tube Lens — plano-convex, f = 200 mm (Nikon standard)
    const tubeLens = new SphericalLens(1/200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(220, 0, 0);
    tubeLens.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeLens);

    // 6. Camera — 13×13 mm sensor at tube lens BFP (220 + 200 = 420)
    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(420, 0, 0);
    camera.setRotation(0, -Math.PI / 2, 0);
    scene.push(camera);

    return scene;
};
