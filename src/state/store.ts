import { atom } from 'jotai';
import { OpticalComponent } from '../physics/Component';
import { Mirror } from '../physics/components/Mirror';
import { SphericalLens } from '../physics/components/SphericalLens';
import { Vector3 } from 'three';

// --- State Types ---
export interface RayConfig {
    rayCount: number; // Number of intermediate rays
    showFootprint: boolean;
}

// --- Atoms ---

import { Card } from '../physics/components/Card';
import { Laser } from '../physics/components/Laser';

// 1. Component List (The Scene Graph)
// 1. Component List (The Scene Graph)
export const createBeamExpanderScene = (): OpticalComponent[] => [
    // Laser Source
    (() => {
        const c = new Laser("Green Laser (532nm)");
        c.setPosition(-150, 0, 0); // Start on the left
        c.setRotation(0, 0, 0);
        return c;
    })(),
    // Beam Expander - Element 1 (f = 50mm)
    (() => {
        const c = new SphericalLens(1/50.0, 15, 4, "Expander Lens 1 (f=50)");
        c.setPosition(-100, 0, 0); // 50mm from Laser
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })(),
    // Beam Expander - Element 2 (f = 100mm)
    // Separation for afocal = f1 + f2 = 50 + 100 = 150mm.
    // Pos = -100 + 150 = 50mm.
    (() => {
        const c = new SphericalLens(1/100.0, 25, 4, "Expander Lens 2 (f=100)");
        c.setPosition(50, 0, 0);
        c.setRotation(0, Math.PI / 2, 0);
        return c;
    })()
];

// Initialized with the Infinity System Demo for now, but will be dynamic.
export const componentsAtom = atom<OpticalComponent[]>(createBeamExpanderScene());

// 2. Selection State
export const selectionAtom = atom<string | null>(null);

// 3. Ray Configuration
export const rayConfigAtom = atom<RayConfig>({
    rayCount: 4, 
    showFootprint: false
});

// 4. Interaction State
export const isDraggingAtom = atom<boolean>(false);
