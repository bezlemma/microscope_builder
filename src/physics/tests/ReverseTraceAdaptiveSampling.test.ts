import { describe, expect, test } from 'bun:test';
import {
    createProgressiveSamplingState,
    prepareProgressiveActiveMask,
    updateProgressiveSamplingState,
} from '../reverseTraceAdaptiveSampling';

describe('Reverse tracer progressive adaptive sampling', () => {
    test('keeps stable signal pixels active across progressive rounds', () => {
        const state = createProgressiveSamplingState(1);
        const emission = new Float32Array([0]);
        const excitation = new Float32Array([0]);
        const counts = new Uint32Array([0]);
        const roundCounts = new Uint32Array([8]);

        for (let round = 0; round < 12; round++) {
            const mask = prepareProgressiveActiveMask(state, round);
            expect(mask[0]).toBe(1);
            emission[0] += 0.01 * roundCounts[0];
            excitation[0] += 0.001 * roundCounts[0];
            counts[0] += roundCounts[0];
            updateProgressiveSamplingState(state, round, emission, excitation, counts, roundCounts);
        }

        expect(state.sleepUntilRound[0]).toBe(0);
        expect(prepareProgressiveActiveMask(state, 12)[0]).toBe(1);
    });

    test('throttles dark pixels temporarily instead of permanently disabling them', () => {
        const state = createProgressiveSamplingState(1);
        const emission = new Float32Array([0]);
        const excitation = new Float32Array([0]);
        const counts = new Uint32Array([0]);
        const roundCounts = new Uint32Array([8]);

        for (let round = 0; round < 4; round++) {
            expect(prepareProgressiveActiveMask(state, round)[0]).toBe(1);
            counts[0] += roundCounts[0];
            updateProgressiveSamplingState(state, round, emission, excitation, counts, roundCounts);
        }

        expect(state.sleepUntilRound[0]).toBeGreaterThan(4);
        expect(prepareProgressiveActiveMask(state, 4)[0]).toBe(0);
        expect(prepareProgressiveActiveMask(state, state.sleepUntilRound[0])[0]).toBe(1);
    });
});
