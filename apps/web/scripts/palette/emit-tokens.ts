import { generateRadixColors } from "./gen.tsx";
import * as RadixColors from "@radix-ui/colors";

const hexToHsl = (hex: string) => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let H = 0; const L = (max+min)/2;
  const S = d === 0 ? 0 : d / (1 - Math.abs(2*L - 1));
  if (d !== 0) {
    if (max === r) H = 60*(((g-b)/d)%6);
    else if (max === g) H = 60*(((b-r)/d)+2);
    else H = 60*(((r-g)/d)+4);
  }
  if (H < 0) H += 360;
  return `${Math.round(H)} ${Math.round(S*100)}% ${Math.round(L*100)}%`;
};

/** WCAG relative luminance, used to pick a readable foreground per step. */
const lum = (hex: string) => {
  let h = hex.replace("#","");
  if (h.length === 3) h = h.split("").map(c=>c+c).join("");
  const ch = [0,2,4].map(i => {
    const c = parseInt(h.substr(i,2),16)/255;
    return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  });
  return 0.2126*ch[0] + 0.7152*ch[1] + 0.0722*ch[2];
};
/**
 * Foreground for a solid step, chosen by contrast rather than assumed white.
 * Stock amber-9 is #ffc53d — white on it is 1.58:1, which is why this is
 * computed. Returns the darkest/lightest of the scale's own ends so the pair
 * stays inside the palette.
 */
const fgFor = (bg: string, scale: string[]) => {
  const L = lum(bg);
  const white = 1.05 / (L + 0.05);
  const dark = scale[11], light = scale[0];
  const cDark = (L + 0.05) / (lum(dark) + 0.05);
  return white >= 4.5 && white > cDark ? "0 0% 100%" : hexToHsl(cDark >= 4.5 ? dark : light);
};

const GRAY = { light: "#0A0D1E", dark: "#E5E5E6" };
const BG   = { light: "#FFFFFF", dark: "#111111" };

// Accent is Radix's stock amber (owner decision). Semantic seeds still run
// through the generator on the same grays. `warning` is pushed to orange:
// amber IS the accent now, so an amber warning would be indistinguishable.
const SEEDS = { success: "#2F7D4F", warning: "#D2691E", danger: "#C0392B", info: "#3E6FB0" };

for (const mode of ["light","dark"] as const) {
  const accent = Object.values(mode === "light" ? RadixColors.amber : RadixColors.amberDark) as string[];
  const out: Record<string,string[]> = { accent };
  for (const [name, seed] of Object.entries(SEEDS)) {
    const r = generateRadixColors({ appearance: mode, accent: seed, gray: GRAY[mode], background: BG[mode] });
    out[name] = r.accentScale;
    if (!out.gray) out.gray = r.grayScale;
  }
  const s = (n: string, i: number) => hexToHsl(out[n][i-1]);
  const semFg = (n: string, i: number) => fgFor(out[n][i-1], out[n]);
  const L = mode === "light";
  console.log(`\n/* ===== ${mode} ===== */`);
  console.log(`--background: ${L ? s("gray",2) : s("gray",1)};`);
  console.log(`--foreground: ${s("gray",12)};`);
  console.log(`--card: ${L ? s("gray",1) : s("gray",2)};`);
  console.log(`--card-foreground: ${s("gray",12)};`);
  console.log(`--popover: ${L ? s("gray",1) : s("gray",2)};`);
  console.log(`--popover-foreground: ${s("gray",12)};`);
  console.log(`--primary: ${s("accent",9)};`);
  console.log(`--primary-foreground: ${semFg("accent",9)};`);
  console.log(`--secondary: ${s("gray",3)};`);
  console.log(`--secondary-foreground: ${s("gray",12)};`);
  console.log(`--muted: ${s("gray",3)};`);
  console.log(`--muted-foreground: ${s("gray",11)};`);
  console.log(`--accent: ${s("gray",4)};`);
  console.log(`--accent-foreground: ${s("gray",12)};`);
  console.log(`--destructive: ${s("danger",9)};`);
  console.log(`--destructive-foreground: ${semFg("danger",9)};`);
  console.log(`--border: ${s("gray",6)};`);
  console.log(`--input: ${s("gray",7)};`);
  console.log(`--ring: ${s("accent",8)};`);
  console.log(`--brass: ${s("accent",9)};`);
  console.log(`--brass-foreground: ${semFg("accent",9)};`);
  console.log(`--success: ${s("success", L?9:11)};`);
  console.log(`--success-foreground: ${semFg("success", L?9:11)};`);
  console.log(`--warning: ${s("warning", L?11:11)};`);
  console.log(`--warning-foreground: ${semFg("warning", L?11:11)};`);
  console.log(`--info: ${s("info", L?9:11)};`);
  console.log(`--info-foreground: ${semFg("info", L?9:11)};`);
  console.log(`--danger: ${s("danger", L?9:11)};`);
  console.log(`--danger-foreground: ${semFg("danger", L?9:11)};`);
  console.log(`--chart-1: ${s("accent",9)};`);
  console.log(`--chart-2: ${s("info",9)};`);
  console.log(`--chart-3: ${s("success",9)};`);
  console.log(`--chart-4: ${s("danger",9)};`);
  console.log(`--chart-5: ${s("gray",9)};`);
  console.log(`--sidebar-background: ${L ? s("gray",2) : s("gray",1)};`);
  console.log(`--sidebar-foreground: ${s("gray",11)};`);
  console.log(`--sidebar-primary: ${s("accent",9)};`);
  console.log(`--sidebar-primary-foreground: ${semFg("accent",9)};`);
  console.log(`--sidebar-accent: ${s("gray",4)};`);
  console.log(`--sidebar-accent-foreground: ${s("gray",12)};`);
  console.log(`--sidebar-border: ${s("gray",6)};`);
  console.log(`--sidebar-ring: ${s("accent",8)};`);
}
