import React, { useMemo } from 'react';
import { useAtom } from 'jotai';
import { Box3 } from 'three';
import { componentsAtom } from '../state/store';
import { Rail } from '../physics/components/Rail';
import { OpticalComponent } from '../physics/Component';

const GRID_OFFSET = 12.5;
const GRID_SPACING = 25;
const GHOST_COLOR = '#007fff';
/** Half-width in mm for declaring an XY to be "on a hole". */
const HOLE_EPSILON = 0.5;
/** Perpendicular mm from a rail line segment counted as "on the rail". */
const RAIL_EPSILON = 0.5;

type SnapTarget =
    | { kind: 'hole'; x: number; y: number; topZ: number }
    | { kind: 'rail'; x: number; y: number; topZ: number };

function nearestHoleSnap(x: number, y: number): { hx: number; hy: number; distSq: number } {
    const hx = Math.round((x - GRID_OFFSET) / GRID_SPACING) * GRID_SPACING + GRID_OFFSET;
    const hy = Math.round((y - GRID_OFFSET) / GRID_SPACING) * GRID_SPACING + GRID_OFFSET;
    const dx = x - hx, dy = y - hy;
    return { hx, hy, distSq: dx * dx + dy * dy };
}

function railProjection(rail: Rail, x: number, y: number):
    { px: number; py: number; perpDist: number } | null {
    const a = rail.holeA, b = rail.holeB;
    const abx = b.x - a.x, aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-6) return null;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lenSq));
    const px = a.x + t * abx;
    const py = a.y + t * aby;
    const dx = x - px, dy = y - py;
    return { px, py, perpDist: Math.sqrt(dx * dx + dy * dy) };
}

function detectSnapTarget(
    comp: OpticalComponent,
    rails: Rail[],
): SnapTarget | null {
    const x = comp.position.x;
    const y = comp.position.y;

    // Rail check first — a rail sits 'on top' of the table so if the component
    // is right on a rail endpoint that also matches a hole, we prefer the rail
    // so the indicator lands on the rail rather than piercing through it.
    for (const rail of rails) {
        if (rail === comp || rail.id === comp.id) continue;
        const proj = railProjection(rail, x, y);
        if (proj && proj.perpDist < RAIL_EPSILON) {
            return {
                kind: 'rail',
                x: proj.px,
                y: proj.py,
                topZ: Rail.TABLE_Z + rail.profileHeight,
            };
        }
    }

    const hole = nearestHoleSnap(x, y);
    if (hole.distSq < HOLE_EPSILON * HOLE_EPSILON) {
        return {
            kind: 'hole',
            x: hole.hx,
            y: hole.hy,
            topZ: Rail.TABLE_Z, // table surface
        };
    }
    return null;
}

export const AltSnapIndicator: React.FC = () => {
    const [components] = useAtom(componentsAtom);

    const indicators = useMemo(() => {
        if (!components) return [];
        const rails = components.filter((c): c is Rail => c instanceof Rail);
        const out: { id: string; target: SnapTarget; componentBottomZ: number }[] = [];
        for (const c of components) {
            // Skip rails themselves and ghost components.
            if (c instanceof Rail) continue;
            if (c.isGhost) continue;
            const target = detectSnapTarget(c, rails);
            if (target) {
                // World-space bottom of the component: transform local bounds to
                // world and take min Z.  This is the first edge the post meets
                // coming up from the table — stop there instead of driving into
                // the component body.
                const worldBounds = c.bounds.clone().applyMatrix4(c.localToWorld) as Box3;
                out.push({ id: c.id, target, componentBottomZ: worldBounds.min.z });
            }
        }
        return out;
    }, [components]);

    if (indicators.length === 0) return null;

    return (
        <group>
            {indicators.map(({ id, target, componentBottomZ }) => {
                const bottom = target.topZ;
                const top = Math.max(bottom + 0.5, componentBottomZ);
                const height = Math.max(0.1, top - bottom);
                const centerZ = (bottom + top) / 2;
                return (
                    <mesh
                        key={id}
                        position={[target.x, target.y, centerZ]}
                        rotation={[Math.PI / 2, 0, 0]}
                    >
                        <cylinderGeometry args={[1.5, 1.5, height, 20]} />
                        <meshStandardMaterial
                            color={GHOST_COLOR}
                            emissive={GHOST_COLOR}
                            emissiveIntensity={1.4}
                            transparent
                            opacity={0.55}
                            depthWrite={false}
                        />
                    </mesh>
                );
            })}
        </group>
    );
};
