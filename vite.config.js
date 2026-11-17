import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/where-did-my-momo-go/)
// and on any other static host or sub-path.
export default defineConfig({ base: './' });
