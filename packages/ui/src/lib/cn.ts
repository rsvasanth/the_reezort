import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Identical to the web's `@/lib/utils#cn`. Same helper, same name, same
 * semantics — the point of Rule 5 is that a developer moving between the two
 * codebases relearns nothing.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
