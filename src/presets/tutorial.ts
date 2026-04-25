import { OpticalComponent } from '../physics/Component';
import { Lamp } from '../physics/components/Lamp';
import { Card } from '../physics/components/Card';
import { CurvedMirror } from '../physics/components/CurvedMirror';
import { PrismLens } from '../physics/components/PrismLens';

import { PresetResult } from '../state/store';

/**
 * Tutorial Preset — folded 3× reflective Keplerian beam expander, broadband.
 *
 *   Lamp   at (-87.5, 12.5)              — emits white light along +X.
 *   M1 target at (12.5, 12.5)            — concave, folds beam to +Y.
 *   M2 target at (12.5, 12.5 + D)        — concave, folds beam to +X.
 *   Prism  at (162.5, 12.5 + D)          — disperses the expanded white beam.
 *   Card    at (337.5, 12.5 + D + 30)    — screen, catches the rainbow spectrum.
 *
 * CurvedMirror convention: radiusOfCurvature < 0 = concave (focusing).  Each
 * mirror sits at a 45° fold; the effective tangential focal length is
 *   f_t = |R| · cos 45° / 2,
 * so the Keplerian expander collimates when D = (|R1| + |R2|) · cos 45° / 2.
 * |R1| = 100 mm and |R2| = 300 mm give 3× magnification and D ≈ 141.42 mm.
 */
export function createTutorialScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const R1 = -100;
    const R2 = -300;
    const D = (Math.abs(R1) + Math.abs(R2)) * Math.SQRT1_2 / 2; // 141.42 mm

    const M1_POS = { x: 12.5, y: 12.5 };
    const M2_POS = { x: 12.5, y: 12.5 + D };

    // Lamp — broadband white light source, emits along +X.  The prism farther
    // down the path will fan its discrete wavelengths into a rainbow on the
    // screen, which is the visual payoff for the tutorial.
    const lamp = new Lamp("Lamp Source");
    lamp.setPosition(-87.5, 12.5, 0);
    lamp.pointAlong(1, 0, 0);
    lamp.beamRadius = 1.2;
    scene.push(lamp);

    // Ghost 1 — target outline for M1.
    const m1Ghost = new CurvedMirror(25.4, R1, 1, "M1 Target");
    m1Ghost.isGhost = true;
    m1Ghost.setPosition(M1_POS.x, M1_POS.y, 0);
    m1Ghost.panAngle = -Math.PI / 4;
    m1Ghost.recomputeRotation();
    scene.push(m1Ghost);

    // Ghost 2 — target outline for M2.
    const m2Ghost = new CurvedMirror(25.4, R2, 1, "M2 Target");
    m2Ghost.isGhost = true;
    m2Ghost.setPosition(M2_POS.x, M2_POS.y, 0);
    m2Ghost.panAngle = 3 * Math.PI / 4;
    m2Ghost.recomputeRotation();
    scene.push(m2Ghost);

    // M1 — real mirror placed off to the side.  User drags into the M1 target.
    const m1 = new CurvedMirror(25.4, R1, 1, "M1");
    m1.setPosition(M1_POS.x + 87.5, M1_POS.y + 37.5, 0);
    m1.panAngle = -Math.PI / 4;
    m1.recomputeRotation();
    scene.push(m1);

    // M2 — real mirror placed off to the side.
    const m2 = new CurvedMirror(25.4, R2, 1, "M2");
    m2.setPosition(M2_POS.x + 87.5, M2_POS.y - 62.5, 0);
    m2.panAngle = 3 * Math.PI / 4;
    m2.recomputeRotation();
    scene.push(m2);

    // Prism — placed at x = 40 along the +X expanded beam from M2.  Equilateral
    // triangle, oriented so the beam enters one face at moderate incidence
    // and exits dispersed downward.
    const prism = new PrismLens(Math.PI/3, 30, 30, "Dispersion Prism", 1.5168);
    prism.setPosition(80, 150, 0);
    prism.panAngle = 55;
    prism.tiltAngle = 0;
    prism.rollAngle = Math.PI / 2;
    prism.recomputeRotation();
    scene.push(prism);

    // Card — screen positioned at (237.5, 87.5) to catch the dispersed rainbow
    // after the prism bends the beam downward.
    const card = new Card(80, 80, "Screen");
    card.opaque = true;
    card.setPosition(180.5, 50.5, 0);
    card.panAngle = Math.PI - Math.PI / 6;
    card.recomputeRotation();
    scene.push(card);

    return {
        scene,
        description:
            "Drag the mirrors to make a beam expander. The prism then splits the white light into a rainbow on the screen. Try adding components from the left bar, or explore the other presets.",
    };
}
