import { Laser } from '../physics/components/Laser';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Waveplate } from '../physics/components/Waveplate';
import { Objective } from '../physics/components/Objective';
import { PolarizingBeamSplitter } from '../physics/components/PolarizingBeamSplitter';
import { Blocker } from '../physics/components/Blocker';
import { Aperture } from '../physics/components/Aperture';
import { Filter } from '../physics/components/Filter';
import { Camera } from '../physics/components/Camera';
import { Lamp } from '../physics/components/Lamp';
import { DichroicMirror } from '../physics/components/DichroicMirror';
import { QPD } from '../physics/components/QPD';
import { Sample } from '../physics/components/Sample';
import { MediumVolume } from '../physics/components/MediumVolume';
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
    laser.beamRadius = 1.0;
    laser.power = 120.0;
    laser.setPosition(hole(C.D, 2).x, hole(C.D, 2).y, 0);
    laser.pointAlong(1, 0, 0);
    scene.push(laser);

    const halfWave = new Waveplate('half', 12.5, Math.PI / 4, 'lambda/2 plate');
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

    const f_obj = 200 / 60;
    const objective = new Objective({
        magnification: 60, NA: 1.4, immersionIndex: 1.515, workingDistance: 2.0, tubeLensFocal: 200, name: 'OL (60x/1.4 Oil)'
    });
    objective.setPosition(hole(C.H, 6).x + f_obj, hole(C.H, 6).y, 0);
    objective.pointAlong(1, 0, 0);
    scene.push(objective);

    const sample = new Sample("Trapping Chamber");
    sample.setPosition(hole(C.H, 6).x, hole(C.H, 6).y, 0);
    sample.pointAlong(1, 0, 0);
    scene.push(sample);

    const trapMedium = new MediumVolume({
        width: 14, height: 12, depth: 12,
        refractiveIndex: 1.33, exteriorRefractiveIndex: 1,
        name: 'Trap Chamber Medium',
    });
    trapMedium.setPosition(sample.position.x, sample.position.y, sample.position.z);
    trapMedium.pointAlong(1, 0, 0);
    scene.push(trapMedium);

    const cl = new SphericalLens(1 / 30, 20, 4, "CL (Condenser)");
    cl.setPosition(hole(C.H, 6).x - 30, hole(C.H, 6).y, 0);
    cl.pointAlong(1, 0, 0);
    scene.push(cl);

    const lamp = new Lamp("Illumination");
    lamp.beamRadius = 5;
    lamp.power = 0.5;
    lamp.setPosition(hole(C.A, 6).x, hole(C.A, 6).y, 0);
    lamp.pointAlong(1, 0, 0);
    scene.push(lamp);

    const l2 = new SphericalLens(1 / 25, 20, 2, "L2 Lens");
    l2.setPosition(hole(C.B, 6).x, hole(C.B, 6).y, 0);
    l2.pointAlong(1, 0, 0);
    scene.push(l2);

    const ir = new Aperture(2, 25, "Iris (Ir)");
    ir.setPosition(hole(C.C, 6).x, hole(C.C, 6).y, 0);
    ir.pointAlong(1, 0, 0);
    scene.push(ir);

    const l3 = new SphericalLens(1 / 25, 20, 2, "L3 Lens");
    l3.setPosition(hole(C.D, 6).x, hole(C.D, 6).y, 0);
    l3.pointAlong(1, 0, 0);
    scene.push(l3);

    const dm2 = new DichroicMirror(25, 2, new SpectralProfile('shortpass', 700, [], 15), "DM2");
    dm2.setPosition(hole(C.E, 6).x, hole(C.E, 6).y, 0);
    dm2.pointAlong(1, -1, 0);
    scene.push(dm2);

    // ═══ IMAGING & DETECTION ═══

    const ndf = new Filter(20, 2, new SpectralProfile('bandpass', 780, [{ center: 780, width: 20 }], 15), "NDF");
    ndf.setPosition(hole(C.E, 5).x, hole(C.E, 5).y, 0);
    ndf.pointAlong(0, 1, 0);
    scene.push(ndf);

    const qpd = new QPD(10, "QPD");
    qpd.setPosition(hole(C.E, 4).x, hole(C.E, 4).y, 0);
    qpd.pointAlong(0, 1, 0);
    scene.push(qpd);

    const ccd = new Camera(13, 13, "CCD");
    ccd.sensorNA = 0.05;
    ccd.setPosition(hole(C.O, 6).x, hole(C.O, 6).y, 0);
    ccd.pointAlong(-1, 0, 0);
    scene.push(ccd);

    return scene;
}
