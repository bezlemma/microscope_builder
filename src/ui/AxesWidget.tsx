import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport } from '@react-three/drei';
import { Quaternion, Vector3 } from 'three';
import { useIsMobile } from './useIsMobile';

/**
 * Module-scoped quaternion shared between the main Canvas and the gizmo Canvas.
 * Updated every frame by AxesCameraPublisher (main Canvas),
 * read every frame by CameraSubscriber (gizmo Canvas).
 */
const sharedQuaternion: { current: Quaternion } = { current: new Quaternion() };

/**
 * Module-scoped callback: gizmo axis click -> main camera animation.
 * The main camera controller registers a handler via setGizmoOrientCallback.
 * The callback receives a view direction vector (camera looks FROM this direction).
 */
let gizmoOrientCallback: ((dir: Vector3) => void) | null = null;
export function setGizmoOrientCallback(cb: ((dir: Vector3) => void) | null) {
    gizmoOrientCallback = cb;
}

/**
 * Place inside the MAIN Canvas to publish its camera orientation
 * into the module-scoped sharedQuaternion each frame.
 */
export function AxesCameraPublisher() {
    useFrame(({ camera }) => {
        sharedQuaternion.current.copy(camera.quaternion);
    });
    return null;
}

/**
 * Internal component placed in the gizmo Canvas.
 * Reads sharedQuaternion and applies it to the local camera.
 *
 * When the main camera is stationary and GizmoHelper animates the
 * gizmo camera (axis click), CameraSubscriber yields so it does not
 * overwrite the animation. Once the gizmo animation settles (8+ frames
 * of stability while diverged from the main camera), the final
 * orientation is forwarded to the main camera via gizmoOrientCallback.
 */
function CameraSubscriber() {
    const lastMainQuat = useRef(new Quaternion());
    const lastGizmoQuat = useRef(new Quaternion());
    const settledFrames = useRef(0);

    useFrame(({ camera }) => {
        // Has the main camera changed since last frame?
        const mainChanged = lastMainQuat.current.dot(sharedQuaternion.current) < 0.9999;

        if (mainChanged) {
            // Main camera moved -- sync gizmo to match
            lastMainQuat.current.copy(sharedQuaternion.current);
            camera.quaternion.copy(sharedQuaternion.current);
            const dir = new Vector3(0, 0, 1).applyQuaternion(sharedQuaternion.current);
            camera.position.copy(dir.multiplyScalar(5));
            camera.updateMatrixWorld();
            lastGizmoQuat.current.copy(camera.quaternion);
            settledFrames.current = 0;
            return;
        }

        // Main camera is stationary -- check if GizmoHelper is animating
        const gizmoMoving = lastGizmoQuat.current.dot(camera.quaternion) < 0.9999;
        lastGizmoQuat.current.copy(camera.quaternion);

        if (gizmoMoving) {
            // GizmoHelper is still animating -- yield, let it finish
            settledFrames.current = 0;
        } else {
            // Gizmo has stopped changing -- check if it diverges from main camera
            const diverged = camera.quaternion.dot(sharedQuaternion.current) < 0.999;
            if (diverged) {
                settledFrames.current++;
                if (settledFrames.current > 8) {
                    // GizmoHelper animation complete -- forward final direction to main camera
                    const dir = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
                    if (gizmoOrientCallback) gizmoOrientCallback(dir);
                    settledFrames.current = 0;
                }
            }
        }
    });
    return null;
}

/**
 * AxesWidget -- fixed-position 3D orientation gizmo in the bottom-right corner.
 *
 * Rendered in its own small Canvas so it never clips when the browser
 * is resized. Camera orientation is synced from the main Canvas via
 * the module-scoped sharedQuaternion.
 *
 * Clicking an axis label triggers GizmoHelper's built-in animation,
 * which CameraSubscriber detects and forwards to the main camera.
 */
export const AxesWidget: React.FC = () => {
    const isMobile = useIsMobile();
    if (isMobile) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: 16,
            right: 60,
            width: 100,
            height: 100,
            zIndex: 10,
            pointerEvents: 'none',
        }}>
            <Canvas
                camera={{ position: [0, 0, 5], fov: 50 }}
                style={{ pointerEvents: 'auto' }}
                gl={{ alpha: true, antialias: true }}
            >
                <CameraSubscriber />
                <ambientLight intensity={0.8} />
                <GizmoHelper alignment="center-center" margin={[50, 50]}>
                    <GizmoViewport
                        axisColors={['red', '#34D399', 'blue']}
                        labelColor="white"
                        hideNegativeAxes={false}
                    />
                </GizmoHelper>
            </Canvas>
        </div>
    );
};
