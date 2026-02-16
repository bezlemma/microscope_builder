import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { Objective } from '../physics/components/Objective';
import { Sample } from '../physics/components/Sample';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Camera } from '../physics/components/Camera';
import { SpectralProfile } from '../physics/SpectralProfile';
// Note: Filter import kept for excitation filter only

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
 *                Camera  (0, 150)
 *                  │
 *              Tube Lens (0, -50)
 *                  │  (+Y, emission transmits through dichroic)
 *   Laser ═══▶ Ex Filter ═══▶ ◇ Dichroic (0, -125)
 *  (-200,-125) (-75,-125)      │
 *                              │  (-Y, excitation reflects down)
 *                              ▼
 *                          Objective (0, -155)
 *                              │
 *                          Sample    (0, -165)
 */
export const createEpiFluorescenceScene = (): OpticalComponent[] => {
    const scene: OpticalComponent[] = [];

    // ═══════════════════════════════════════════════════════
    //  EXCITATION PATH  (horizontal, +X direction)
    // ═══════════════════════════════════════════════════════

    // 1. Laser — 488 nm blue excitation (argon-ion line)
    //    Fires along +X (default orientation)
    const laser = new Laser("488 nm Laser");
    laser.setPosition(-200, -125, 0);
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
    exFilter.setPosition(-75, -125, 0);
    exFilter.setRotation(0, 0, 0);  // local X faces +X beam
    scene.push(exFilter);

    // 3. Dichroic Mirror — longpass 505 nm at 45° in the XY plane
    //    Reflects <505 nm (blue) to -Y, transmits >505 nm (green) to +Y
    //    DichroicMirror: local X is normal. Rotate π/4 around Z puts
    //    normal at (1/√2, 1/√2, 0) → reflects +X beam to (0, -1, 0) = -Y
    const dichroic = new DichroicMirror(
        25,     // diameter mm
        2,      // thickness mm
        new SpectralProfile('longpass', 505, [], 5),  // sharp 5nm edge to cleanly separate 488/520
        "Dichroic (LP 505)"
    );
    dichroic.setPosition(0, -125, 0);
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
    objective.setPosition(0, -155, 0);
    objective.setRotation(Math.PI / 2, 0, 0);  // local Z → world -Y
    scene.push(objective);

    // 5. Sample — at objective front focal plane, GFP fluorescence
    //    Excitation/emission metadata for Solver 3 backward tracing
    const sample = new Sample("Specimen (GFP)");
    sample.excitationNm = 488;       // Blue laser excitation
    sample.emissionNm = 520;         // GFP green emission
    sample.excitationBandwidth = 30; // ±15 nm acceptance
    sample.setPosition(0, -165, 0);
    sample.setRotation(Math.PI / 2, 0, 0);  // match objective orientation
    scene.push(sample);

    // ═══════════════════════════════════════════════════════
    //  EMISSION PATH  (upward, +Y, through dichroic)
    //  No emission filter needed — the dichroic's sharp LP 505
    //  edge already blocks the 488nm excitation light.
    // ═══════════════════════════════════════════════════════

    // 6. Tube Lens — plano-convex, f = 200 mm (Nikon standard)
    //    SphericalLens: local Z is optical axis. For beam going +Y,
    //    local Z must map to +Y → setRotation(-π/2, 0, 0)
    //    R1 = ∞ (flat), R2 = -100 mm (convex) → f = 200 mm
    const tubeLens = new SphericalLens(1 / 200, 25, 6, "Tube Lens", 1e9, -100, 1.5);
    tubeLens.setPosition(0, -50, 0);
    tubeLens.setRotation(-Math.PI / 2, 0, 0);  // local Z → world +Y
    scene.push(tubeLens);

    // 7. Camera — at tube lens back focal plane (-50 + 200 = 150)
    //    Camera: local Z is optical axis. For beam going +Y,
    //    local Z should face incoming beam → setRotation(π/2, 0, 0)
    const camera = new Camera(13, 13, "CMOS Sensor");
    camera.setPosition(0, 150, 0);
    camera.setRotation(Math.PI / 2, 0, 0);  // local +Z → world -Y (sensor faces incoming light)
    scene.push(camera);

    return scene;
};
