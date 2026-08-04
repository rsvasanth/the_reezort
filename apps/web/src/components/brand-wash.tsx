/**
 * The ambient canvas behind the app shell.
 *
 * The geometry and gradient transforms are the real ones, read off the live
 * radix-ui.com hero rather than approximated. Two earlier attempts are worth
 * recording so nobody redoes them: layered CSS gradients reached about a fifth
 * of the effect (linear gradients are unavoidably straight and parallel, and
 * across a 2560px box a 155deg axis pushes its stops off the visible crop), and
 * reconstructing the missing paths by translating the one published path was
 * closer but still flat.
 *
 * Why it reads as painted rather than generated:
 *
 * 1. THE SHAPES ARE ENORMOUS. Coordinates run from x=-4156 to x=+8316 in a
 *    2560-wide viewBox — five times the frame. You never see a whole form with
 *    edges, only a portion of a very large curve passing through, which the eye
 *    reads as atmosphere. It is the difference between a crop of a photograph of
 *    clouds and a small drawing of a cloud.
 *
 * 2. RADIAL GRADIENTS ACTING AS SWEEPS. Every fill is a radialGradient with
 *    r="1" scaled by ~6400 — a radius roughly 2.5x the whole canvas, centred far
 *    off-frame. At that size the visible arc of each band is so shallow it
 *    renders as a soft directional sweep: the slightly-curved falloff of a
 *    radial with the direction of a linear. `rotate()` sets each band's angle.
 *
 * 3. THE STOPS RETURN TO THE BASE REPEATEDLY — 0%, 65.8%, 94.3%, 100%. Colour
 *    bands are islands separated by exact background, which is what lets eight
 *    layers stack without turning to mud. The spacing is deliberately uneven: a
 *    tight blue-to-violet transition, a wide fade to nothing, then a narrow
 *    purple spike. Irregular rhythm reads as natural.
 *
 * 4. ERASER LAYERS. Three shapes are filled with pure base colour, opaque until
 *    ~79-82% then falling to alpha 0. Painted over the bands they knock the
 *    composition back with a soft edge and keep it off the frame edges — the
 *    difference between atmosphere and a big purple shape.
 *
 * 5. ONE OPACITY ON THE WHOLE COMPOSITION, not per layer, so it composites
 *    against the page in a single operation and foreground contrast is safe by
 *    construction rather than by checking each layer.
 *
 * Container rules, all load-bearing: `width: max(2560px, 100vw)`, centred and
 * top-anchored inside an `overflow: hidden` parent. A narrow viewport gets a
 * centre crop of the full-size artwork, not a squashed copy, so the diagonals
 * keep their exact angle at every width. CROP, NEVER SCALE — making this
 * responsive would destroy the composition, and the top anchor is what keeps the
 * highlight in frame.
 *
 * Colours are `--art-*` tokens mapped onto the seven pigment roles the gradients
 * expect. Artwork only: no control, badge or text may use them.
 */

const BASE = "hsl(var(--background))";

/** The seven pigment roles the bands reuse at shared stop offsets. */
const A1 = "var(--art-glow)";
const A2 = "var(--art-violet)";
const A3 = "var(--art-purple)";
const A4 = "var(--art-deep)";
const A5 = "var(--art-indigo)";
const A6 = "var(--art-pink)";

/** Every band shares this rhythm; only the pigment and offset change. */
function Band({ id, transform, c1, c2, o1 = "0.0833333", o2 = "0.364583", fade }: {
	id: string; transform: string; c1: string; c2: string; o1?: string; o2?: string; fade?: boolean;
}) {
	return (
		<radialGradient id={id} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={transform}>
			<stop stopColor={BASE} />
			<stop offset={o1} stopColor={c1} stopOpacity={fade ? "0" : undefined} />
			<stop offset={o2} stopColor={c2} />
			<stop offset="0.658041" stopColor={BASE} />
			<stop offset="0.798521" stopColor={A3} />
			<stop offset="0.942708" stopColor={BASE} />
			<stop offset="1" stopColor={BASE} />
		</radialGradient>
	);
}

/** Knocks the composition back to base with a soft edge. */
function Eraser({ id, transform, hold }: { id: string; transform: string; hold: string }) {
	return (
		<radialGradient id={id} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={transform}>
			<stop stopColor={BASE} />
			<stop offset={hold} stopColor={BASE} />
			<stop offset="1" stopColor={BASE} stopOpacity="0" />
		</radialGradient>
	);
}

export function BrandWash() {
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed inset-0 -z-10 flex justify-center overflow-hidden"
			style={{ alignItems: "flex-start", backgroundColor: BASE }}
		>
			<svg
				viewBox="0 0 2560 1920"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				style={{ width: "max(2560px, 100vw)", height: "auto", opacity: "var(--art-opacity)" }}
			>
				<defs>
					<Band id="rz0" transform="translate(-804.109 -2036.8) rotate(64.9401) scale(6436.87 6304.81)" c1={A1} c2={A2} />
					<Band id="rz1" transform="translate(201.6 -1080.02) rotate(64.9401) scale(6436.87 6304.81)" c1={A4} c2={A5} o2="0.333803" />
					<Band id="rz2" transform="translate(912.834 -811.021) rotate(64.9401) scale(6436.87 6304.81)" c1={A6} c2={A5} o1="0.140625" o2="0.333803" fade />
					<Band id="rz3" transform="translate(1711.41 -1639.11) rotate(64.9401) scale(6436.87 6304.81)" c1={A1} c2={A5} o2="0.333803" />
					<Band id="rz4" transform="translate(3479.06 -623.459) rotate(113.028) scale(8332.26 4870.62)" c1={A1} c2={A5} o2="0.333803" />
					<Eraser id="rzE0" transform="translate(2922 2538.48) rotate(-117.986) scale(1898.15 3571.73)" hold="0.822917" />
					<Eraser id="rzE1" transform="translate(3069.05 2293.39) rotate(-117.986) scale(1898.15 3571.73)" hold="0.822917" />
					<Eraser id="rzE2" transform="translate(3934.59 656.035) rotate(148.98) scale(1938.73 3648.08)" hold="0.789375" />
					{/* The light source. Flat plateau to 32.8%, then falloff to nothing. */}
					<radialGradient
						id="rzGlow"
						cx="0"
						cy="0"
						r="1"
						gradientUnits="userSpaceOnUse"
						gradientTransform="translate(2994.87 275.232) rotate(118.839) scale(1779.46 2065.6)"
					>
						<stop offset="0.328125" stopColor={A1} stopOpacity="1" />
						<stop offset="1" stopColor="white" stopOpacity="0" />
					</radialGradient>
				</defs>

				<path
					d="M3020.93 134.455C3124.79 173.824 3164.97 266.778 3110.66 342.074C2627.55 1011.9 1866.31 2517.63 1361.75 2752.01C-681.389 3429.21 -4156.79 2571.47 -2138.3 1425.38C-119.809 279.282 -1553.39 -218.348 -406.211 -990.94C930.008 -1890.85 2560.5 -40.0647 3020.93 134.455Z"
					fill="url(#rz0)"
				/>
				<path
					d="M885.9 -99.2149L1864.74 271.797C1921.14 293.178 1961.34 331.784 1974.23 376.971L2135.2 941.153L2866.18 715.05C2924.72 696.941 2991.39 698.838 3047.8 720.218L4026.64 1091.23C4130.5 1130.6 4170.68 1223.55 4116.37 1298.85L3855.77 1660.16C3833.07 1691.63 3796.05 1716.44 3750.99 1730.38L2473.16 2125.63L2754.29 3110.94C2764.38 3146.29 2756.99 3183.09 2733.43 3214.9L2367.46 3708.79L1208.97 3269.68C1152.56 3248.3 1112.37 3209.7 1099.48 3164.51C816.824 2173.87 718.627 2080.16 290.681 580.294C250.811 440.558 316.198 358.62 338.898 327.148L599.499 -34.1638C653.807 -109.46 782.033 -138.584 885.9 -99.2149Z"
					fill="url(#rz1)"
				/>
				<path
					d="M1597.13 169.785L2575.97 540.797C2632.38 562.177 2672.57 600.783 2685.46 645.97L2846.44 1210.15L3577.41 984.05C3635.96 965.94 3702.63 967.838 3759.03 989.218L4737.87 1360.23C4841.74 1399.6 4881.91 1492.55 4827.6 1567.85L4567 1929.16C4544.3 1960.63 4507.28 1985.44 4462.22 1999.38L3184.4 2394.63L3465.53 3379.94C3475.61 3415.29 3468.23 3452.09 3444.66 3483.9L3078.69 3977.79L1920.2 3538.68C1863.79 3517.3 1823.6 3478.7 1810.71 3433.51L1649.74 2869.33L918.759 3095.43C860.213 3113.54 793.545 3111.64 737.138 3090.26C737.138 3090.26 -278.857 2706.76 -70.6873 2151.46C137.482 1596.17 725.315 1866.25 1311.78 1684.85L1030.38 698.594C1020.45 663.816 1027.43 627.62 1050.13 596.148L1310.73 234.836C1365.04 159.54 1493.27 130.416 1597.13 169.785Z"
					fill="url(#rz2)"
				/>
				<path d="M646.599 3987.93L-98.3711 1153.81L4970.66 -538.566L8169.17 3987.93H646.599Z" fill="url(#rzE0)" />
				<path d="M793.654 3742.84L48.6836 908.72L5117.71 -783.656L8316.22 3742.84H793.654Z" fill="url(#rzE1)" />
				<ellipse cx="2396.98" cy="275.232" rx="1699.15" ry="1558.77" fill="url(#rzGlow)" />
				<path
					d="M6290.25 3071.54L3745.51 4524.66L283.022 -523.642L4343.26 -4194.7L6290.25 3071.54Z"
					fill="url(#rzE2)"
					opacity="0.5"
				/>
				<path
					d="M3059.26 767.931C3338.11 1712.5 3585.77 2551.43 3864.61 3496C3891.25 3586.22 3837.42 3706.98 3744.38 3765.74C2803.8 4359.68 -787.932 5319.23 63.3068 2765.51C176.75 2425.18 313.694 2187.12 594.28 2175.25C874.865 2163.39 1279.76 2345.45 1646.71 2313.32C2175.9 2266.99 2044.14 1215.13 2396.11 992.875L2842.57 710.952C2935.61 652.201 3032.62 677.711 3059.26 767.931Z"
					fill="url(#rz4)"
				/>
			</svg>
		</div>
	);
}
