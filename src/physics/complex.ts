/**
 * Complex number arithmetic for Gaussian beam propagation.
 *
 * Shared module used by Solver2, and available to any future
 * physics code that needs complex math (e.g. Jones calculus).
 */

export interface Complex {
    re: number;
    im: number;
}

export function cAdd(a: Complex, b: Complex): Complex {
    return { re: a.re + b.re, im: a.im + b.im };
}

export function cMul(a: Complex, b: Complex): Complex {
    return {
        re: a.re * b.re - a.im * b.im,
        im: a.re * b.im + a.im * b.re
    };
}

export function cDiv(a: Complex, b: Complex): Complex {
    const denom = b.re * b.re + b.im * b.im;
    if (denom < 1e-30) return { re: 0, im: 0 };
    return {
        re: (a.re * b.re + a.im * b.im) / denom,
        im: (a.im * b.re - a.re * b.im) / denom
    };
}

export function cReal(x: number): Complex {
    return { re: x, im: 0 };
}

export function cInv(a: Complex): Complex {
    return cDiv({ re: 1, im: 0 }, a);
}
