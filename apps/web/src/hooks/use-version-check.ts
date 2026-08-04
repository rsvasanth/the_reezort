/**
 * Detects when a newer SPA build has been deployed while this tab stayed open
 * (the classic "stale cached bundle shows phantom errors" problem, since hash
 * navigation never re-fetches index.html). Polls the served HTML, compares the
 * referenced bundle hash to the one this tab loaded, and prompts a one-click reload.
 */

import { useEffect } from "react";
import { toast } from "sonner";

const POLL_MS = 60_000;

function loadedBundle(): string | null {
	const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
	const src = scripts.map((s) => s.src).find((s) => /\/assets\/index-[\w-]+\.js$/.test(s));
	return src ? (src.split("/").pop() ?? null) : null;
}

async function deployedBundle(): Promise<string | null> {
	try {
		const res = await fetch("/resort-app", { cache: "no-store", headers: { Accept: "text/html" } });
		if (!res.ok) return null;
		const html = await res.text();
		const m = html.match(/index-[\w-]+\.js/);
		return m ? m[0] : null;
	} catch {
		return null;
	}
}

export function useVersionCheck() {
	useEffect(() => {
		const current = loadedBundle();
		if (!current) return;
		let prompted = false;

		async function check() {
			if (prompted) return;
			const deployed = await deployedBundle();
			if (deployed && deployed !== current) {
				prompted = true;
				toast.warning("A new version is available", {
					description: "Reload to get the latest update.",
					duration: Infinity,
					action: { label: "Reload", onClick: () => window.location.reload() },
				});
			}
		}

		const id = window.setInterval(check, POLL_MS);
		// also check when the tab is refocused (likely after a deploy)
		const onFocus = () => check();
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("focus", onFocus);
		};
	}, []);
}
