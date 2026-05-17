import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';

import { createCheHangYu2026Scene } from '../../presets/CheHangYu2026';
import { Solver1 } from '../Solver1';
import { createSourceRays } from '../SourceRayFactory';
import { SphericalLens } from '../components/SphericalLens';
import { Card } from '../components/Card';
import { Mirror } from '../components/Mirror';
import { Laser } from '../components/Laser';
import { PolarizingBeamSplitter } from '../components/PolarizingBeamSplitter';
import { Waveplate } from '../components/Waveplate';
import { Coherence, Ray, defaultTransversePolarization, jonesMagSq } from '../types';

function centralLaserRay(laser: Laser): Ray {
    const direction = new Vector3(0, 0, 1).applyQuaternion(laser.rotation).normalize();
    return {
        origin: laser.position.clone().addScaledVector(direction, 3),
        direction,
        wavelength: laser.wavelength * 1e-9,
        intensity: 1,
        polarization: defaultTransversePolarization(direction),
        opticalPathLength: 0,
        footprintRadius: laser.beamRadius,
        coherenceMode: Coherence.Coherent,
        isMainRay: true,
        sourceId: laser.id,
    };
}

/** Of all the branches Solver 1 explores from one source ray, pick the one
 *  that actually reached the named component — that's the doubler exit path. */
function pathHitting(scene: ReturnType<typeof createCheHangYu2026Scene>['scene'], paths: Ray[][], name: string): string[] | null {
    const namePaths = paths.map(path =>
        path.map(ray => ray.interactionComponentId
            ? scene.find(c => c.id === ray.interactionComponentId)?.name
            : undefined)
            .filter((n): n is string => !!n)
    );
    return namePaths.find(names => names.some(n => n.includes(name))) ?? null;
}

function finalPbsCardChild(scene: ReturnType<typeof createCheHangYu2026Scene>['scene'], paths: Ray[][]): Ray | null {
    const pbs = scene.find(c => c instanceof PolarizingBeamSplitter) as PolarizingBeamSplitter;
    for (const path of paths) {
        for (let i = path.length - 2; i >= 1; i--) {
            if (path[i].interactionComponentId !== pbs.id) continue;
            const child = path[i + 1];
            if (child.direction.y < -0.5) return child;
        }
    }
    return null;
}

describe('Che-Hang Yu 2026 — Nisam2× demo preset', () => {
    test('contains the minimum hardware needed to demonstrate angle doubling', () => {
        const { scene } = createCheHangYu2026Scene();
        const lasers = scene.filter(c => c instanceof Laser);
        const pbses = scene.filter(c => c instanceof PolarizingBeamSplitter);
        const waveplates = scene.filter(c => c instanceof Waveplate);
        const scanLenses = scene.filter(c => c instanceof SphericalLens);
        const mirrors = scene.filter(c => c instanceof Mirror);
        const cards = scene.filter(c => c instanceof Card);

        expect(lasers.length).toBe(1);
        expect(pbses.length).toBe(1);
        expect(waveplates.length).toBe(1);          // just the λ/4 — no λ/2 needed now
        expect(waveplates[0].waveplateMode).toBe('quarter');
        expect(scanLenses.length).toBe(2);          // 4-f relay
        expect(mirrors.length).toBe(2);             // resonant + slow scan mirrors
        expect(cards.length).toBe(1);               // doubled-scan output
        expect(cards[0].opaque).toBe(true);         // imaging card absorbs rays
    });

    test('launches with polarization view and animation on', () => {
        const result = createCheHangYu2026Scene();
        expect(result.rayConfig?.colorByPolarization).toBe(true);
        expect(result.animationPlaying).toBe(true);
        // The animation drives both scan axes via mirror orientation directly.
        const targets = (result.channels ?? []).map(ch => ch.property);
        expect(targets).toContain('panAngle');
        expect(targets).toContain('tiltAngle');
    });

    test('the laser beam bounces off the resonant scanner twice and exits to the card', () => {
        const { scene } = createCheHangYu2026Scene();
        const laser = scene.find(c => c instanceof Laser) as Laser;
        const paths = new Solver1(scene).trace([centralLaserRay(laser)]);

        const cardPath = pathHitting(scene, paths, 'Doubled-scan viewing card');
        expect(cardPath).not.toBeNull();
        // The headline trick: the resonant scanner shows up TWICE in the same path.
        const resonantHits = cardPath!.filter(n => n.includes('Resonant Scanner')).length;
        expect(resonantHits).toBe(2);
        // Both scan lenses also appear twice (once each way through the relay).
        expect(cardPath!.filter(n => n.includes('Scan Lens 1')).length).toBe(2);
        expect(cardPath!.filter(n => n.includes('Scan Lens 2')).length).toBe(2);
        // The λ/4 plate is traversed twice (forward + return).
        expect(cardPath!.filter(n => n.includes('λ/4')).length).toBe(2);
    });

    test('any final PBS leakage branch is not marked as the main ray', () => {
        const { scene } = createCheHangYu2026Scene();
        const pbs = scene.find(c => c instanceof PolarizingBeamSplitter) as PolarizingBeamSplitter;
        const paths = new Solver1(scene).trace(createSourceRays(scene, 32, 'full'));

        const finalPbsChildren: { incoming: Ray; child: Ray }[] = [];
        for (const path of paths) {
            let pbsIndex = -1;
            for (let i = 1; i < path.length - 1; i++) {
                if (path[i].interactionComponentId === pbs.id) pbsIndex = i;
            }
            if (pbsIndex >= 0) {
                finalPbsChildren.push({ incoming: path[pbsIndex], child: path[pbsIndex + 1] });
            }
        }

        const cardBranch = finalPbsChildren.find(({ child }) => child.direction.y < -0.9 && child.isMainRay === true);
        const leakageBranch = finalPbsChildren.find(({ child }) => child.direction.x < -0.9);
        expect(cardBranch).toBeDefined();
        if (leakageBranch) {
            expect(leakageBranch.child.isMainRay).toBe(false);
            expect(leakageBranch.child.intensity / leakageBranch.incoming.intensity).toBeLessThan(1e-3);
        }
    });

    test('scan extrema still find the viewing card', () => {
        const halfAngle = (5 * Math.PI) / 180; // ±5° mechanical, the preset's full range
        for (const [scanX, scanY] of [
            [halfAngle, 0],
            [-halfAngle, 0],
            [0, halfAngle * 0.5],
            [0, -halfAngle * 0.5],
        ]) {
            const { scene } = createCheHangYu2026Scene();
            const laser = scene.find(c => c instanceof Laser) as Laser;
            const mirrors = scene.filter(c => c instanceof Mirror) as Mirror[];
            const resonant = mirrors.find(m => m.name.includes('Resonant'))!;
            const slow = mirrors.find(m => m.name.includes('Slow'))!;
            resonant.panAngle = resonant.panAngle + scanX;
            resonant.recomputeRotation();
            slow.tiltAngle = scanY;
            slow.recomputeRotation();
            const paths = new Solver1(scene).trace([centralLaserRay(laser)]);
            const cardPath = pathHitting(scene, paths, 'Doubled-scan viewing card');
            expect(cardPath).not.toBeNull();
        }
    });

    test('PBS513 transmitted output remains transverse and normalized through slow scan', () => {
        const slowHalfAngle = (2.5 * Math.PI) / 180;
        for (const slowScan of [-slowHalfAngle, 0, slowHalfAngle]) {
            const { scene } = createCheHangYu2026Scene();
            const laser = scene.find(c => c instanceof Laser) as Laser;
            const slow = (scene.filter(c => c instanceof Mirror) as Mirror[])
                .find(m => m.name.includes('Slow'))!;

            slow.tiltAngle = slowScan;
            slow.recomputeRotation();

            const cardChild = finalPbsCardChild(scene, new Solver1(scene).trace([centralLaserRay(laser)]));
            expect(cardChild).not.toBeNull();
            const p = cardChild!.polarization;
            const d = cardChild!.direction;
            const longitudinalRe = p.x.re * d.x + p.y.re * d.y + p.z.re * d.z;
            const longitudinalIm = p.x.im * d.x + p.y.im * d.y + p.z.im * d.z;
            expect(Math.hypot(longitudinalRe, longitudinalIm)).toBeLessThan(1e-6);
            expect(jonesMagSq(p)).toBeCloseTo(1, 5);
        }
    });
});
