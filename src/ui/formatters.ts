export function formatPower(watts: number, digits = 2): string {
    if (!Number.isFinite(watts) || watts <= 0) return '0 W';
    if (watts >= 1) return `${watts.toFixed(digits)} W`;
    if (watts >= 1e-3) return `${(watts * 1e3).toFixed(digits)} mW`;
    if (watts >= 1e-6) return `${(watts * 1e6).toFixed(digits)} uW`;
    if (watts >= 1e-9) return `${(watts * 1e9).toFixed(digits)} nW`;
    if (watts >= 1e-12) return `${(watts * 1e12).toFixed(digits)} pW`;
    return `${watts.toExponential(digits)} W`;
}
