/**
 * Ambient accent wash behind the top of the app shell.
 *
 * The same treatment radix-ui.com uses on its own pages: a tall, low-opacity
 * gradient from accent step 4 to transparent, sitting behind content rather
 * than on it. It gives the shell a warm horizon without tinting any surface a
 * component actually renders.
 *
 * Both values come from `--brand-wash`, generated from the accent scale, so the
 * wash follows the brand rather than being a picked colour that drifts.
 * `pointer-events-none` and a negative z-index keep it strictly decorative.
 */
export function BrandWash() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] opacity-60"
			style={{
				background:
					"linear-gradient(to bottom, hsl(var(--brand-wash)), transparent)",
			}}
		/>
	);
}
