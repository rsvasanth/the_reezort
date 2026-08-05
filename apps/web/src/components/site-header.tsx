import { ModeToggle } from "@/components/mode-toggle";
import { MyDayClock } from "@/components/my-day-clock";
import { NotificationBell } from "@/components/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePageMeta } from "@/components/workspace/workspace";

export function SiteHeader() {
	const { meta } = usePageMeta();

	return (
		<header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-[width,height] ease-linear">
			<div className="flex w-full items-center gap-2 px-4 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
				<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						{meta?.onBack ? (
							<button
								type="button"
								onClick={meta.onBack}
								className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
							>
								←
							</button>
						) : null}
						<h1 className="truncate text-sm font-medium">{meta?.title ?? "Resort operations"}</h1>
						{meta?.tag ? <Badge variant="secondary" className="shrink-0">{meta.tag}</Badge> : null}
						{meta?.subtitle ? (
							<span className="hidden truncate text-sm text-muted-foreground lg:inline">
								· {meta.subtitle}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<MyDayClock />
						<NotificationBell />
						<ModeToggle />
						<div className="hidden items-center gap-2 sm:flex">
							<Badge variant="outline">app.thereezort.com</Badge>
							<Badge variant="secondary">Prototype</Badge>
						</div>
					</div>
				</div>
			</div>
		</header>
	);
}
