import { useAtom } from 'jotai';
import { selectionAtom } from '../state/selectionAtom';
import { OpticalComponent } from '../physics/Component';
import { Ray, HitRecord, InteractionResult, childRay } from '../physics/types';
import { Vector3, Box3, DoubleSide } from 'three';

export class ObjectiveCasing extends OpticalComponent {
    constructor(name: string = "Objective Housing") {
        super(name);
        this.bounds = new Box3(new Vector3(-10, -10, -20), new Vector3(10, 10, 5));
    }

    intersect(_rayLocal: Ray): HitRecord | null {
        // Physics-invisible: rays pass through the housing
        return null;
    }

    interact(ray: Ray, _hit: HitRecord): InteractionResult {
        return { rays: [childRay(ray, {})] };
    }
}

// ─── Visualizer ────────────────────────────────────────────

export const CasingVisualizer = ({ component }: { component: ObjectiveCasing }) => {
    const [selection] = useAtom(selectionAtom);
    const isSelected = selection.includes(component.id);
    const bodyColor = isSelected ? '#555577' : '#3a3a50';
    return (
        <group
            position={[component.position.x, component.position.y, component.position.z]}
            quaternion={component.rotation.clone()}
            onClick={(e) => { e.stopPropagation(); }}
        >
            <mesh>
                <cylinderGeometry args={[13, 13, 35, 24]} />
                <meshStandardMaterial color={bodyColor} metalness={0.35} roughness={0.55} side={DoubleSide} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, -5]}>
                <cylinderGeometry args={[14, 10, 8, 24]} />
                <meshStandardMaterial color="#555" metalness={0.4} roughness={0.5} />
            </mesh>
        </group>
    );
};
