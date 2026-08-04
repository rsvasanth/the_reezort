/**
 * Staff & Access — onboard staff logins, assign roles, manage the directory.
 * No ERPNext desk. Mount inside <AppShell>.
 */

import { useCallback, useEffect, useState } from "react";
import { Field } from "@/components/workspace/field";
import { CreditCard, Loader2, Plus, Pencil, UserCheck, UserX } from "lucide-react";
import { downloadStaffIdCard } from "@/lib/staff-id-card";
import { toast } from "sonner";

import { GuestAvatar } from "@/components/guest-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	FolioApiError,
	createStaff,
	listStaff,
	listStaffOptions,
	setStaffEnabled,
	updateStaffRoles,
	type StaffMember,
	type StaffOptions,
} from "@/lib/staff-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

export default function StaffAccessScreen() {
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [options, setOptions] = useState<StaffOptions | null>(null);
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);
	const [editing, setEditing] = useState<StaffMember | "new" | null>(null);

	const reload = useCallback(async () => {
		try {
			const [s, o] = await Promise.all([listStaff(), listStaffOptions()]);
			setStaff(s.staff);
			setOptions(o);
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			else reportError(error, "Could not load staff");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	async function toggleEnabled(member: StaffMember) {
		try {
			await setStaffEnabled(member.user, !member.enabled);
			toast.success(member.enabled ? "Access disabled" : "Access enabled", { description: member.user });
			reload();
		} catch (error) {
			reportError(error, "Could not change access");
		}
	}

	return (
		<main className="flex flex-1 flex-col gap-6  px-4 py-6 lg:px-6" data-testid="staff-screen">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Badge variant="outline" className="mb-2">Staff &amp; Access</Badge>
					<h1 className="text-3xl font-light text-foreground md:text-4xl">Staff &amp; access</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Onboard staff logins and assign roles — without the ERPNext desk.
					</p>
				</div>
				<Button onClick={() => setEditing("new")} data-testid="add-staff" disabled={denied}>
					<Plus className="size-4" /> Add staff
				</Button>
			</header>

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : denied ? (
				<Card><CardContent className="py-8 text-sm text-muted-foreground">
					You do not have permission to manage staff. Ask a manager.
				</CardContent></Card>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Staff</TableHead>
								<TableHead>Roles</TableHead>
								<TableHead>Designation</TableHead>
								<TableHead>Access</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{staff.map((m) => (
								<TableRow key={m.user} data-testid={`staff-row-${m.user}`} className={m.enabled ? "" : "opacity-50"}>
									<TableCell>
										<div className="flex items-center gap-3">
											<GuestAvatar name={m.full_name} imageUrl={m.image} size="sm" />
											<div>
												<div className="font-medium">{m.full_name}</div>
												<div className="text-xs text-muted-foreground">{m.user}</div>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{m.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
											{m.is_system_manager ? <Badge variant="outline">System Manager</Badge> : null}
										</div>
									</TableCell>
									<TableCell className="text-sm">{m.designation ?? "—"}</TableCell>
									<TableCell>{m.enabled ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Disabled</Badge>}</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												aria-label={m.employee ? `Print staff ID card for ${m.full_name}` : "No linked employee"}
												title={m.employee ? "Print ID card" : "No linked employee"}
												disabled={!m.employee}
												onClick={async () => {
													if (!m.employee) return;
													try {
														await downloadStaffIdCard({
															employee: m.employee,
															employee_name: m.full_name,
															designation: m.designation,
															image: m.image,
														});
														toast.success("ID card saved");
													} catch (error) {
														reportError(error, "ID card failed");
													}
												}}
												data-testid={`print-id-${m.user}`}
											>
												<CreditCard className="size-4" />
											</Button>
											<Button variant="ghost" size="icon" aria-label="Edit roles" onClick={() => setEditing(m)}>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Toggle access"
												disabled={m.is_system_manager}
												onClick={() => toggleEnabled(m)}
											>
												{m.enabled ? <UserX className="size-4 text-destructive" /> : <UserCheck className="size-4" />}
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{editing && options ? (
				<StaffSheet
					member={editing === "new" ? null : editing}
					options={options}
					onClose={() => setEditing(null)}
					onSaved={reload}
				/>
			) : null}
		</main>
	);
}

function StaffSheet({
	member,
	options,
	onClose,
	onSaved,
}: {
	member: StaffMember | null;
	options: StaffOptions;
	onClose: () => void;
	onSaved: () => void;
}) {
	const isNew = member === null;
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState({
		email: member?.user ?? "",
		first_name: member?.full_name ?? "",
		last_name: "",
		password: "",
		designation: member?.designation ?? "",
	});
	const [roles, setRoles] = useState<string[]>(member?.roles ?? []);

	function toggleRole(role: string) {
		setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
	}

	async function save() {
		setBusy(true);
		try {
			if (isNew) {
				await createStaff({
					email: form.email,
					first_name: form.first_name,
					last_name: form.last_name || undefined,
					password: form.password || undefined,
					roles,
					designation: form.designation || null,
				});
				toast.success("Staff added", { description: form.email });
			} else {
				await updateStaffRoles(member!.user, roles);
				toast.success("Roles updated", { description: member!.user });
			}
			onSaved();
			onClose();
		} catch (error) {
			reportError(error, "Could not save staff");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md" data-testid="staff-sheet">
				<SheetHeader>
					<SheetTitle>{isNew ? "Add staff" : member!.full_name}</SheetTitle>
					<SheetDescription>{isNew ? "Create a login and assign roles." : member!.user}</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 px-4 py-4">
					{isNew ? (
						<>
							<Field label="Email (login)">
								<Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@thereezort.com" data-testid="f-staff-email" />
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="First name">
									<Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="f-staff-firstname" />
								</Field>
								<Field label="Last name">
									<Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
								</Field>
							</div>
							<Field label="Initial password (blank = email a welcome link)">
								<Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 8 characters" data-testid="f-staff-password" />
							</Field>
							<Field label="Designation">
								<Select value={form.designation} onValueChange={(v) => setForm({ ...form, designation: v })}>
									<SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
									<SelectContent>
										{options.designations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
									</SelectContent>
								</Select>
							</Field>
						</>
					) : null}

					<div className="flex flex-col gap-2">
						<Label className="text-sm">Roles</Label>
						<div className="grid grid-cols-2 gap-2">
							{options.roles.map((role) => (
								<label key={role} className="flex items-center gap-2 text-sm" data-testid={`role-${role.replace(/\s+/g, "-")}`}>
									<Checkbox checked={roles.includes(role)} onCheckedChange={() => toggleRole(role)} />
									{role}
								</label>
							))}
						</div>
					</div>
				</div>

				<SheetFooter>
					<Button onClick={save} disabled={busy} data-testid="staff-save">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null}
						{isNew ? "Create staff" : "Save roles"}
					</Button>
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
