import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import proxyOptions from './proxyOptions';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		port: 8080,
		host: '0.0.0.0',
		proxy: proxyOptions
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			// Every call site imports `toast` straight from "sonner" (54 files).
			// Aliasing the package keeps that call shape intact while rendering
			// through Carbon's ToastNotification instead. See src/lib/sonner-shim.tsx.
			'sonner': path.resolve(__dirname, 'src/lib/sonner-shim.tsx')
		}
	},
	css: {
		preprocessorOptions: {
			scss: {
				loadPaths: ['node_modules'],
				silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
			}
		}
	},
	build: {
		outDir: '../the_reezort/public/resort-app',
		emptyOutDir: true,
		target: 'es2015',
	},
});
