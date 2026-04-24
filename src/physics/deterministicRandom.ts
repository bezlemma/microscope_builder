const FLOAT64_BUFFER = new ArrayBuffer(8);
const FLOAT64_VIEW = new Float64Array(FLOAT64_BUFFER);
const UINT32_VIEW = new Uint32Array(FLOAT64_BUFFER);

function mixHash(hash: number, value: number): number {
    let next = Math.imul(hash ^ value, 0x45d9f3b);
    next ^= next >>> 16;
    next = Math.imul(next, 0x45d9f3b);
    next ^= next >>> 16;
    return next >>> 0;
}

function mixNumber(hash: number, value: number): number {
    FLOAT64_VIEW[0] = Number.isFinite(value) ? value : 0;
    let next = mixHash(hash, UINT32_VIEW[0] >>> 0);
    next = mixHash(next, UINT32_VIEW[1] >>> 0);
    return next >>> 0;
}

export function hashNumbers(...values: number[]): number {
    let hash = 0x811c9dc5;
    for (const value of values) {
        hash = mixNumber(hash, value);
    }
    return hash >>> 0;
}

export function randomUnitFromHash(hash: number): number {
    return (hash >>> 0) / 0x1_0000_0000;
}

export function deterministicRandom(...values: number[]): number {
    return randomUnitFromHash(hashNumbers(...values));
}
