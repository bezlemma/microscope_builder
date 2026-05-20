export interface ProgressiveSamplingState {
    activeMask: Uint8Array;
    lastMean: Float32Array;
    stableDarkRounds: Uint8Array;
    sleepUntilRound: Uint32Array;
}

export interface ProgressiveSamplingOptions {
    minSamplesBeforeThrottle: number;
    darkThreshold: number;
    quietRelativeThreshold: number;
    stableRoundsBeforeSleep: number;
    darkSleepRounds: number;
}

export const DEFAULT_PROGRESSIVE_SAMPLING_OPTIONS: ProgressiveSamplingOptions = {
    minSamplesBeforeThrottle: 16,
    darkThreshold: 1e-12,
    quietRelativeThreshold: 0.03,
    stableRoundsBeforeSleep: 3,
    darkSleepRounds: 8,
};

export function createProgressiveSamplingState(pixelCount: number): ProgressiveSamplingState {
    return {
        activeMask: new Uint8Array(pixelCount).fill(1),
        lastMean: new Float32Array(pixelCount),
        stableDarkRounds: new Uint8Array(pixelCount),
        sleepUntilRound: new Uint32Array(pixelCount),
    };
}

export function prepareProgressiveActiveMask(state: ProgressiveSamplingState, round: number): Uint8Array {
    for (let i = 0; i < state.activeMask.length; i++) {
        state.activeMask[i] = state.sleepUntilRound[i] > round ? 0 : 1;
    }
    return state.activeMask;
}

export function updateProgressiveSamplingState(
    state: ProgressiveSamplingState,
    round: number,
    accumulatedEmission: Float32Array,
    accumulatedExcitation: Float32Array,
    accumulatedCounts: Uint32Array,
    roundCounts: Uint32Array,
    options: ProgressiveSamplingOptions = DEFAULT_PROGRESSIVE_SAMPLING_OPTIONS,
): void {
    const pixelCount = state.activeMask.length;
    for (let i = 0; i < pixelCount; i++) {
        if (roundCounts[i] === 0) continue;
        const count = accumulatedCounts[i];
        if (count < options.minSamplesBeforeThrottle) continue;

        const mean = accumulatedEmission[i] / Math.max(1, count);
        const excitationMean = accumulatedExcitation[i] / Math.max(1, count);
        const delta = Math.abs(mean - state.lastMean[i]);
        const quiet = delta < Math.max(options.darkThreshold, Math.abs(mean) * options.quietRelativeThreshold);
        const dark = Math.abs(mean) < options.darkThreshold && Math.abs(excitationMean) < options.darkThreshold;

        state.stableDarkRounds[i] = dark && quiet
            ? Math.min(255, state.stableDarkRounds[i] + 1)
            : 0;
        state.lastMean[i] = mean;

        if (state.stableDarkRounds[i] >= options.stableRoundsBeforeSleep) {
            state.sleepUntilRound[i] = Math.max(state.sleepUntilRound[i], round + options.darkSleepRounds);
            state.stableDarkRounds[i] = 0;
        }
    }
}
