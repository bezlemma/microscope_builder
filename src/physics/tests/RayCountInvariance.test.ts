import { describe, expect, test } from 'bun:test';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';
import { Laser } from '../components/Laser';
import { DichroicMirror } from '../components/DichroicMirror';
import { SpectralProfile } from '../SpectralProfile';

function splitScene(): { laser: Laser; dichroic: DichroicMirror } {
    const laser = new Laser('ray-count-source');
    laser.position.set(0, 0, 0);
    laser.pointAlong(1, 0, 0);
    laser.wavelength = 488;
    laser.power = 1;

    const dichroic = new DichroicMirror(
        25.4,
        2,
        new SpectralProfile('longpass', 501),
        'three-percent-dichroic',
    );
    dichroic.position.set(40, 0, 0);
    dichroic.pointAlong(-1, 1, 0);

    return { laser, dichroic };
}

describe('ray-count invariant branch physics', () => {
    test('dichroic split branches do not disappear when per-ray power falls', () => {
        for (const rayCount of [32, 5000]) {
            const { laser, dichroic } = splitScene();
            const scene = [laser, dichroic];
            const sourceRays = createSourceRays(scene, rayCount, 'full');
            const paths = new Solver1(scene).trace(sourceRays);

            expect(paths).toHaveLength(sourceRays.length * 2);
            expect(paths.every(path => path[0]?.sourceId === laser.id)).toBe(true);
        }
    });
});
