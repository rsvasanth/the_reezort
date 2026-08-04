import { generateRadixColors } from "./gen.tsx";

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

const GRAY = { light: "#0A0D1E", dark: "#E5E5E6" };
const BG   = { light: "#FFFFFF", dark: "#111111" };

// Accent is the brand. The semantic seeds run through the same generator so they
// sit on the same grays, but are pulled to distinct hues — warning must not read
// as primary, and primary is amber-bronze.
const SEEDS = {
  accent:  "#A66407",
  success: "#2F7D4F",
  warning: "#C2A000",
  danger:  "#C0392B",
  info:    "#3E6FB0",
};

for (const mode of ["light","dark"] as const) {
  const out: Record<string,string[]> = {};
  for (const [name, seed] of Object.entries(SEEDS)) {
    const r = generateRadixColors({ appearance: mode, accent: seed, gray: GRAY[mode], background: BG[mode] });
    out[name] = r.accentScale;
    if (name === "accent") out.gray = r.grayScale;
  }
  const s = (n: string, i: number) => hexToHsl(out[n][i-1]);
  console.log(`\n/* ===== ${mode} ===== */`);
  console.log(`--background: ${mode === "light" ? s("gray",2) : s("gray",1)};`);
  console.log(`--foreground: ${s("gray",12)};`);
  console.log(`--card: ${mode === "light" ? s("gray",1) : s("gray",2)};`);
  console.log(`--card-foreground: ${s("gray",12)};`);
  console.log(`--popover: ${mode === "light" ? s("gray",1) : s("gray",2)};`);
  console.log(`--popover-foreground: ${s("gray",12)};`);
  console.log(`--primary: ${s("accent",9)};`);
  console.log(`--primary-foreground: ${mode === "light" ? "0 0% 100%" : "0 0% 100%"};`);
  console.log(`--secondary: ${s("gray",3)};`);
  console.log(`--secondary-foreground: ${s("gray",12)};`);
  console.log(`--muted: ${s("gray",3)};`);
  console.log(`--muted-foreground: ${s("gray",11)};`);
  console.log(`--accent: ${s("gray",4)};`);
  console.log(`--accent-foreground: ${s("gray",12)};`);
  console.log(`--destructive: ${s("danger",9)};`);
  console.log(`--destructive-foreground: 0 0% 100%;`);
  console.log(`--border: ${s("gray",6)};`);
  console.log(`--input: ${s("gray",7)};`);
  console.log(`--ring: ${s("accent",8)};`);
  console.log(`--brass: ${s("accent",9)};`);
  console.log(`--brass-foreground: 0 0% 100%;`);
  console.log(`--success: ${s("success",mode==="light"?9:11)};`);
  console.log(`--success-foreground: 0 0% 100%;`);
  console.log(`--warning: ${s("warning",mode==="light"?11:11)};`);
  console.log(`--warning-foreground: 0 0% 100%;`);
  console.log(`--info: ${s("info",mode==="light"?9:11)};`);
  console.log(`--info-foreground: 0 0% 100%;`);
  console.log(`--danger: ${s("danger",mode==="light"?9:11)};`);
  console.log(`--danger-foreground: 0 0% 100%;`);
  console.log(`--chart-1: ${s("accent",9)};`);
  console.log(`--chart-2: ${s("info",9)};`);
  console.log(`--chart-3: ${s("success",9)};`);
  console.log(`--chart-4: ${s("danger",9)};`);
  console.log(`--chart-5: ${s("gray",9)};`);
  console.log(`--sidebar-background: ${mode === "light" ? s("gray",2) : s("gray",1)};`);
  console.log(`--sidebar-foreground: ${s("gray",11)};`);
  console.log(`--sidebar-primary: ${s("accent",9)};`);
  console.log(`--sidebar-primary-foreground: 0 0% 100%;`);
  console.log(`--sidebar-accent: ${s("gray",4)};`);
  console.log(`--sidebar-accent-foreground: ${s("gray",12)};`);
  console.log(`--sidebar-border: ${s("gray",6)};`);
  console.log(`--sidebar-ring: ${s("accent",8)};`);
}
