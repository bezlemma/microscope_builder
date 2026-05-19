import { Vector3 } from 'three';
import type { OpticalComponent } from '../physics/Component';

export interface TableSelectionRect {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export function tableSelectionRectFromPoints(
    start: { x: number; y: number },
    end: { x: number; y: number },
): TableSelectionRect {
    return {
        minX: Math.min(start.x, end.x),
        maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y),
    };
}

function componentTableBounds(component: OpticalComponent): TableSelectionRect {
    component.updateMatrices();

    const { min, max } = component.bounds;
    const corners = [
        new Vector3(min.x, min.y, min.z),
        new Vector3(min.x, min.y, max.z),
        new Vector3(min.x, max.y, min.z),
        new Vector3(min.x, max.y, max.z),
        new Vector3(max.x, min.y, min.z),
        new Vector3(max.x, min.y, max.z),
        new Vector3(max.x, max.y, min.z),
        new Vector3(max.x, max.y, max.z),
    ].map(point => point.applyMatrix4(component.localToWorld));

    return {
        minX: Math.min(...corners.map(point => point.x)),
        maxX: Math.max(...corners.map(point => point.x)),
        minY: Math.min(...corners.map(point => point.y)),
        maxY: Math.max(...corners.map(point => point.y)),
    };
}

export function componentIntersectsTableSelectionRect(
    component: OpticalComponent,
    rect: TableSelectionRect,
): boolean {
    if (component.isGhost || component.isSubComponent) return false;
    const bounds = componentTableBounds(component);
    return bounds.maxX >= rect.minX
        && bounds.minX <= rect.maxX
        && bounds.maxY >= rect.minY
        && bounds.minY <= rect.maxY;
}

export function selectedComponentIdsInTableRect(
    components: OpticalComponent[],
    rect: TableSelectionRect,
): string[] {
    return components
        .filter(component => componentIntersectsTableSelectionRect(component, rect))
        .map(component => component.id);
}
