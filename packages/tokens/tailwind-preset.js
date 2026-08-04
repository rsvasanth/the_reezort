/**
 * Tailwind preset shared by both mobile apps.
 *
 * Mirrors the colour block in `resort-app/tailwind.config.js` exactly, so the
 * class vocabulary is identical across platforms (Rule 4). `--sidebar-*` is
 * omitted — web-shell only. See the header of `global.css` for why these tokens
 * temporarily live in two places.
 *
 * Radius is expressed as literal rem values rather than `var(--radius-*)`.
 * NativeWind resolves `var()` reliably for colours but length variables are
 * fragile across the RN style pipeline, and the scale never changes at runtime —
 * only the theme does. The steps match the web's values exactly.
 */
module.exports = {
	darkMode: "class",
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
				success: {
					DEFAULT: "hsl(var(--success))",
					foreground: "hsl(var(--success-foreground))",
				},
				warning: {
					DEFAULT: "hsl(var(--warning))",
					foreground: "hsl(var(--warning-foreground))",
				},
				info: {
					DEFAULT: "hsl(var(--info))",
					foreground: "hsl(var(--info-foreground))",
				},
				danger: {
					DEFAULT: "hsl(var(--danger))",
					foreground: "hsl(var(--danger-foreground))",
				},
				chart: {
					1: "hsl(var(--chart-1))",
					2: "hsl(var(--chart-2))",
					3: "hsl(var(--chart-3))",
					4: "hsl(var(--chart-4))",
					5: "hsl(var(--chart-5))",
				},
			},
			borderRadius: {
				sm: "0.25rem",
				md: "0.5rem",
				lg: "0.625rem",
				xl: "0.875rem",
				"2xl": "1rem",
				"3xl": "1.5rem",
			},
		},
	},
};
