import animate from "tailwindcss-animate";

/** @type {import("tailwindcss").Config} */
export default {
	darkMode: ["class"],
	content: ["./index.html", "./src/**/*.{html,jsx,tsx,vue,js,ts}"],
	theme: {
		extend: {
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				brass: {
					DEFAULT: "hsl(var(--brass))",
					foreground: "hsl(var(--brass-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				sidebar: {
					DEFAULT: "hsl(var(--sidebar-background))",
					foreground: "hsl(var(--sidebar-foreground))",
					primary: "hsl(var(--sidebar-primary))",
					"primary-foreground": "hsl(var(--sidebar-primary-foreground))",
					accent: "hsl(var(--sidebar-accent))",
					"accent-foreground": "hsl(var(--sidebar-accent-foreground))",
					border: "hsl(var(--sidebar-border))",
					ring: "hsl(var(--sidebar-ring))",
				},
			},
			borderRadius: {
				"3xl": "var(--radius)",
				"2xl": "var(--radius)",
				xl: "var(--radius)",
				lg: "var(--radius)",
				md: "var(--radius)",
				sm: "var(--radius)",
			},
			fontFamily: {
				sans: [
					'"IBM Plex Sans"',
					"ui-sans-serif",
					"system-ui",
					"-apple-system",
					"BlinkMacSystemFont",
					'"Segoe UI"',
					"sans-serif",
				],
				mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
			},
		},
	},
	plugins: [animate],
};
