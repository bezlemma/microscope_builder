import { describe, expect, test } from "bun:test";
import { SpectralProfile } from "../SpectralProfile";
import { Sample } from "../components/Sample";

describe("SpectralProfile", () => {
    test("NIR bandpass spectra expose their dominant wavelength", () => {
        const profile = new SpectralProfile("bandpass", 920, [{ center: 920, width: 80 }]);
        expect(profile.getDominantPassWavelength()).toBe(920);

        const sample = new Sample();
        sample.excitationSpectrum = profile;
        expect(sample.getExcitationWavelength()).toBe(920);
    });
});
