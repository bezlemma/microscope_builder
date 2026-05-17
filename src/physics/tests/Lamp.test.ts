import { describe, expect, test } from 'bun:test';
import { generateLampSpectrum } from '../components/Lamp';

describe('Lamp spectrum generation', () => {
    test('default broadband sampling covers violet through red for prism dispersion', () => {
        expect(generateLampSpectrum(7)).toEqual([420, 460, 500, 540, 580, 620, 660]);
    });

    test('three-line lamps use blue, green, and red display primaries', () => {
        expect(generateLampSpectrum(3)).toEqual([460, 540, 650]);
    });
});
