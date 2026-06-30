/**
 * Accessible form field — one shared component (replaces the ~6 duplicated `Field`
 * wrappers). Generates an id with useId(), puts htmlFor on the label, and forwards
 * the id onto the child control via Radix Slot, so the label is programmatically
 * associated (WCAG 1.3.1 / 3.3.2 / 4.1.2). Inputs get a real <label for>.
 */

import { useId, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";

import { Label } from "@/components/ui/label";

export function Field({
	label,
	hint,
	required,
	children,
}: {
	label: string;
	hint?: string;
	required?: boolean;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id} className="text-sm">
				{label}
				{required ? <span className="text-destructive"> *</span> : null}
			</Label>
			<Slot id={id}>{children}</Slot>
			{hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
		</div>
	);
}
