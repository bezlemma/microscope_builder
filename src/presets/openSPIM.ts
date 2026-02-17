import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { CylindricalLens } from '../physics/components/CylindricalLens';
import { SlitAperture } from '../physics/components/SlitAperture';
import { Objective } from '../physics/components/Objective';
import { Filter } from '../physics/components/Filter';
import { Camera } from '../physics/components/Camera';
import { SampleChamber } from '../physics/components/SampleChamber';
import { SpectralProfile } from '../physics/SpectralProfile';
import { OpticalComponent } from '../physics/Component';

/**
 * OpenSPIM — L-SPIM (Single-sided illumination, single-sided detection).
 *
 * Beam path (top-down view, +X = right, +Y = up on screen):
 *
 *   Laser(H4) fires -X (left)
 *     → M1(B4) redirects -X → -Y (down)
 *     → M2(B2) redirects -Y → +X (right)
 *     → BE f25(D2) → BE f50(G2) → Slit(I2) → CylLens(K2)
 *     → 1"Mirror(N2) redirects +X → +Y (up)
 *     → BFP f50(N4) → BFP f25(N6) → IllumObj(N8)
 *     → Sample(N10)
 *
 *   Detection from sample goes -X (left) along row 10:
 *     → DetObj(L10) → EmFilter(J10) → TubeLens(H10)  → Camera(F10)
 *       Camera sensor faces +X.
 *
 * Mirror offset: reflective face at hole center (body offset by thickness/2).
 */

// ── Grid ────────────────────────────────────────────────
const hole = (col: number, row: number) => ({
    x: 12.5 + col * 25,
    y: 12.5 + row * 25,
});
const C = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7,
    I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17,
};

/**
 * Offset mirror position so the beam-facing reflective surface
 * sits at the hole center instead of the mirror's geometric center.
 * Mirror reflective surfaces are at ±thickness/2 in local coords.
 * We shift by +thickness/2 along the mirror's local X (normal).
 */
function mirrorAtHole(
    hx: number, hy: number, thickness: number, rotZ: number
): [number, number] {
    const d = thickness / 2;
    return [hx - d * Math.cos(rotZ), hy - d * Math.sin(rotZ)];
}

export function createOpenSPIMScene(): OpticalComponent[] {
    const components: OpticalComponent[] = [];

    // ═══════════════════════════════════════
    //  ILLUMINATION ARM
    // ═══════════════════════════════════════

    // 1. Laser at H4 — fires -X (left)
    const laser = new Laser("488nm Laser");
    laser.wavelength = 488;
    laser.beamRadius = 1;
    laser.beamWaist = 1;
    laser.power = 0.05;
    laser.setPosition(hole(C.H, 4).x, hole(C.H, 4).y, 0);
    laser.setRotation(0, 0, Math.PI);  // fires -X
    components.push(laser);

    // 2. Steering Mirror 1 at B4 — redirects -X → -Y
    //    Normal at -π/4: n̂ = (1/√2, -1/√2). Beam (-1,0)·n̂ = -1/√2 ✓
    const t1 = 2;
    const r1 = -Math.PI / 4;
    const [m1x, m1y] = mirrorAtHole(hole(C.B, 4).x, hole(C.B, 4).y, t1, r1);
    const m1 = new Mirror(12, t1, "Steering Mirror 1");
    m1.setPosition(m1x, m1y, 0);
    m1.setRotation(0, 0, r1);
    components.push(m1);

    // 3. Steering Mirror 2 at B2 — redirects -Y → +X
    //    Normal at π/4: n̂ = (1/√2, 1/√2). Beam (0,-1)·n̂ = -1/√2 ✓
    const t2 = 2;
    const r2 = Math.PI / 4;
    const [m2x, m2y] = mirrorAtHole(hole(C.B, 1).x, hole(C.B, 1).y, t2, r2);
    const m2 = new Mirror(12, t2, "Steering Mirror 2");
    m2.setPosition(m2x, m2y, 0);
    m2.setRotation(0, 0, r2);
    components.push(m2);

    // ── Bottom rail optics (row 2, beam going +X) ──

    // 4. Beam Expander lens 1 (f=25mm) at D2
    const beL1 = new SphericalLens(1 / 25, 6, 3, "BE Lens 1 (f25)");
    beL1.r1 = undefined;
    beL1.r2 = -(1.5168 - 1) * 25;
    beL1.setPosition(hole(C.D, 1).x, hole(C.D, 1).y, 0);
    beL1.setRotation(0, Math.PI / 2, 0);
    components.push(beL1);

    // 5. Beam Expander lens 2 (f=50mm) at G2
    const beL2 = new SphericalLens(1 / 50, 10, 4, "BE Lens 2 (f50)");
    beL2.r1 = (1.5168 - 1) * 50;
    beL2.r2 = undefined;
    beL2.setPosition(hole(C.G, 1).x, hole(C.G, 1).y, 0);
    beL2.setRotation(0, Math.PI / 2, 0);
    components.push(beL2);

    // 6. Vertical Slit at I2
    const slit = new SlitAperture(5, 20, 25, "Vertical Slit");
    slit.setPosition(hole(C.I, 1).x, hole(C.I, 1).y, 0);
    slit.setRotation(0, 0, 0);
    components.push(slit);

    // 7. Cylindrical Lens (f=50mm) at K2 — creates light sheet
    const cylLens = new CylindricalLens(
        25.84, 1e9, 10, 20, 4,
        "Cylindrical Lens (f50)"
    );
    cylLens.setPosition(hole(C.K, 1).x, hole(C.K, 1).y, 0);
    cylLens.setRotation(0, Math.PI / 2, 0);
    components.push(cylLens);

    // 8. 1" Turn Mirror at N2 — redirects +X → +Y (up)
    //    Normal at 3π/4: n̂ = (-1/√2, 1/√2). Beam (1,0)·n̂ = -1/√2 ✓
    const t3 = 2;
    const r3 = 3 * Math.PI / 4;
    const [m3x, m3y] = mirrorAtHole(hole(C.N, 1).x, hole(C.N, 1).y, t3, r3);
    const bigMirror = new Mirror(25, t3, "1\" Turn Mirror");
    bigMirror.setPosition(m3x, m3y, 0);
    bigMirror.setRotation(0, 0, r3);
    components.push(bigMirror);

    // ── Vertical arm (col N, beam going +Y, up) ──

    // 9. BFP Relay lens 1 (f=50mm) at N4
    const relayL1 = new SphericalLens(1 / 50, 10, 4, "BFP Relay 1 (f50)");
    relayL1.r1 = undefined;
    relayL1.r2 = -(1.5168 - 1) * 50;
    relayL1.setPosition(hole(C.N, 3).x, hole(C.N, 3).y, 0);
    relayL1.setRotation(-Math.PI / 2, 0, 0);  // local Z → +Y
    components.push(relayL1);

    // 10. BFP Relay lens 2 (f=25mm) at N6
    const relayL2 = new SphericalLens(1 / 25, 8, 3, "BFP Relay 2 (f25)");
    relayL2.r1 = (1.5168 - 1) * 25;
    relayL2.r2 = undefined;
    relayL2.setPosition(hole(C.N, 5).x, hole(C.N, 5).y, 0);
    relayL2.setRotation(-Math.PI / 2, 0, 0);  // local Z → +Y
    components.push(relayL2);

    // 11. Illumination Objective (Nikon 20×/0.5W) at N8
    //     Faces +Y (light enters from -Y, passes through sample)
    //     WD = 2.0mm, positioned so front element is at WD from sample center
    const illumObj = new Objective({
        NA: 0.5,
        magnification: 20,
        immersionIndex: 1.33,
        workingDistance: 2.0,
        tubeLensFocal: 200,
        name: "Nikon 20×/0.5W Illum",
    });
    // Position along Y axis: chamber center is at hole(C.N,9).y = 237.5
    // Objective front at sample center - WD along -Y approach
    illumObj.setPosition(hole(C.N, 9).x, hole(C.N, 9).y - 20, 0);
    illumObj.setRotation(-Math.PI / 2, 0, 0);  // local Z → +Y
    components.push(illumObj);

    // ═══════════════════════════════════════
    //  SAMPLE HOLDER at N10
    //  Hollow open-top cube with bore holes on all 4 faces.
    //  Objectives can snap into the side holes via Alt+drag.
    //  Mickey specimen sits inside at center with ears facing +Z.
    // ═══════════════════════════════════════
    const chamber = new SampleChamber(40, 3, 21, "L/X Sample Holder");
    chamber.setPosition(hole(C.N, 9).x, hole(C.N, 9).y, 0);
    components.push(chamber);

    // ═══════════════════════════════════════
    //  DETECTION ARM — goes -X from sample, row 10
    //  Detection from -X face of chamber, objective faces +X (inward).
    // ═══════════════════════════════════════

    // 12. Detection Objective (Nikon 20×/0.5W)
    //     Faces +X (into the sample chamber bore hole)
    //     WD = 2.0mm from sample center
    const detObj = new Objective({
        NA: 0.5,
        magnification: 20,
        immersionIndex: 1.33,
        workingDistance: 2.0,
        tubeLensFocal: 200,
        name: "Nikon 20×/0.5W Det",
    });
    // Position along X axis: chamber center is at hole(C.N,9).x = 337.5
    // Place at chamber -X face (chamber center - half cube size)
    detObj.setPosition(hole(C.N, 9).x - 20, hole(C.N, 9).y, 0);
    detObj.setRotation(0, Math.PI / 2, 0);  // local Z → +X (faces into sample)
    components.push(detObj);


    // 13. Emission Filter (LP 500nm) at J10
    const emFilter = new Filter(
        25, 3,
        new SpectralProfile('longpass', 500),
        "Em Filter (LP 500)"
    );
    emFilter.setPosition(hole(C.J, 9).x, hole(C.J, 9).y, 0);
    emFilter.setRotation(0, 0, 0);
    components.push(emFilter);

    // 14. Tube Lens (Nikon f=200mm) at F10
    //     Placed ~150mm from objective back aperture for infinity-corrected imaging
    const tubeLens = new SphericalLens(1 / 200, 12, 4, "Nikon Tube Lens (f200)");
    tubeLens.r1 = undefined;
    tubeLens.r2 = -(1.5168 - 1) * 200;
    tubeLens.setPosition(hole(C.F, 9).x, hole(C.F, 9).y, 0);
    tubeLens.setRotation(0, Math.PI / 2, 0);  // local Z → +X
    components.push(tubeLens);

    // 15. sCMOS Camera — placed at tube lens focal distance (200mm from tube lens)
    //     At column B, row 9
    const cam = new Camera(13, 13, "sCMOS Camera");
    cam.setPosition(hole(C.B, 9).x, hole(C.B, 9).y, 0);
    cam.setRotation(0, Math.PI / 2, 0);  // local Z → +X, sensor faces +X
    components.push(cam);

    return components;
}
