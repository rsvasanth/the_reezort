import * as React from "react"
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react"

import { subscribeToasts, dismissToast, type ToastItem, type ToastKind } from "@/lib/toast-store"
import { cn } from "@/lib/utils"

interface ToasterProps {
	position?: "top-right" | "top-left" | "bottom-right" | "bottom-left"
	richColors?: boolean
	closeButton?: boolean
}

const POSITION_CLASS: Record<NonNullable<ToasterProps["position"]>, string> = {
	"top-right": "top-4 right-4",
	"top-left": "top-4 left-4",
	"bottom-right": "bottom-4 right-4",
	"bottom-left": "bottom-4 left-4",
}

const KIND: Record<ToastKind, { icon: typeof Info; accent: string }> = {
	success: { icon: CheckCircle2, accent: "text-success" },
	error: { icon: XCircle, accent: "text-danger" },
	warning: { icon: AlertTriangle, accent: "text-warning" },
	info: { icon: Info, accent: "text-info" },
}

/**
 * Toasts come from `@/lib/toast-store`, which every call site reaches through the
 * "sonner" alias in vite.config.ts.
 */
function Toast({ item }: { item: ToastItem }) {
	const { icon: Icon, accent } = KIND[item.kind]

	React.useEffect(() => {
		if (!item.timeout) return undefined
		const timer = setTimeout(() => dismissToast(item.id), item.timeout)
		return () => clearTimeout(timer)
	}, [item.id, item.timeout])

	return (
		<div
			role={item.kind === "error" ? "alert" : "status"}
			className={cn(
				"pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-border",
				"bg-popover p-3 text-popover-foreground shadow-lg",
				"animate-in fade-in-0 slide-in-from-top-2",
			)}
		>
			<Icon className={cn("mt-0.5 h-4 w-4 shrink-0", accent)} />
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium leading-tight">{item.title}</p>
				{item.subtitle ? (
					<p className="mt-1 text-xs leading-snug text-muted-foreground">{item.subtitle}</p>
				) : null}
			</div>
			<button
				type="button"
				aria-label="Dismiss"
				onClick={() => dismissToast(item.id)}
				className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	)
}

const Toaster = ({ position = "top-right" }: ToasterProps) => {
	const [items, setItems] = React.useState<ToastItem[]>([])

	React.useEffect(() => subscribeToasts(setItems), [])

	return (
		<div
			className={cn(
				"pointer-events-none fixed z-[9999] flex flex-col gap-2",
				POSITION_CLASS[position],
			)}
		>
			{items.map((item) => (
				<Toast key={item.id} item={item} />
			))}
		</div>
	)
}

export { Toaster }
