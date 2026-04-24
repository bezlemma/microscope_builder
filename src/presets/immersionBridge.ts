import { Quaternion, Vector3 } from 'three';
import { MediumVolume } from '../physics/components/MediumVolume';
import { Objective } from '../physics/components/Objective';
import { SampleChamber } from '../physics/components/SampleChamber';

function bridgeQuaternion(axis: Vector3): Quaternion {
    return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis.clone().normalize());
}

export function createBridgeMediumBetweenPoints(
    startWorld: Vector3,
    endWorld: Vector3,
    refractiveIndex: number,
    startRadius: number,
    endRadius: number,
    name: string,
): MediumVolume {
    const axis = endWorld.clone().sub(startWorld);
    const depth = Math.max(axis.length(), 0.02);
    const direction = axis.lengthSq() > 1e-12 ? axis.clone().normalize() : new Vector3(0, 0, 1);
    const bridge = new MediumVolume({
        refractiveIndex,
        exteriorRefractiveIndex: 1,
        visualMode: 'bridge',
        depth,
        bridgeStartRadius: Math.max(startRadius, 0.05),
        bridgeEndRadius: Math.max(endRadius, 0.05),
        name,
    });
    const center = startWorld.clone().add(endWorld).multiplyScalar(0.5);
    bridge.setPosition(center.x, center.y, center.z);
    bridge.rotation.copy(bridgeQuaternion(direction));
    bridge.version++;
    bridge.updateMatrices();
    return bridge;
}

export function createObjectiveBridgeToPoint(
    objective: Objective,
    targetPoint: Vector3,
    name: string,
    endRadius?: number,
): MediumVolume {
    const tipWorld = objective.getSampleSideCenterWorld();
    return createBridgeMediumBetweenPoints(
        tipWorld,
        targetPoint,
        objective.immersionIndex,
        objective.getFrontRadius(),
        endRadius ?? Math.max(objective.getFrontRadius() * 0.8, 0.5),
        name,
    );
}

export function createObjectiveBridgeToHolderVolume(
    objective: Objective,
    holder: SampleChamber,
    name: string,
): MediumVolume | null {
    const tipWorld = objective.getSampleSideCenterWorld();
    const axisWorld = objective.getSampleSideNormalWorld();
    holder.updateMatrices();
    const localOrigin = tipWorld.clone().applyMatrix4(holder.worldToLocal);
    const localDir = axisWorld.clone().transformDirection(holder.worldToLocal).normalize();
    const bounds = holder.getVolumeBoundsLocal();

    let tMin = -Infinity;
    let tMax = Infinity;
    const updateAxis = (originCoord: number, dirCoord: number, minCoord: number, maxCoord: number): boolean => {
        if (Math.abs(dirCoord) < 1e-12) {
            return originCoord >= minCoord && originCoord <= maxCoord;
        }
        let t1 = (minCoord - originCoord) / dirCoord;
        let t2 = (maxCoord - originCoord) / dirCoord;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        return tMin <= tMax;
    };

    if (
        !updateAxis(localOrigin.x, localDir.x, bounds.min.x, bounds.max.x)
        || !updateAxis(localOrigin.y, localDir.y, bounds.min.y, bounds.max.y)
        || !updateAxis(localOrigin.z, localDir.z, bounds.min.z, bounds.max.z)
    ) {
        return null;
    }

    const t = tMin > 1e-4 ? tMin : (tMax > 1e-4 ? tMax : NaN);
    if (!Number.isFinite(t)) return null;

    const targetLocal = localOrigin.clone().addScaledVector(localDir, t);
    const targetWorld = targetLocal.applyMatrix4(holder.localToWorld);
    return createBridgeMediumBetweenPoints(
        tipWorld,
        targetWorld,
        holder.fillMediumIndex,
        objective.getFrontRadius(),
        Math.max(Math.min(holder.boreDiameter * 0.45, objective.getFrontRadius() * 1.5), 0.5),
        name,
    );
}
