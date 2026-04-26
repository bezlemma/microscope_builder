import React from 'react';
import { useAtom } from 'jotai';
import { undoAtom, undoStackAtom, mobileSnapEnabledAtom, selectionAtom, componentsAtom, pushUndoAtom, mobileCameraModeAtom } from '../state/store';
import { Undo2, Magnet, Trash2, RotateCcw, Move3d, Move } from 'lucide-react';
import { useIsMobile } from './useIsMobile';
import { useHaptic } from './useHaptic';
import { TrappedBead } from '../physics/components/TrappedBead';

export const MobileActionBar: React.FC = () => {
    const isMobile = useIsMobile();
    const haptic = useHaptic();
    const [undoStack] = useAtom(undoStackAtom);
    const [, triggerUndo] = useAtom(undoAtom);
    const [mobileSnap, setMobileSnap] = useAtom(mobileSnapEnabledAtom);
    const [selection, setSelection] = useAtom(selectionAtom);
    const [components, setComponents] = useAtom(componentsAtom);
    const [, pushUndo] = useAtom(pushUndoAtom);
    const [cameraMode, setCameraMode] = useAtom(mobileCameraModeAtom);

    const hasUndo = undoStack.length > 0;
    const hasSelection = selection.length > 0;

    const handleDelete = () => {
        if (!hasSelection) return;
        pushUndo();
        // Delete all selected items
        const idsToRemove = new Set(selection);
        for (const component of components) {
            if (component instanceof TrappedBead && component.parentSampleId && idsToRemove.has(component.parentSampleId)) {
                idsToRemove.add(component.id);
            }
        }
        const newComponents = components.filter(c => !idsToRemove.has(c.id));
        setComponents(newComponents);
        setSelection([]);
    };

    const handleRotate = () => {
        if (!hasSelection) return;
        pushUndo();
        const newComponents = components.map(c => {
            if (selection.includes(c.id)) {
                // Rotate 90 degrees in the XY plane by incrementing the pan angle
                c.panAngle += Math.PI / 2;
                // Keep pan angle in [-pi, pi] range just for cleanliness
                if (c.panAngle > Math.PI) c.panAngle -= 2 * Math.PI;
                c.recomputeRotation();
                c.version++;
                return c;
            }
            return c;
        });
        setComponents([...newComponents]);
    };

    if (!isMobile) return null;

    return (
        <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            padding: '6px',
            backgroundColor: 'rgba(20, 20, 20, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderRadius: '12px',
            border: '1px solid #333',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 10,
            pointerEvents: 'auto',
        }}>
            <button
                onClick={() => {
                    haptic.tap();
                    triggerUndo();
                }}
                disabled={!hasUndo}
                className="cyber-btn primary"
                title="Undo"
                style={{
                    background: 'none',
                    border: 'none',
                    color: hasUndo ? '#fff' : '#444',
                    cursor: hasUndo ? 'pointer' : 'default',
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    transition: 'background 0.2s',
                }}
            >
                <Undo2 size={20} />
            </button>

            <button
                onClick={() => {
                    haptic.confirm();
                    setMobileSnap(!mobileSnap);
                }}
                className="cyber-btn primary"
                title={mobileSnap ? "Disable Snap-to-Grid" : "Enable Snap-to-Grid"}
                style={{
                    background: mobileSnap ? 'rgba(50, 150, 255, 0.2)' : 'none',
                    border: 'none',
                    color: mobileSnap ? '#66b2ff' : '#fff',
                    cursor: 'pointer',
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    transition: 'all 0.2s',
                }}
            >
                <Magnet size={20} />
            </button>

            {/* Pan / Rotate toggle — labeled inline so the mode is obvious
             *  without having to remember which icon means what.  Tap to flip
             *  to the other mode; the active mode is highlighted. */}
            <button
                onClick={() => {
                    haptic.confirm();
                    setCameraMode(cameraMode === 'pan' ? 'rotate' : 'pan');
                }}
                className="cyber-btn primary"
                title={cameraMode === 'pan' ? "Currently 2D pan — tap to rotate in 3D" : "Currently 3D rotate — tap to pan in 2D"}
                style={{
                    background: cameraMode === 'rotate' ? 'rgba(255, 150, 50, 0.25)' : 'rgba(80, 80, 80, 0.4)',
                    border: cameraMode === 'rotate' ? '1px solid #ffb266' : '1px solid #555',
                    color: cameraMode === 'rotate' ? '#ffb266' : '#ddd',
                    cursor: 'pointer',
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '8px',
                    transition: 'all 0.2s',
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.3px',
                }}
            >
                {cameraMode === 'pan' ? <Move size={18} /> : <Move3d size={18} />}
                <span>{cameraMode === 'pan' ? '2D' : '3D'}</span>
            </button>

            {/* Contextual actions when something is selected */}
            {hasSelection && (
                <>
                    <div style={{ width: '1px', backgroundColor: '#444', margin: '4px 0' }} />
                    <button
                        onClick={() => {
                            haptic.tap();
                            handleRotate();
                        }}
                        className="cyber-btn primary"
                        title="Rotate 90 degrees"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '8px',
                        }}
                    >
                        <RotateCcw size={20} />
                    </button>
                    <button
                        onClick={() => {
                            haptic.delete();
                            handleDelete();
                        }}
                        className="cyber-btn danger"
                        title="Delete Selected"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '8px',
                        }}
                    >
                        <Trash2 size={20} />
                    </button>
                </>
            )}
        </div>
    );
};
