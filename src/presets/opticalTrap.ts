import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Waveplate } from '../physics/components/Waveplate';
import { Objective } from '../physics/components/Objective';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Blocker } from '../physics/components/Blocker';
import { Aperture } from '../physics/components/Aperture';
import { Filter } from '../physics/components/Filter';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { QPD } from '../physics/components/QPD';
import { MediumVolume } from '../physics/components/MediumVolume';
import { TrappedBead } from '../physics/components/TrappedBead';
import { SpectralProfile } from '../physics/SpectralProfile';
import { OpticalComponent } from '../physics/Component';

/**
 * Optical Trap (Optical Tweezers) — single-beam gradient-force trap.
 *
 * Uses a high-NA oil-immersion objective to focus a 780nm laser into
 * a sample chamber, creating a 3D gradient-force trap. QPD detects
 * beam displacement for force measurement.
 */

const hole = (col: number, row: number) => ({
    x: 12.5 + col * 25,
    y: 12.5 + row * 25,
});
const C = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7,
    I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15,
};

export function createOpticalTrapScene(): OpticalComponent[] {
    const scene: OpticalComponent[] = [];

    // ═══ TRAPPING LASER INJECTION ARM ═══

    const laser = new Laser("780nm Diode Laser");
    laser.wavelength = 780;
    laser.beamRadius = 0.75;
    laser.power = 120.0;
    laser.setPosition(hole(C.D, 2).x, hole(C.D, 2).y, 0);
    laser.pointAlong(1, 0, 0);
    scene.push(laser);

    // λ/2 + PBS form a power attenuator: rotating the HWP fast axis steers
    // power between the trap arm (transmitted P) and the beam dump (reflected
    // S).  Default the fast axis to 0 so the demo opens with full power
    // reaching the trap; the user can then dial the HWP up to 45° to dump
    // all power and watch the bead escape.  (The previous default of π/4
    // dumped 100% of the laser into the beam dump, which is why the
    // shipped trap "didn't work" out of the box.)
    const halfWave = new Waveplate('half', 12.5, 0, 'lambda/2 plate');
    halfWave.setPosition(hole(C.E, 2).x, hole(C.E, 2).y, 0);
    halfWave.pointAlong(1, 0, 0);
    scene.push(halfWave);

    const pbs = new PolarizingBeamSplitter(15, 2, "PBS cube");
    pbs.setPosition(hole(C.F, 2).x, hole(C.F, 2).y, 0);
    pbs.pointAlong(1, 1, 0);
    scene.push(pbs);

    const dump = new Blocker(25, 10, "Beam Dump");
    dump.setPosition(hole(C.F, 0).x, hole(C.F, 0).y, 0);
    dump.pointAlong(0, 1, 0);
    scene.push(dump);

    const returnDump = new Blocker(70, 10, "Return Beam Dump");
    returnDump.setPosition(hole(C.B, 2).x, hole(C.B, 2).y, 0);
    returnDump.pointAlong(1, 0, 0);
    scene.push(returnDump);

    const m = new Mirror(25, 2, "Steering M");
    const posM = hole(C.M, 2);
    m.setPosition(posM.x + 0.707, posM.y - 0.707, 0);
    m.pointAlong(-1, 1, 0);
    scene.push(m);

    // 3x Galilean Beam Expander
    const l1a = new SphericalLens(-1 / 20, 12, 1, "L1 Expander (-20)");
    l1a.setPosition(posM.x, posM.y + 20, 0);
    l1a.pointAlong(0, 1, 0);
    scene.push(l1a);

    const expanderStopA = new Aperture(11.5, 70, "L1 Mount Stop");
    expanderStopA.setPosition(posM.x, posM.y + 18.5, 0);
    expanderStopA.pointAlong(0, 1, 0);
    scene.push(expanderStopA);

    const l1b = new SphericalLens(1 / 60, 15, 2, "L1 Collimator (+60)");
    l1b.setPosition(posM.x, posM.y + 20 + 40.49, 0);
    l1b.pointAlong(0, 1, 0);
    scene.push(l1b);

    const expanderStopB = new Aperture(14.5, 80, "L1 Collimator Mount Stop");
    expanderStopB.setPosition(posM.x, posM.y + 20 + 38.5, 0);
    expanderStopB.pointAlong(0, 1, 0);
    scene.push(expanderStopB);

    // ═══ MAIN OPTICAL AXIS ═══

    const dm1 = new DichroicMirror(25, 2, new SpectralProfile('shortpass', 700, [], 15), "DM1");
    dm1.setPosition(hole(C.M, 6).x, hole(C.M, 6).y, 0);
    dm1.pointAlong(-1, -1, 0);
    scene.push(dm1);

    // Real trap layouts clean up the expanded beam before it hits the back
    // pupil. This iris is not a cosmetic clip: it matches the objective pupil
    // scale and absorbs off-pupil rays before they spray through the table.
    const pupilStop = new Aperture(8.5, 18, "Back Pupil Stop");
    pupilStop.setPosition(hole(C.J, 6).x, hole(C.J, 6).y, 0);
    pupilStop.pointAlong(1, 0, 0);
    scene.push(pupilStop);

    const f_obj = 200 / 60;
    const objective = new Objective({
        magnification: 60, NA: 1.4, immersionIndex: 1.515, workingDistance: 2.0, tubeLensFocal: 200, name: 'OL (60x/1.4 Oil)'
    });
    objective.setPosition(hole(C.H, 6).x + f_obj, hole(C.H, 6).y, 0);
    objective.pointAlong(1, 0, 0);
    scene.push(objective);

    // Suppressed Mickey-fluorophore "sample" — irrelevant to a trap demo.
    // Brought back as a comment so the prior placement is recoverable if a
    // future preset variant wants fluorescent beads.
    // const sample = new Sample("Trapping Chamber");
    // sample.setPosition(hole(C.H, 6).x, hole(C.H, 6).y, 0);
    // sample.pointAlong(1, 0, 0);
    // scene.push(sample);
    const sampleAnchor = { x: hole(C.H, 6).x, y: hole(C.H, 6).y, z: 0 };

    const trapMedium = new MediumVolume({
        width: 10, height: 10, depth: 3.8,
        refractiveIndex: 1.33, exteriorRefractiveIndex: 1,
        name: 'Trap Chamber Medium',
    });
    trapMedium.setPosition(sampleAnchor.x, sampleAnchor.y, sampleAnchor.z);
    trapMedium.pointAlong(1, 0, 0);
    scene.push(trapMedium);

    // The actual specimen: a polystyrene microsphere in water.  Placed at
    // the chamber centre (which is also the objective focal point in this
    // preset's geometry).  Initial offset is non-zero so the user sees the
    // bead get pulled IN when the laser is on, rather than starting already
    // at the trap minimum and just sitting there.  Diameter is exaggerated
    // (0.5 mm) so the bead is visible against the mm-scale optical bench;
    // physics scaling is preserved by `displayScale` (see TrappedBead).
    const bead = new TrappedBead(0.5, 1.59, 1.33, 'Polystyrene Bead');
    bead.setPosition(sampleAnchor.x, sampleAnchor.y, sampleAnchor.z);
    bead.pointAlong(1, 0, 0);
    // pointAlong(1,0,0) makes local +Z map to world +X.  The objective is at
    // world x ≈ 190.83 with its barrel front at ≈ 189.5 and its focal point
    // at the sample anchor (x = 187.5); the bead has to start on the SAMPLE
    // side of the focal plane (more negative world X) so it isn't placed
    // inside the objective barrel.  Local -Z = world -X, so a -1.5 local-Z
    // offset maps to world x = 186, comfortably
    // inside the trap chamber and 1.5 mm sample-side of the focus.
    bead.specimenOffset.set(0, 0, -1.5);
    bead.displayScale = 80;             // turn up the visible drift for a clear demo
    bead.rayMomentumScale = 0.015;
    bead.gradientForceScale = 0.12;
    scene.push(bead);

    const cl = new SphericalLens(1 / 30, 20, 4, "CL (Condenser)");
    cl.setPosition(hole(C.H, 6).x - 30, hole(C.H, 6).y, 0);
    cl.pointAlong(1, 0, 0);
    scene.push(cl);

    const condenserStop = new Aperture(19, 120, "Condenser Mount Stop");
    condenserStop.setPosition(cl.position.x + 1.5, cl.position.y, cl.position.z);
    condenserStop.pointAlong(1, 0, 0);
    scene.push(condenserStop);

    const dm2 = new DichroicMirror(25, 2, new SpectralProfile('shortpass', 700, [], 15), "DM2");
    dm2.setPosition(hole(C.E, 6).x, hole(C.E, 6).y, 0);
    dm2.pointAlong(1, -1, 0);
    scene.push(dm2);

    const transmittedTrapDump = new Blocker(30, 12, "DM2 Transmitted IR Dump");
    transmittedTrapDump.setPosition(hole(C.C, 6).x, hole(C.C, 6).y, 0);
    transmittedTrapDump.pointAlong(1, 0, 0);
    scene.push(transmittedTrapDump);

    // ═══ IMAGING & DETECTION ═══

    const ndf = new Filter(20, 2, new SpectralProfile('bandpass', 780, [{ center: 780, width: 20 }], 15), "NDF");
    ndf.setPosition(hole(C.E, 5).x, hole(C.E, 5).y, 0);
    ndf.pointAlong(0, 1, 0);
    scene.push(ndf);

    const qpd = new QPD(20, "QPD");
    qpd.gapWidth = 0.02;
    qpd.setPosition(hole(C.E, 4).x, hole(C.E, 4).y, 0);
    qpd.pointAlong(0, 1, 0);
    scene.push(qpd);

    const qpdDump = new Blocker(30, 16, "QPD Beam Dump");
    qpdDump.setPosition(hole(C.E, 3).x, hole(C.E, 3).y, 0);
    qpdDump.pointAlong(0, 1, 0);
    scene.push(qpdDump);

    return scene;
}
