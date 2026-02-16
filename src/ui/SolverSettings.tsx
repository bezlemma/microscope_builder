import React from 'react';
import { useAtom } from 'jotai';
import { rayConfigAtom, solver3RenderTriggerAtom, solver3RenderingAtom } from '../state/store';

export const SolverSettings: React.FC = () => {
    const [rayConfig, setRayConfig] = useAtom(rayConfigAtom);
    const [, setSolver3Trigger] = useAtom(solver3RenderTriggerAtom);
    const [isRendering] = useAtom(solver3RenderingAtom);

    const handleRayCount = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRayConfig({ ...rayConfig, rayCount: parseInt(e.target.value) });
    };

    const handleSolver2Toggle = () => {
        setRayConfig({ ...rayConfig, solver2Enabled: !rayConfig.solver2Enabled });
    };

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '320px',
            backgroundColor: '#222',
            color: 'white',
            padding: '10px 15px',
            borderRadius: '8px',
            border: '1px solid #444',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontFamily: 'sans-serif',
            fontSize: '12px',
            zIndex: 10
        }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Physics Solvers</div>
            
            {/* Ray Tracer (always on) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4f4' }}></div>
                <span>Ray Tracer</span>
            </div>
            <div style={{ paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                    type="range" 
                    min="4" 
                    max="128" 
                    step="1"
                    value={Math.max(4, rayConfig.rayCount)} 
                    onChange={handleRayCount}
                    style={{ width: '80px' }}
                />
                <span style={{ minWidth: '20px' }}>{Math.max(4, rayConfig.rayCount)} Rays</span>
            </div>

            {/* E&M (toggleable) */}
            <div 
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={handleSolver2Toggle}
            >
                <div style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: rayConfig.solver2Enabled ? '#4af' : '#555',
                    transition: 'background-color 0.2s'
                }}></div>
                <input 
                    type="checkbox" 
                    checked={rayConfig.solver2Enabled} 
                    onChange={handleSolver2Toggle}
                    style={{ cursor: 'pointer' }}
                />
                <span style={{ opacity: rayConfig.solver2Enabled ? 1 : 0.5 }}>E&M</span>
            </div>

            {/* Solver 3: Incoherent Imaging — Render button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: isRendering ? '#fa4' : '#555',
                    transition: 'background-color 0.2s'
                }}></div>
                <button
                    onClick={() => setSolver3Trigger((prev: number) => prev + 1)}
                    disabled={isRendering}
                    style={{
                        padding: '3px 10px',
                        background: isRendering ? '#333' : '#1a5a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: isRendering ? '#888' : '#8f8',
                        cursor: isRendering ? 'not-allowed' : 'pointer',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        transition: 'background 0.2s',
                    }}
                >
                    {isRendering ? '⏳ Rendering...' : '▶ Render'}
                </button>
                <span style={{ opacity: isRendering ? 0.5 : 0.7, fontSize: '11px' }}>Imaging</span>
            </div>
        </div>
    );
};
