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
import { TrappedBead } from '../physics/components/TrappedBead';
import { Sample } from '../physics/components/Sample';
import { SpectralProfile } from '../physics/SpectralProfile';
import { OpticalComponent } from '../physics/Component';
import { Vector3 } from 'three';

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
    laser.polarizationAngle = 0;
    scene.push(laser);

    // λ/2 + PBS form a power attenuator: rotating the HWP fast axis steers
    // power between the trap arm (transmitted P) and the beam dump (reflected
    // S). The laser emits S-polarized (world +Z, perpendicular to the
    // 45° PBS incidence plane), so a HWP at π/4 maps S→P → 100% to the trap.
    // We sit just shy of π/4 so the dump path is visibly alive while >95% of
    // the laser still reaches the trap.
    const halfWave = new Waveplate('half', 12.5, Math.PI / 4 - Math.PI / 36, 'lambda/2 plate', 780);
    halfWave.setPosition(hole(C.E, 2).x, hole(C.E, 2).y, 0);
    halfWave.pointAlong(1, 0, 0);
    scene.push(halfWave);

    const pbs = new PolarizingBeamSplitter(15, 2, "PBS plate");
    pbs.setPosition(hole(C.F, 2).x, hole(C.F, 2).y, 0);
    pbs.pointAlong(1, 1, 0);
    scene.push(pbs);

    const dump = new Blocker(25, 10, "Beam Dump");
    dump.setPosition(hole(C.F, 0).x, hole(C.F, 0).y, 0);
    dump.pointAlong(0, 1, 0);
    scene.push(dump);

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

    const l1b = new SphericalLens(1 / 60, 15, 2, "L1 Collimator (+60)");
    l1b.setPosition(posM.x, posM.y + 20 + 40.49, 0);
    l1b.pointAlong(0, 1, 0);
    scene.push(l1b);

    // ═══ MAIN OPTICAL AXIS ═══

    const dm1 = new DichroicMirror(25, 2, new SpectralProfile('shortpass', 700, [], 15), "DM1");
    dm1.setPosition(hole(C.M, 6).x, hole(C.M, 6).y, 0);
    dm1.pointAlong(-1, -1, 0);
    scene.push(dm1);

    // Real trap layouts clean up the expanded beam before it hits the back
    // pupil. Model this as a short tube stop rather than stacked flat baffles:
    // paraxial rays pass through, while oblique off-pupil rays hit the bore.
    const pupilStop = new Aperture(8.5, 18, "Back Pupil Tube", 12);
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

    const sampleAnchor = { x: hole(C.H, 6).x, y: hole(C.H, 6).y, z: 0 };

    const flowCell = new Sample('Trap Flow Cell').configureColloidFlowCell({
        count: 640,
        radius: 0.0025,
        width: 8,
        height: 4,
        depth: 0.0075,
        glassThickness: 0.17,
        fillMediumIndex: 1.33,
        temperatureK: 310,
        viscosity: 0.001,
        diffusionScale: 24,
    });
    if (flowCell.colloidSpheres[0]) {
        flowCell.colloidSpheres[0].center.set(0, 0, 0);
    }
    flowCell.setPosition(sampleAnchor.x, sampleAnchor.y, sampleAnchor.z);
    flowCell.pointAlong(1, 0, 0);
    scene.push(flowCell);

    // The trapped specimen is a real microsphere-scale bead.  The blue halo is
    // only a visual aid; the physical radius used for intersection, drag, and
    // confinement remains 2.5 microns.
    const bead = new TrappedBead(0.005, 1.59, 1.33, 'Trapped Colloid');
    bead.setPosition(sampleAnchor.x, sampleAnchor.y, sampleAnchor.z);
    bead.pointAlong(1, 0, 0);
    bead.isSubComponent = true;
    bead.parentSampleId = flowCell.id;
    // Local -Z maps to world -X, so this starts the bead slightly sample-side
    // of focus inside the thin quasi-2D flow cell.
    bead.specimenOffset.set(0, 0, -0.001);
    bead.confinementHalfSize = new Vector3(
        flowCell.flowCellWidth / 2,
        flowCell.flowCellHeight / 2,
        flowCell.flowCellDepth / 2,
    );
    bead.displayScale = 1;
    bead.thermalMotionScale = 12;
    bead.visualGlowRadius = 0.012;
    bead.rayMomentumScale = 0.015;
    bead.trapCaptureRadius = 0.018;
    bead.trapAxialCaptureRange = 0.006;
    // Solver-2 intensity is normalized rather than SI W/m^2. This calibrates
    // the local beam-envelope gradient to a visible overdamped micron-bead
    // capture without inflating the bead geometry.
    bead.gradientForceScale = 1e6;
    scene.push(bead);

    const cl = new SphericalLens(1 / 30, 20, 4, "CL (Condenser)");
    cl.setPosition(hole(C.H, 6).x - 30, hole(C.H, 6).y, 0);
    cl.pointAlong(1, 0, 0);
    scene.push(cl);

    // The transmitted/scattered trap light is collected through a real tube
    // before the condenser. This replaces the previous stack of flat baffles
    // with one selectable, finite-length stop.
    const condenserTube = new Aperture(12, 20, "Condenser Collection Tube", 18);
    condenserTube.setPosition(sampleAnchor.x - 15, sampleAnchor.y, sampleAnchor.z);
    condenserTube.pointAlong(1, 0, 0);
    scene.push(condenserTube);

    const dm2 = new DichroicMirror(25, 2, new SpectralProfile('shortpass', 760, [], 35), "DM2");
    dm2.setPosition(hole(C.E, 6).x, hole(C.E, 6).y, 0);
    dm2.pointAlong(1, -1, 0);
    scene.push(dm2);

    const transmittedTrapDump = new Blocker(22, 3, "DM2 Transmitted IR Dump");
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

    return scene;
}
