import { describe, expect, test } from 'bun:test';
import { generateLampSpectrum } from '../components/Lamp';

describe('Lamp spectrum generation', () => {
    test('default broadband sampling covers violet through red for prism dispersion', () => {
        const spectrum = generateLampSpectrum(7);

        expect(spectrum).toHaveLength(7);
        expect(spectrum[0]).toBe(415);
        expect(spectrum[3]).toBeCloseTo(537.5, 12);
        expect(spectrum[6]).toBe(660);
    });

    test('three-line lamps use blue, green, and red display primaries', () => {
        expect(generateLampSpectrum(3)).toEqual([460, 540, 650]);
    });
});
