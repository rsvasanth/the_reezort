"use client";

import { CheckIcon, LaptopIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/components/theme-provider";

const themeOptions: {
	value: Theme;
	label: string;
	icon: typeof SunIcon;
}[] = [
	{
		value: "light",
		label: "Light",
		icon: SunIcon,
	},
	{
		value: "dark",
		label: "Dark",
		icon: MoonIcon,
	},
	{
		value: "system",
		label: "System",
		icon: LaptopIcon,
	},
];

export function ModeToggle() {
	const { theme, setTheme } = useTheme();
	const activeTheme = themeOptions.find((option) => option.value === theme) ?? themeOptions[1];
	const ActiveIcon = activeTheme.icon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon" className="size-8" aria-label="Switch theme">
					<ActiveIcon className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				{themeOptions.map((option) => (
					<DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
						<option.icon className="size-4" />
						<span>{option.label}</span>
						{theme === option.value ? <CheckIcon className="ml-auto size-4" /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
