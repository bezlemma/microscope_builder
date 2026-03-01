/**
 * Refractive Index and Physics Utilities
 * Extracted and documented from the Olive Optics Simulator
 */

export const Formulas = {
  SELLMEIER_F1: 1, // B1*L^2/(L^2 - C1^2) + ...
  SELLMEIER_F2: 2, // B1*L^2/(L^2 - C1) + ...
  POWER_SERIES: 3, // n^2 = C0 + C1*L^2 + C2*L^-2 + ...
  SCHOTT: 4        // Schott/Zemax type 1
};

/**
 * Calculates refractive index for a given material and wavelength.
 * @param {Object} material - Material parameters (B1, C1, etc.)
 * @param {number} wavelength - Wavelength in nm
 * @param {number} formulaType - Formula ID (0 for constant n)
 * @returns {number} The calculated refractive index
 */
export function calculateRefractiveIndex(material, wavelength, formulaType = 0) {
  if (formulaType === 0) return material.n || 1.0;
  
  const lambda = wavelength / 1000.0; // convert to μm
  const l2 = lambda * lambda;
  
  switch (formulaType) {
    case Formulas.SELLMEIER_F1: {
      let sum = 1.0;
      const { B1, C1, B2, C2, B3, C3 } = material;
      if (B1) sum += (B1 * l2) / (l2 - C1 * C1);
      if (B2) sum += (B2 * l2) / (l2 - C2 * C2);
      if (B3) sum += (B3 * l2) / (l2 - C3 * C3);
      return Math.sqrt(Math.max(sum, 1.0));
    }
    
    case Formulas.SELLMEIER_F2: {
      let sum = 1.0;
      const { B1, C1, B2, C2, B3, C3 } = material;
      if (B1) sum += (B1 * l2) / (l2 - C1);
      if (B2) sum += (B2 * l2) / (l2 - C2);
      if (B3) sum += (B3 * l2) / (l2 - C3);
      return Math.sqrt(Math.max(sum, 1.0));
    }
    
    case Formulas.POWER_SERIES: {
      const { C0, C1, C2, C3, C4, C5 } = material;
      const il2 = 1.0 / l2;
      const il4 = il2 * il2;
      const n2 = C0 + C1 * l2 + C2 * il2 + C3 * il4 + C4 * (il4 * il2) + C5 * (il4 * il4);
      return Math.sqrt(Math.max(n2, 1.0));
    }

    case Formulas.SCHOTT: {
      const { A0, A1, A2, A3, A4, A5 } = material;
      const il2 = 1.0 / l2;
      const il4 = il2 * il2;
      const n2 = A0 + A1 * l2 + A2 * il2 + A3 * il4 + A4 * (il4 * il2) + A5 * (il4 * il4);
      return Math.sqrt(Math.max(n2, 1.0));
    }

    default:
      return 1.0;
  }
}
