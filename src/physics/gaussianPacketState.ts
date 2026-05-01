const MIN_PHYSICAL_PACKET_RADIUS_MM = 0.001;

export interface ComplexLike {
    re: number;
    im: number;
}

export interface GaussianAxisState {
    sigma: number;
    curvatureRadius: number;
}

export interface GaussianPacketQ {
    uu: ComplexLike;
    uv: ComplexLike;
    vv: ComplexLike;
}

function complex(re = 0, im = 0): ComplexLike {
    return { re, im };
}

export function cloneComplex(value: ComplexLike): ComplexLike {
    return { re: value.re, im: value.im };
}

export function cloneGaussianPacketQ(q: GaussianPacketQ): GaussianPacketQ {
    return {
        uu: cloneComplex(q.uu),
        uv: cloneComplex(q.uv),
        vv: cloneComplex(q.vv),
    };
}

export function complexAdd(a: ComplexLike, b: ComplexLike): ComplexLike {
    return { re: a.re + b.re, im: a.im + b.im };
}

export function complexSub(a: ComplexLike, b: ComplexLike): ComplexLike {
    return { re: a.re - b.re, im: a.im - b.im };
}

export function complexMul(a: ComplexLike, b: ComplexLike): ComplexLike {
    return {
        re: a.re * b.re - a.im * b.im,
        im: a.re * b.im + a.im * b.re,
    };
}

export function complexScale(a: ComplexLike, scale: number): ComplexLike {
    return { re: a.re * scale, im: a.im * scale };
}

export function complexDiv(a: ComplexLike, b: ComplexLike): ComplexLike {
    const denom = b.re * b.re + b.im * b.im;
    if (denom <= 1e-30) return complex(0, 0);
    return {
        re: (a.re * b.re + a.im * b.im) / denom,
        im: (a.im * b.re - a.re * b.im) / denom,
    };
}

export function complexArg(a: ComplexLike): number {
    return Math.atan2(a.im, a.re);
}

function clampSigma(value: number): number {
    return Math.max(value, MIN_PHYSICAL_PACKET_RADIUS_MM / 3);
}

export function gaussianAxisStateToQ(
    sigma: number,
    curvatureRadius: number,
    wavelengthMm: number,
    refractiveIndex: number,
): ComplexLike {
    const safeSigma = clampSigma(sigma);
    const effectiveWavelengthMm = Math.max(wavelengthMm / Math.max(refractiveIndex, 1e-9), 1e-12);
    const imagOneOverQ = -effectiveWavelengthMm / (2 * Math.PI * safeSigma * safeSigma);
    const realOneOverQ = Number.isFinite(curvatureRadius)
        ? Math.sign(curvatureRadius) / Math.max(Math.abs(curvatureRadius), 1e-12)
        : 0;
    const denom = realOneOverQ * realOneOverQ + imagOneOverQ * imagOneOverQ;
    if (denom <= 1e-30) {
        return { re: 0, im: (2 * Math.PI * safeSigma * safeSigma) / effectiveWavelengthMm };
    }
    return {
        re: realOneOverQ / denom,
        im: -imagOneOverQ / denom,
    };
}

export function gaussianAxisStateFromQ(
    q: ComplexLike,
    wavelengthMm: number,
    refractiveIndex: number,
): GaussianAxisState {
    const denom = q.re * q.re + q.im * q.im;
    if (denom <= 1e-30) {
        return {
            sigma: MIN_PHYSICAL_PACKET_RADIUS_MM / 3,
            curvatureRadius: Number.POSITIVE_INFINITY,
        };
    }

    const oneOverQRe = q.re / denom;
    const oneOverQIm = -q.im / denom;
    const effectiveWavelengthMm = Math.max(wavelengthMm / Math.max(refractiveIndex, 1e-9), 1e-12);
    const sigmaSq = effectiveWavelengthMm / Math.max(-2 * Math.PI * oneOverQIm, 1e-30);
    return {
        sigma: clampSigma(Math.sqrt(sigmaSq)),
        curvatureRadius: Math.abs(oneOverQRe) > 1e-15 ? 1 / oneOverQRe : Number.POSITIVE_INFINITY,
    };
}

export function gaussianPacketQFromAxisStates(
    axisU: GaussianAxisState,
    axisV: GaussianAxisState,
    wavelengthMm: number,
    refractiveIndex: number,
): GaussianPacketQ {
    return {
        uu: gaussianAxisStateToQ(axisU.sigma, axisU.curvatureRadius, wavelengthMm, refractiveIndex),
        uv: complex(0, 0),
        vv: gaussianAxisStateToQ(axisV.sigma, axisV.curvatureRadius, wavelengthMm, refractiveIndex),
    };
}

export function propagateGaussianPacketQ(
    q: GaussianPacketQ,
    distance: number,
): GaussianPacketQ {
    return {
        uu: { re: q.uu.re + distance, im: q.uu.im },
        uv: cloneComplex(q.uv),
        vv: { re: q.vv.re + distance, im: q.vv.im },
    };
}

export function invertGaussianPacketQ(q: GaussianPacketQ): GaussianPacketQ {
    const det = complexSub(complexMul(q.uu, q.vv), complexMul(q.uv, q.uv));
    const invDet = complexDiv(complex(1, 0), det);
    return {
        uu: complexMul(q.vv, invDet),
        uv: complexScale(complexMul(q.uv, invDet), -1),
        vv: complexMul(q.uu, invDet),
    };
}

export function detGaussianPacketQ(q: GaussianPacketQ): ComplexLike {
    return complexSub(complexMul(q.uu, q.vv), complexMul(q.uv, q.uv));
}

export function gaussianPacketGouyPhase(
    launchQ: GaussianPacketQ,
    propagatedQ: GaussianPacketQ,
): number {
    const launchArg = complexArg(detGaussianPacketQ(launchQ));
    const propagatedArg = complexArg(detGaussianPacketQ(propagatedQ));
    return 0.5 * (propagatedArg - launchArg);
}

export function transformGaussianAxisQ(
    q: ComplexLike,
    transform: [number, number, number, number],
): ComplexLike {
    const [a, b, c, d] = transform;
    return complexDiv(
        complexAdd(complexScale(q, a), complex(b, 0)),
        complexAdd(complexScale(q, c), complex(d, 0)),
    );
}

export function transformGaussianPacketQABCD(
    q: GaussianPacketQ,
    transformU: [number, number, number, number],
    transformV: [number, number, number, number],
): GaussianPacketQ {
    return {
        uu: transformGaussianAxisQ(q.uu, transformU),
        // Off-diagonal astigmatic coupling is intentionally not introduced
        // by this paraxial pass; keep any existing coupling for future analyzers.
        uv: cloneComplex(q.uv),
        vv: transformGaussianAxisQ(q.vv, transformV),
    };
}
