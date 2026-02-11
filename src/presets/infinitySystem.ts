import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Laser } from '../physics/components/Laser';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';

/**
 * Transmission Microscope — Nikon-style infinity-corrected brightfield setup.
 *
 * Light path (Köhler-style illumination):
 *   Laser → Condenser → Sample → Objective → [ Infinity Space ] → Tube Lens → Camera
 *
 * Nikon standard: tube lens focal length = 200 mm.
 * Objective: 10×/0.25 → f_obj = 200/10 = 20 mm.
 *
 * The condenser focuses the collimated laser beam to a point at the sample plane.
 * The sample (transmissive) sits at the front focal plane of the objective.
 * Diverging light from the sample is collimated by the objective into parallel
 * rays in the infinity space, then focused by the tube lens onto the camera.
 */
export const createTransmissionMicroscopeScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // --- Geometry ---
    //
    // Condenser:  plano-convex, f = 25 mm
    //   Plano-convex: R1 = ∞ (flat front), R2 = -(n-1)*f = -12.5 mm (convex back)
    //   1/f = (n-1)/|R2| = 0.5/12.5 = 0.04 → f = 25 mm  ✓
    //
    // Objective:  10×/0.25, f = tubeLensFocal/mag = 200/10 = 20 mm
    //   (uses thin-lens deflection formula internally)
    //
    // Tube Lens:  plano-convex, f = 200 mm  (Nikon standard)
    //   Plano-convex: R1 = ∞ (flat front), R2 = -(n-1)*f = -100 mm (convex back)
    //   1/f = (n-1)/|R2| = 0.5/100 = 0.005 → f = 200 mm  ✓
    //
    //  X: -80       -25          0       20                   220          420
    //      Laser     Condenser   Sample  Objective            TubeLens     Camera
    //      ═══▶      (|)         |██|    [OBJ]  ────────────  (|)          ▐██▌
    //                                            parallel rays
    //                                           (infinity space = 200mm)
    //
    //  Condenser focus: X_cond + f = -25 + 25 = X=0  (sample)  ✓
    //  Objective FFP:   X_obj  - f =  20 - 20 = X=0  (sample)  ✓
    //  Tube lens BFP:   X_tube + f = 220 + 200 = X=420 (camera) ✓

    // 1. Laser — collimated illumination beam
    const laser = new Laser("Illumination Source");
    laser.setPosition(-80, 0, 0);
    laser.setRotation(0, 0, 0);
    laser.beamRadius = 3;
    laser.wavelength = 550;
    scene.push(laser);

    // 2. Condenser — plano-convex, f = 25 mm
    //    R1 = ∞ (flat), R2 = -12.5 mm (convex)
    //    SphericalLens(curvature, aperture, thickness, name, r1, r2, ior)
    const condenser = new SphericalLens(1/25, 10, 4, "Condenser", 1e9, -12.5, 1.5);
    condenser.setPosition(-25, 0, 0);
    condenser.setRotation(0, Math.PI / 2, 0);
    scene.push(condenser);

    // 3. Sample — transmissive brightfield; at condenser focus = objective FFP
    const sample = new Sample("Specimen");
    sample.setPosition(0, 0, 0);
    sample.setRotation(0, Math.PI / 2, 0);
    scene.push(sample);

    // 4. Objective — 10×/0.25, infinity-corrected (Nikon 200mm standard)
    //    f = 200/10 = 20 mm.  FFP at X=20-20 = X=0 = sample. ✓
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
    //    R1 = ∞ (flat), R2 = -100 mm (convex)
    //    200mm infinity space between objective (X=20) and tube lens (X=220)
    const tubeLens = new SphericalLens(1/200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(220, 0, 0);
    tubeLens.setRotation(0, Math.PI / 2, 0);
    scene.push(tubeLens);

    // 6. Camera — at tube lens BFP  (220 + 200 = 420)
    const camera = new Camera(50, 25, "CMOS Sensor");
    camera.setPosition(420, 0, 0);
    camera.setRotation(0, -Math.PI / 2, 0);
    scene.push(camera);

    return scene;
};

