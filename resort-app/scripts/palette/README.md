# Palette generation

`src/index.css` is generated, not hand-written. The source of truth is the seed
set in `emit-tokens.ts`:

| Seed | Value |
| --- | --- |
| accent | `#A66407` |
| gray | `#0A0D1E` light / `#E5E5E6` dark |
| background | `#FFFFFF` light / `#111111` dark |

`generate-radix-colors.tsx` is vendored unchanged from `radix-ui/website`
(`components/generate-radix-colors.tsx`) — the same code behind
<https://www.radix-ui.com/colors/custom>, so the twelve steps carry Radix's
contrast guarantees rather than being eyeballed.

Regenerate rather than editing `index.css` by hand:

```bash
cd scripts/palette && npm i colorjs.io bezier-easing @radix-ui/colors tsx && npx tsx emit-tokens.ts
```

Output is HSL triples, not hex, because Tailwind needs `hsl(var(--x))` to inject
alpha for the `/25`-style opacity modifiers used across the app.

Semantic colours run through the same generator on the same grays but are pulled
to distinct hues. `warning` is deliberately held at hue 47 against primary's 35:
the Carbon retokenising pass mapped ~87 former Carbon yellows onto it, so a
warning that reads as primary would flatten a lot of screens.
