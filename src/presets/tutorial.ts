import { OpticalComponent } from '../physics/Component';
import { Laser } from '../physics/components/Laser';
import { Card } from '../physics/components/Card';
import { CurvedMirror } from '../physics/components/CurvedMirror';

import { PresetResult } from '../state/store';

/**
 * Tutorial Preset — a folded 3× reflective Keplerian beam expander the user assembles.
 *
 *   Laser (611 nm) at (-87.5, 12.5) shoots +X.
 *   M1 target at (12.5, 12.5)           — concave, folds beam to +Y.
 *   M2 target at (12.5, 12.5 + D)       — concave, folds beam to +X.
 *   Card    at (212.5, 12.5 + D)        — opaque screen, catches the expanded beam.
 *
 * CurvedMirror convention in this codebase: radiusOfCurvature < 0 = concave (focusing).
 * Each mirror sits at a 45° fold.  The effective tangential focal length at that
 * incidence is f_t = |R| · cos 45° / 2, so a Keplerian expander collimates when
 *   D = f_t1 + f_t2 = (|R1| + |R2|) · cos 45° / 2.
 * Pick |R1| = 100 mm, |R2| = 300 mm → 3× magnification and D ≈ 141.42 mm.
 *
 * The laser sits on a 25 mm grid hole.  M2 and the card end up ~9 mm off-grid
 * along Y — Alt-drag snaps to ghost centers regardless of grid alignment.
 */
export function createTutorialScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const R1 = -100;   // concave, f_paraxial = 50 mm
    const R2 = -300;   // concave, f_paraxial = 150 mm
    const D = (Math.abs(R1) + Math.abs(R2)) * Math.SQRT1_2 / 2; // 141.42 mm

    const M1_POS = { x: 12.5, y: 12.5 };
    const M2_POS = { x: 12.5, y: 12.5 + D };

    // Laser — 611 nm, emits along +X.
    const laser = new Laser("Laser Source");
    laser.wavelength = 611;
    laser.beamRadius = 2;
    laser.setPosition(-87.5, 12.5, 0);
    laser.pointAlong(1, 0, 0);
    scene.push(laser);

    // Ghost 1 — target outline for M1 (excluded from ray tracing).
    // pan = -π/4 so the reflective front faces up-left (toward the incoming +X beam).
    const m1Ghost = new CurvedMirror(25.4, R1, 1, "M1 Target");
    m1Ghost.isGhost = true;
    m1Ghost.setPosition(M1_POS.x, M1_POS.y, 0);
    m1Ghost.panAngle = -Math.PI / 4;
    m1Ghost.recomputeRotation();
    scene.push(m1Ghost);

    // Ghost 2 — target outline for M2.
    // pan = +3π/4 so the reflective front faces down-right (toward the +Y beam arriving from M1).
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

    // Card — opaque screen that catches the expanded beam.
    const card = new Card(60, 60, "Screen");
    card.opaque = true;
    card.setPosition(212.5, M2_POS.y, 0);
    card.panAngle = Math.PI;
    card.recomputeRotation();
    scene.push(card);

    return {
        scene,
        description:
            "Hold Alt while dragging to snap to the target. Once both mirrors are in place the laser expands into a beam ~3× wider that lights up the screen.",
    };
}
