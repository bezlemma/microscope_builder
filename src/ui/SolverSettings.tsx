import React from 'react';
import { useAtom } from 'jotai';
import { rayConfigAtom } from '../state/store';

export const SolverSettings: React.FC = () => {
    const [rayConfig, setRayConfig] = useAtom(rayConfigAtom);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRayConfig({ ...rayConfig, rayCount: parseInt(e.target.value) });
    };

    return (
        <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '320px', // Right of Sidebar
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
            
            {/* Solver 1: Geometric Ray Tracing */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4f4' }}></div>
                <span>Solver 1 (Geometric)</span>
            </div>
            <div style={{ paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                    type="range" 
                    min="4" 
                    max="128" 
                    step="1"
                    value={Math.max(4, rayConfig.rayCount)} 
                    onChange={handleChange}
                    style={{ width: '80px' }}
                />
                <span style={{ minWidth: '20px' }}>{Math.max(4, rayConfig.rayCount)} Rays</span>
            </div>

            {/* Solver 2: Gaussian (Placeholder) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.5 }}>
                <input type="checkbox" disabled />
                <span>Solver 2 (Gaussian - WIP)</span>
            </div>

            {/* Solver 3: Wave (Placeholder) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.5 }}>
                <input type="checkbox" disabled />
                <span>Solver 3 (Wave - WIP)</span>
            </div>
        </div>
    );
};
