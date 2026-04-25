/**
 * SpectralProfile — wavelength-dependent transmission model.
 *
 * Used by Filter and DichroicMirror to compute how much light passes
 * through (or is reflected) at a given wavelength.
 *
 * Supports: longpass, shortpass, bandpass, multiband, and custom profiles.
 * Edge transitions use a smooth sigmoid for realistic rolloff.
 */

export type ProfilePreset = 'longpass' | 'shortpass' | 'bandpass' | 'multiband';

export interface ProfileBand {
    center: number;   // nm — center wavelength of the passband
    width: number;    // nm — FWHM of the passband
}

export class SpectralProfile {
    preset: ProfilePreset;
    cutoffNm: number;          // nm — edge wavelength for longpass/shortpass
    bands: ProfileBand[];      // passbands for bandpass/multiband
    edgeSteepness: number;     // nm — transition width (smaller = sharper edge)

    constructor(
        preset: ProfilePreset = 'longpass',
        cutoffNm: number = 500,
        bands: ProfileBand[] = [{ center: 525, width: 50 }],
        edgeSteepness: number = 15
    ) {
        this.preset = preset;
        this.cutoffNm = cutoffNm;
        this.bands = bands;
        this.edgeSteepness = Math.max(1, edgeSteepness);
    }

    /**
     * Compute transmission (0–1) at a given wavelength.
     */
    getTransmission(wavelengthNm: number): number {
        switch (this.preset) {
            case 'longpass':
                return this.sigmoid(wavelengthNm - this.cutoffNm);

            case 'shortpass':
                return this.sigmoid(this.cutoffNm - wavelengthNm);

            case 'bandpass':
                if (this.bands.length === 0) return 0;
                return this.bandTransmission(wavelengthNm, this.bands[0]);

            case 'multiband':
                if (this.bands.length === 0) return 0;
                // Union of bands — take the maximum transmission
                let maxT = 0;
                for (const band of this.bands) {
                    maxT = Math.max(maxT, this.bandTransmission(wavelengthNm, band));
                }
                return maxT;

            default:
                return 1;
        }
    }

    /**
     * Generate sample points for the transmission curve chart.
     */
    getSampleCurve(numPoints: number = 200): { nm: number; t: number }[] {
        const points: { nm: number; t: number }[] = [];
        const { minNm: start, maxNm: end } = this.getSearchRange();
        const step = (end - start) / (numPoints - 1);
        for (let i = 0; i < numPoints; i++) {
            const nm = start + i * step;
            points.push({ nm, t: this.getTransmission(nm) });
        }
        return points;
    }

    /**
     * Get a description string for the profile.
     */
    getLabel(): string {
        switch (this.preset) {
            case 'longpass':
                return `LP ${this.cutoffNm}`;
            case 'shortpass':
                return `SP ${this.cutoffNm}`;
            case 'bandpass':
                if (this.bands.length > 0) {
                    const b = this.bands[0];
                    return `BP ${b.center}/${b.width}`;
                }
                return 'BP';
            case 'multiband':
                return `MB (${this.bands.length} bands)`;
            default:
                return 'Custom';
        }
    }

    /**
     * Get the dominant pass wavelength for physics and visualization.
     */
    getDominantPassWavelength(): number | null {
        const bandPeak = this.getDominantBandPeak();
        if (bandPeak !== null) return bandPeak;

        const { minNm, maxNm } = this.getSearchRange();
        let bestNm = 0;
        let bestT = 0;
        for (let nm = minNm; nm <= maxNm; nm += 5) {
            const t = this.getTransmission(nm);
            if (t > bestT) {
                bestT = t;
                bestNm = nm;
            }
        }
        return bestT > 0.1 ? bestNm : null;
    }

    // ── Private helpers ────────────────────────────────────────

    private getSearchRange(): { minNm: number; maxNm: number } {
        let minNm = 350;
        let maxNm = 850;

        if (this.bands.length > 0) {
            for (const band of this.bands) {
                minNm = Math.min(minNm, band.center - band.width);
                maxNm = Math.max(maxNm, band.center + band.width);
            }
        }

        minNm = Math.min(minNm, this.cutoffNm - 200);
        maxNm = Math.max(maxNm, this.cutoffNm + 200);

        return {
            minNm: Math.max(180, Math.floor(minNm / 5) * 5),
            maxNm: Math.min(1600, Math.ceil(maxNm / 5) * 5),
        };
    }

    private getDominantBandPeak(): number | null {
        if (this.preset !== 'bandpass' && this.preset !== 'multiband') return null;
        let bestNm: number | null = null;
        let bestT = 0;
        for (const band of this.bands) {
            const t = this.getTransmission(band.center);
            if (t > bestT) {
                bestT = t;
                bestNm = band.center;
            }
        }
        return bestT > 0.1 ? bestNm : null;
    }

    /** Smooth sigmoid: 0→1 transition centered at x=0 */
    private sigmoid(x: number): number {
        const k = 4.0 / this.edgeSteepness;  // scale so transition happens over edgeSteepness nm
        return 1 / (1 + Math.exp(-k * x));
    }

    /** Bandpass: product of two sigmoids (rising left edge, falling right edge) */
    private bandTransmission(wavelengthNm: number, band: ProfileBand): number {
        const halfW = band.width / 2;
        const leftEdge = this.sigmoid(wavelengthNm - (band.center - halfW));
        const rightEdge = this.sigmoid((band.center + halfW) - wavelengthNm);
        return leftEdge * rightEdge;
    }

    /**
     * Clone this profile.
     */
    clone(): SpectralProfile {
        return new SpectralProfile(
            this.preset,
            this.cutoffNm,
            this.bands.map(b => ({ ...b })),
            this.edgeSteepness
        );
    }
}
