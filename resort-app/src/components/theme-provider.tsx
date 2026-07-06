"use client";

import * as React from "react";

export type Theme = "dark" | "light" | "system";

type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const storageKey = "the-reezort-ui-theme";

const initialState: ThemeProviderState = {
	theme: "light",
	setTheme: () => null,
};

const ThemeProviderContext = React.createContext<ThemeProviderState>(initialState);

function getSystemTheme() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
	const root = window.document.documentElement;
	const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

	root.classList.remove("light", "dark");
	root.classList.add(resolvedTheme);
	root.style.colorScheme = resolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = React.useState<Theme>(() => {
		const storedTheme = localStorage.getItem(storageKey);

		if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
			return storedTheme;
		}

		return "light";
	});

	React.useEffect(() => {
		applyTheme(theme);
		localStorage.setItem(storageKey, theme);

		if (theme !== "system") {
			return undefined;
		}

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const updateSystemTheme = () => applyTheme("system");

		mediaQuery.addEventListener("change", updateSystemTheme);

		return () => mediaQuery.removeEventListener("change", updateSystemTheme);
	}, [theme]);

	const value = React.useMemo(
		() => ({
			theme,
			setTheme,
		}),
		[theme],
	);

	return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export function useTheme() {
	const context = React.useContext(ThemeProviderContext);

	if (context === undefined) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}

	return context;
}
