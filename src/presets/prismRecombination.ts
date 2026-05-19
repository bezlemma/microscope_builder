import { Quaternion, Vector3 } from 'three';
import { OpticalComponent } from '../physics/Component';
import { Lamp } from '../physics/components/Lamp';
import { PrismLens } from '../physics/components/PrismLens';
import type { PresetResult } from '../state/store';

function clockPrism(prism: PrismLens, tiltDeg: number): void {
    const base = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tiltDeg * Math.PI / 180);
    prism.rotation.copy(tilt.multiply(base));
    prism.version++;
}

export function createPrismRecombinationScene(): PresetResult {
    const scene: OpticalComponent[] = [];

    const lamp = new Lamp('White lamp');
    lamp.beamRadius = 3.0;
    lamp.power = 1.0;
    lamp.sourcePointCount = 3;
    lamp.emitterRadius = 0.9;
    lamp.spectralCount = 7;
    lamp.setPosition(-120, 0, 0);
    lamp.pointAlong(1, 0, 0);
    scene.push(lamp);

    const disperser = new PrismLens(Math.PI / 3, 35, 30, 'Dispersing flint prism', 1.65);
    disperser.setPosition(-70, -8, 0);
    clockPrism(disperser, -18);
    scene.push(disperser);

    const collimator = new PrismLens(Math.PI / 3, 35, 30, 'Collimating inverse prism', 1.65);
    collimator.setPosition(0, -72, 0);
    clockPrism(collimator, -78);
    scene.push(collimator);

    const converger = new PrismLens(Math.PI / 3, 35, 30, 'Converging flint prism', 1.65);
    converger.setPosition(49, -72, 0);
    clockPrism(converger, 81.5);
    scene.push(converger);

    const finalPrism = new PrismLens(Math.PI / 3, 35, 30, 'Final inverse prism', 1.65);
    finalPrism.setPosition(145, 33, 0);
    clockPrism(finalPrism, 141.5);
    scene.push(finalPrism);

    return {
        scene,
        rayCount: 1000,
        rayConfig: {
            minRayOpacity: 0,
            maxRayOpacity: 0.10,
        },
    };
}
