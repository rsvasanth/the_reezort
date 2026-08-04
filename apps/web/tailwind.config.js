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
				"brand-wash": "hsl(var(--brand-wash))",
				"brand-wash-soft": "hsl(var(--brand-wash-soft))",
				"cat-1": "hsl(var(--cat-1))",
				"cat-2": "hsl(var(--cat-2))",
				"cat-3": "hsl(var(--cat-3))",
				"cat-4": "hsl(var(--cat-4))",
				"cat-5": "hsl(var(--cat-5))",
				"cat-6": "hsl(var(--cat-6))",
				"cat-7": "hsl(var(--cat-7))",
				"cat-8": "hsl(var(--cat-8))",
				chart: {
					1: "hsl(var(--chart-1))",
					2: "hsl(var(--chart-2))",
					3: "hsl(var(--chart-3))",
					4: "hsl(var(--chart-4))",
					5: "hsl(var(--chart-5))",
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
			/*
			 * Type scale: each size ships with its line-height and a progressively
			 * tighter tracking. Larger type gets more negative letter-spacing, which
			 * is what makes a headline read as set rather than defaulted.
			 */
			fontSize: {
				xs: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.005em" }],
				sm: ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "0em" }],
				base: ["1rem", { lineHeight: "1.5rem", letterSpacing: "0em" }],
				lg: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.005em" }],
				xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
				"2xl": ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.0125em" }],
				"3xl": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.015em" }],
				"4xl": ["2.1875rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
				"5xl": ["3.75rem", { lineHeight: "3.75rem", letterSpacing: "-0.05em" }],
			},
			/*
			 * Elevation. Each token already contains its own hairline border, so
			 * never pair a shadow with a separate border — surfaces end up
			 * double-outlined.
			 */
			boxShadow: {
				panel: "var(--shadow-card)",
				1: "var(--shadow-1)",
				2: "var(--shadow-2)",
				3: "var(--shadow-3)",
				4: "var(--shadow-4)",
				5: "var(--shadow-5)",
				6: "var(--shadow-6)",
			},
			transitionDuration: {
				fast: "var(--duration-fast)",
				slide: "var(--duration-slide)",
				curtain: "var(--duration-curtain)",
			},
			transitionTimingFunction: { out: "var(--ease-out)" },
			borderRadius: {
				"3xl": "var(--radius-3xl)",
				"2xl": "var(--radius-2xl)",
				xl: "var(--radius-xl)",
				lg: "var(--radius-lg)",
				md: "var(--radius-md)",
				sm: "var(--radius-sm)",
				full: "var(--radius-thumb)",
			},
			fontFamily: {
				sans: [
					'"Inter"',
					"ui-sans-serif",
					"system-ui",
					"-apple-system",
					"BlinkMacSystemFont",
					'"Segoe UI"',
					"sans-serif",
				],
				serif: ["ui-serif", "Georgia", "serif"],
				mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
			},
		},
	},
	plugins: [animate],
};
