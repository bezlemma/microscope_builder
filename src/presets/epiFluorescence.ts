import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { SpectralProfile } from '../physics/SpectralProfile';

/**
 * Epi-Fluorescence Microscope — GFP imaging configuration.
 *
 * Coordinate convention:
 *   Z is perpendicular to the optical table (up)
 *   XY is the plane of the table — all components sit at z=0
 *
 * Excitation path (horizontal → vertical):
 *   Laser (488 nm, +X) → Ex Filter → Dichroic (45°, reflects to -Y)
 *     → Objective → Sample
 *
 * Emission path (vertical, +Y):
 *   Sample → Objective → Dichroic (transmits green, +Y)
 *     → Tube Lens → Em Filter → Camera
 *
 * Local axis conventions:
 *   - Filter, DichroicMirror: optical axis = local X (plane at x=0)
 *   - Objective, SphericalLens, Camera: optical axis = local Z (plane at z=0)
 *
 * Layout (top-down view of table, Y vertical on screen):
 *
 *                Camera  (0, 340)
 *                  │
 *              Em Filter (0, 280)
 *                  │
 *              Tube Lens (0, 160)
 *                  │  (+Y, emission transmits through dichroic)
 *   Laser ═══▶ Ex Filter ═══▶ ◇ Dichroic (0, 0)
 *  (-200,0)    (-80,0)         │
 *                              │  (-Y, excitation reflects down)
 *                              ▼
 *                          Objective (0, -30)
 *                              │
 *                          Sample    (0, -40)
 */
export const createEpiFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // ═══════════════════════════════════════════════════════
    //  EXCITATION PATH  (horizontal, +X direction)
    // ═══════════════════════════════════════════════════════

    // 1. Laser — 488 nm blue excitation (argon-ion line)
    //    Fires along +X (default orientation)
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-200, 0, 0);
    laser.setRotation(0, 0, 0);  // default: fires +X
    laser.beamRadius = 2;
    laser.wavelength = 488;      // nm — blue
    laser.power = 1.0;
    scene.push(laser);

    // 2. Excitation Filter — bandpass 470–490 nm (cleans laser line)
    //    Filter uses local X axis → faces +X beam with rotation (0, 0, 0)
    //    (plane at x=0, normal along X — already faces +X beam)
    const exFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('bandpass', 480, [{ center: 480, width: 20 }]),
        "Ex Filter (BP 480/20)"
    );
    exFilter.setPosition(-80, 0, 0);
    exFilter.setRotation(0, 0, 0);  // local X faces +X beam
    scene.push(exFilter);

    // 3. Dichroic Mirror — longpass 505 nm at 45° in the XY plane
    //    Reflects <505 nm (blue) to -Y, transmits >505 nm (green) to +Y
    //    DichroicMirror: local X is normal. Rotate π/4 around Z puts
    //    normal at (1/√2, 1/√2, 0) → reflects +X beam to (0, -1, 0) = -Y
    const dichroic = new DichroicMirror(
        25,     // diameter mm
        2,      // thickness mm
        new SpectralProfile('longpass', 505),
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, 0, 0);
    dichroic.setRotation(0, 0, Math.PI / 4);  // 45° in XY plane
    scene.push(dichroic);

    // ═══════════════════════════════════════════════════════
    //  EXCITATION continues downward (-Y) after dichroic
    // ═══════════════════════════════════════════════════════

    // 4. Objective — 40×/0.65, infinity-corrected (Nikon 200mm standard)
    //    f = 200/40 = 5 mm.  Working distance = 5 mm.
    //    Objective: local Z is optical axis. For beam going -Y,
    //    local Z must map to -Y → setRotation(π/2, 0, 0)
    const objective = new Objective({
        magnification: 40,
        NA: 0.65,
        workingDistance: 5,
        tubeLensFocal: 200,
        name: '40×/0.65 Objective'
    });
    objective.setPosition(0, -30, 0);
    objective.setRotation(Math.PI / 2, 0, 0);  // local Z → world -Y
    scene.push(objective);

    // 5. Sample — at objective front focal plane
    //    Fluorescence emission deferred to Solver 3
    const sample = new Sample("Specimen (GFP)");
    sample.setPosition(0, -40, 0);
    sample.setRotation(Math.PI / 2, 0, 0);  // match objective orientation
    scene.push(sample);

    // ═══════════════════════════════════════════════════════
    //  EMISSION PATH  (upward, +Y, through dichroic)
    // ═══════════════════════════════════════════════════════

    // 6. Tube Lens — plano-convex, f = 200 mm (Nikon standard)
    //    SphericalLens: local Z is optical axis. For beam going +Y,
    //    local Z must map to +Y → setRotation(-π/2, 0, 0)
    //    R1 = ∞ (flat), R2 = -100 mm (convex) → f = 200 mm
    const tubeLens = new SphericalLens(1 / 200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(0, 160, 0);
    tubeLens.setRotation(-Math.PI / 2, 0, 0);  // local Z → world +Y
    scene.push(tubeLens);

    // 7. Emission Filter — bandpass 515–555 nm (GFP emission window)
    //    Filter: local X is optical axis. For beam going +Y,
    //    local X must map to +Y → setRotation(0, 0, π/2)
    const emFilter = new Filter(
        25,     // diameter mm
        3,      // thickness mm
        new SpectralProfile('bandpass', 535, [{ center: 535, width: 40 }]),
        "Em Filter (BP 535/40)"
    );
    emFilter.setPosition(0, 280, 0);
    emFilter.setRotation(0, 0, Math.PI / 2);  // local X → world +Y
    scene.push(emFilter);

    // 8. Camera — at tube lens back focal plane (160 + 200 = 360)
    //    Camera: local Z is optical axis. For beam going +Y,
    //    local Z should face incoming beam → setRotation(-π/2, 0, 0)
    const camera = new Camera(50, 25, "CMOS Sensor");
    camera.setPosition(0, 360, 0);
    camera.setRotation(Math.PI / 2, 0, 0);  // local +Z → world -Y (sensor faces incoming light)
    scene.push(camera);

    return scene;
};
