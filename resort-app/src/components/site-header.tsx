import { ModeToggle } from "@/components/mode-toggle";
import { MyDayClock } from "@/components/my-day-clock";
import { NotificationBell } from "@/components/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
	return (
		<header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
			<div className="flex w-full items-center gap-2 px-4 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
				<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
					<div className="min-w-0">
						<h1 className="truncate text-sm font-medium">Resort operations</h1>
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
