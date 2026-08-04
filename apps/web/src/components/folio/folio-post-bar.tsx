/**
 * FolioPostBar — the "post to this folio" command bar.
 *
 * Sits directly above the stay ledger so the action lives next to its
 * consequence (the old design scattered Add Line / Deposit / Order /
 * Minibar in the header, far from the table they write into). Each chip
 * opens the corresponding existing sheet; gating is decided by the
 * caller (next_actions + read-only rules), this component only renders.
 */

import { Banknote, PenLine, Plus, UtensilsCrossed, Wine } from "lucide-react";

type Props = {
	canAddLine: boolean;
	canDeposit: boolean;
	canOrder: boolean;
	canMinibar: boolean;
	onAddLine: () => void;
	onDeposit: () => void;
	onOrder: () => void;
	onMinibar: () => void;
};

export function FolioPostBar({
	canAddLine,
	canDeposit,
	canOrder,
	canMinibar,
	onAddLine,
	onDeposit,
	onOrder,
	onMinibar,
}: Props) {
	if (!canAddLine && !canDeposit && !canOrder && !canMinibar) return null;

	return (
		<div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-card p-1.5">
			<button
				type="button"
				onClick={canAddLine ? onAddLine : undefined}
				disabled={!canAddLine}
				className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
			>
				<Plus className="size-4 shrink-0" />
				<span className="truncate">Post a charge to this folio…</span>
			</button>
			{canOrder && (
				<PostChip icon={<UtensilsCrossed className="size-3.5" />} label="F&B order" onClick={onOrder} testId="folio-ird" />
			)}
			{canMinibar && (
				<PostChip icon={<Wine className="size-3.5" />} label="Minibar" onClick={onMinibar} testId="folio-minibar" />
			)}
			{canDeposit && (
				<PostChip icon={<Banknote className="size-3.5" />} label="Deposit" onClick={onDeposit} testId="folio-deposit" />
			)}
			{canAddLine && (
				<PostChip icon={<PenLine className="size-3.5" />} label="Custom line" onClick={onAddLine} testId="folio-add-line" />
			)}
		</div>
	);
}

function PostChip({
	icon,
	label,
	onClick,
	testId,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-testid={testId}
			className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-brass/40 hover:bg-brass/10 hover:text-foreground"
		>
			{icon}
			{label}
		</button>
	);
}
