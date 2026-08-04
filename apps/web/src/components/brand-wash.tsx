/**
 * The ambient canvas behind the app shell.
 *
 * A CSS approximation of the layered gradient artwork radix-ui.com uses on its
 * hero. Four layers compose it: an off-frame highlight glow in the upper right,
 * a purple band, a violet band, and a deep blue undertone. Every layer returns
 * to `transparent` repeatedly rather than blending edge to edge — that is what
 * lets them stack without turning to mud, and it is the single most important
 * property of the recipe.
 *
 * Three rules are load-bearing and easy to break by "fixing" them:
 *
 * 1. CROP, NEVER SCALE. `background-size: max(2560px, 100vw) auto` means the
 *    composition never shrinks below its design width — a narrow viewport gets a
 *    centre crop of the full-size artwork, not a squashed copy. That is why the
 *    diagonals keep their angle at every width. Making this responsive would
 *    destroy the composition.
 *
 * 2. TOP-ANCHORED. `background-position: top center` keeps the bright glow in
 *    frame while the bottom bleeds away.
 *
 * 3. KNOCKED BACK AS A WHOLE. A single `opacity` on the container, not per
 *    layer, so the entire composition composites against the page background in
 *    one operation. Foreground contrast is then safe by construction rather than
 *    by checking each layer.
 *
 * Fixed rather than absolute so the atmosphere stays put while dense screens
 * scroll. Colours come from `--art-*`, which are artwork-only tokens: no
 * control, badge or text may use them.
 */
export function BrandWash() {
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed inset-0 -z-10"
			style={{ opacity: "var(--art-opacity)" }}
		>
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: [
						// Upper-right highlight — the light source everything else reacts to.
						"radial-gradient(1699px 1559px at 94% -8%, color-mix(in oklab, var(--art-glow) 55%, transparent) 0%, color-mix(in oklab, var(--art-glow) 30%, transparent) 33%, transparent 72%)",
						// Purple band, arriving late in the sweep.
						"linear-gradient(155deg, transparent 0%, transparent 58%, color-mix(in oklab, var(--art-purple) 85%, transparent) 80%, transparent 95%)",
						// Violet band, the main aurora.
						"linear-gradient(155deg, color-mix(in oklab, var(--art-glow) 55%, transparent) 8%, var(--art-violet) 37%, transparent 66%)",
						// Deep undertone, offset so the rhythm staggers.
						"linear-gradient(148deg, transparent 0%, color-mix(in oklab, var(--art-deep) 70%, transparent) 22%, transparent 50%)",
					].join(", "),
					backgroundRepeat: "no-repeat",
					backgroundSize: "max(2560px, 100vw) auto",
					backgroundPosition: "top center",
				}}
			/>
		</div>
	);
}
