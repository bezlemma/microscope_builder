import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const browserGlobals = {
    Blob: 'readonly',
    CanvasRenderingContext2D: 'readonly',
    DOMRect: 'readonly',
    HTMLCanvasElement: 'readonly',
    HTMLElement: 'readonly',
    ImageData: 'readonly',
    MutationObserver: 'readonly',
    OffscreenCanvas: 'readonly',
    SharedArrayBuffer: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    Worker: 'readonly',
    addEventListener: 'readonly',
    cancelAnimationFrame: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    crossOriginIsolated: 'readonly',
    document: 'readonly',
    globalThis: 'readonly',
    navigator: 'readonly',
    performance: 'readonly',
    queueMicrotask: 'readonly',
    requestAnimationFrame: 'readonly',
    self: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    window: 'readonly',
};

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'native/**/target/**',
            'coverage/**',
            '*.config.d.ts',
            '*.config.js',
            '*.tsbuildinfo',
        ],
    },
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: browserGlobals,
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'off',
        },
    },
];
