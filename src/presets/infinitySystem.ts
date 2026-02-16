import { OpticalComponent } from '../physics/Component';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SpectralProfile } from '../physics/SpectralProfile';

/**
 * Transmission Fluorescence Microscope — GFP imaging in transmission geometry.
 *
 * Light path:
 *   Laser (488 nm) → Condenser → Sample → Objective → [ Em Filter ] → Tube Lens → Camera
 *
 * Nikon standard: tube lens focal length = 200 mm.
 * Objective: 10×/0.25 → f_obj = 200/10 = 20 mm.
 *
 * The laser excites fluorophores in the sample. Emission is collected
 * in the forward (transmission) direction through the objective.
 */
export const createTransFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // --- Geometry ---
    //
    // Condenser:  plano-convex, f = 25 mm
    //   Plano-convex: R1 = ∞ (flat front), R2 = -12.5 mm (convex back)
    //   1/f = (n-1)/|R2| = 0.5/12.5 = 0.04 → f = 25 mm  ✓
    //
    // Objective:  10×/0.25, f = tubeLensFocal/mag = 200/10 = 20 mm
    //   (uses thin-lens deflection formula internally)
    //
    // Tube Lens:  plano-convex, f = 200 mm  (Nikon standard)
    //   Plano-convex: R1 = ∞ (flat front), R2 = -100 mm (convex back)
    //   1/f = (n-1)/|R2| = 0.5/100 = 0.005 → f = 200 mm  ✓
    //
    //  X: -80       -25          0       20                   220          420
    //      Laser     Condenser   Sample  Objective   EmFilter     TubeLens     Camera
    //      ═══▶      (|)         |██|    [OBJ]  ──── |F| ────────  (|)          ▐██▌
    //                                            parallel rays
    //                                           (infinity space = 200mm)
    //
    //  Condenser focus: X_cond + f = -25 + 25 = X=0  (sample)  ✓
    //  Objective FFP:   X_obj  - f =  20 - 20 = X=0  (sample)  ✓
    //  Tube lens BFP:   X_tube + f = 220 + 200 = X=420 (camera) ✓

    // 1. Laser — 488 nm excitation for GFP fluorescence
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-80, 0, 0);
    laser.setRotation(0, 0, 0);
    laser.beamRadius = 3;
    laser.wavelength = 488;
    scene.push(laser);

    // 2. Condenser — plano-convex, f = 25 mm
    //    R1 = ∞ (flat), R2 = -12.5 mm (convex)
    //    SphericalLens(curvature, aperture, thickness, name, r1, r2, ior)
    const condenser = new SphericalLens(1/25, 10, 4, "Condenser", 1e9, -12.5, 1.5);
    condenser.setPosition(-25, 0, 0);
    condenser.setRotation(0, Math.PI / 2, 0);
    scene.push(condenser);

    // 3. Sample — GFP fluorescence; at condenser focus = objective FFP
    const sample = new Sample("Specimen (GFP)");
    sample.excitationNm = 488;
    sample.emissionNm = 520;
    sample.excitationBandwidth = 30;
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

    // 6. Emission Filter — longpass 505 nm in infinity space
    //    Blocks 488 nm excitation laser, passes 520 nm GFP emission
    const emFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  // sharp 5nm edge
        "Em Filter (LP 505)"
    );
    emFilter.setPosition(120, 0, 0);
    emFilter.setRotation(0, 0, 0);  // local X already along +X (faces beam)
    scene.push(emFilter);

    // 6. Camera — at tube lens BFP  (220 + 200 = 420)
    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(420, 0, 0);
    camera.setRotation(0, -Math.PI / 2, 0);
    scene.push(camera);

    return scene;
};

