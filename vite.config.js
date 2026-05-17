import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig(function (_a) {
    var command = _a.command;
    return ({
        base: '/microscope/',
        plugins: command === 'build' ? [react()] : [],
        define: {
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        esbuild: {
            jsx: 'automatic',
            jsxImportSource: 'react',
            jsxDev: false,
        },
        server: {
            hmr: false,
        },
        optimizeDeps: {
            esbuildOptions: {
                define: {
                    'process.env.NODE_ENV': JSON.stringify('production'),
                },
            },
        },
    });
});
