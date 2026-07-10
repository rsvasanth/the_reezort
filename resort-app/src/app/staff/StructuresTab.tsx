/**
 * Structures tab — assign Salary Structure + base to each employee
 * (spec 008, ui-ux-structures-tab). Manager-only.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
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
	assignSalaryStructure,
	deactivateSalaryStructureAssignment,
	listSalaryStructureAssignments,
	listSalaryStructures,
	type SalaryAssignmentRow,
	type SalaryStructure,
} from "@/lib/staff-api";

function reportError(error: unknown, fallback: string) {
	const detail = error instanceof FolioApiError ? error.blockers[0]?.message ?? error.message : String(error);
	toast.error(fallback, { description: detail });
}

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function StructuresTab() {
	const [rows, setRows] = useState<SalaryAssignmentRow[]>([]);
	const [structures, setStructures] = useState<SalaryStructure[]>([]);
	const [unassigned, setUnassigned] = useState(0);
	const [loading, setLoading] = useState(true);
	const [denied, setDenied] = useState(false);
	const [openAssign, setOpenAssign] = useState<SalaryAssignmentRow | null>(null);

	const reload = useCallback(async () => {
		try {
			const [list, structs] = await Promise.all([
				listSalaryStructureAssignments(),
				listSalaryStructures(),
			]);
			setRows(list.rows);
			setUnassigned(list.unassigned_count);
			setStructures(structs.structures);
		} catch (error) {
			if (error instanceof FolioApiError && error.status === 403) setDenied(true);
			else reportError(error, "Could not load structures");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { reload(); }, [reload]);

	async function onDeactivate(assignmentName: string) {
		try {
			await deactivateSalaryStructureAssignment(assignmentName);
			toast.success("Assignment deactivated");
			await reload();
		} catch (error) {
			reportError(error, "Deactivate failed");
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading structures…
			</div>
		);
	}

	if (denied) {
		return (
			<Card><CardContent className="py-8 text-sm text-muted-foreground">
				You do not have permission to manage salary structures. Ask a manager.
			</CardContent></Card>
		);
	}

	return (
		<div className="flex flex-col gap-4" data-testid="structures-tab">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-medium">Salary structures</h2>
					{unassigned > 0 ? (
						<div className="mt-1 text-xs text-[#684e00]">
							{unassigned} employee{unassigned === 1 ? "" : "s"} without a structure — payroll will skip them.
						</div>
					) : null}
				</div>
				<Button
					size="sm"
					onClick={() => setOpenAssign({ employee: "", employee_name: "", designation: null, company: "", date_of_joining: null, assignment: null })}
					data-testid="assign-structure-btn"
				>
					<Plus className="size-4" /> Assign structure
				</Button>
			</div>

			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Employee</TableHead>
							<TableHead>Designation</TableHead>
							<TableHead>Structure</TableHead>
							<TableHead>Base</TableHead>
							<TableHead>From date</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((r) => (
							<TableRow key={r.employee} data-testid={`struct-row-${r.employee}`}>
								<TableCell className="font-medium">{r.employee_name}</TableCell>
								<TableCell>{r.designation ?? "—"}</TableCell>
								<TableCell>
									{r.assignment ? (
										<span>{r.assignment.salary_structure}</span>
									) : (
										<Badge variant="outline" className="border-[#b28600] text-[#684e00]">Unassigned</Badge>
									)}
								</TableCell>
								<TableCell>{r.assignment ? formatINR(r.assignment.base) : "—"}</TableCell>
								<TableCell>{r.assignment?.from_date ?? "—"}</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-2">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setOpenAssign(r)}
											data-testid={`edit-assignment-${r.employee}`}
										>
											{r.assignment ? "Edit base" : "Assign"}
										</Button>
										{r.assignment ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onDeactivate(r.assignment!.name)}
												data-testid={`deactivate-${r.employee}`}
											>
												Deactivate
											</Button>
										) : null}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<AssignStructureSheet
				target={openAssign}
				employees={rows}
				structures={structures}
				onOpenChange={(v) => { if (!v) setOpenAssign(null); }}
				onSubmitted={async () => { setOpenAssign(null); await reload(); }}
			/>
		</div>
	);
}

function AssignStructureSheet({
	target,
	employees,
	structures,
	onOpenChange,
	onSubmitted,
}: {
	target: SalaryAssignmentRow | null;
	employees: SalaryAssignmentRow[];
	structures: SalaryStructure[];
	onOpenChange: (v: boolean) => void;
	onSubmitted: () => Promise<void>;
}) {
	const open = !!target;
	const [employee, setEmployee] = useState<string>("");
	const [structure, setStructure] = useState<string>("");
	const [base, setBase] = useState<string>("");
	const [fromDate, setFromDate] = useState<string>("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setEmployee(target?.employee ?? "");
		setStructure(target?.assignment?.salary_structure ?? structures[0]?.name ?? "");
		setBase(target?.assignment ? String(target.assignment.base) : "");
		const first = new Date();
		first.setDate(1);
		setFromDate(target?.assignment?.from_date ?? first.toISOString().slice(0, 10));
	}, [open, target, structures]);

	async function submit() {
		const b = Number(base);
		if (!employee) { toast.error("Choose an employee"); return; }
		if (!structure) { toast.error("Choose a structure"); return; }
		if (!b || b <= 0) { toast.error("Base must be > 0"); return; }
		setBusy(true);
		try {
			await assignSalaryStructure({ employee, salary_structure: structure, base: b, from_date: fromDate });
			toast.success(target?.assignment ? "Base updated" : "Structure assigned");
			await onSubmitted();
		} catch (error) {
			reportError(error, "Assign failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-md">
				<SheetHeader>
					<SheetTitle>{target?.assignment ? "Edit base" : "Assign salary structure"}</SheetTitle>
					<SheetDescription>Applies from the given date. Existing assignment is cancelled.</SheetDescription>
				</SheetHeader>
				<div className="mt-6 flex flex-col gap-4">
					<div>
						<Label>Employee</Label>
						<Select value={employee} onValueChange={setEmployee} disabled={!!target?.assignment}>
							<SelectTrigger data-testid="assign-employee">
								<SelectValue placeholder="Pick employee" />
							</SelectTrigger>
							<SelectContent>
								{employees.map((e) => (
									<SelectItem key={e.employee} value={e.employee}>
										{e.employee_name}{e.designation ? ` · ${e.designation}` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label>Structure</Label>
						<Select value={structure} onValueChange={setStructure}>
							<SelectTrigger data-testid="assign-structure">
								<SelectValue placeholder="Pick structure" />
							</SelectTrigger>
							<SelectContent>
								{structures.map((s) => (
									<SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label>Base (INR)</Label>
						<Input
							type="number"
							inputMode="decimal"
							value={base}
							onChange={(e) => setBase(e.target.value)}
							data-testid="assign-base"
						/>
					</div>
					<div>
						<Label>From date</Label>
						<Input
							type="date"
							value={fromDate}
							onChange={(e) => setFromDate(e.target.value)}
							data-testid="assign-from-date"
						/>
					</div>
				</div>
				<SheetFooter className="mt-6">
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
					<Button onClick={submit} disabled={busy} data-testid="assign-submit">
						{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
