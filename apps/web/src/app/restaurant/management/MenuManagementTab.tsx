/**
 * MenuManagementTab — menu / pricing / recipe console (spec 006 · Menu slice).
 *
 * Lists all menu items for the selected outlet with thumbnail, category, price,
 * availability toggle, and margin (price − recipe cost) when a BOM exists.
 * Provides Create / Edit / Price / Recipe drawers using the menu-management-api
 * client.  Reuses MenuItemThumb from the shared F&B visuals atoms.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	BookOpen,
	ChefHat,
	Edit2,
	Loader2,
	Minus,
	Plus,
	RefreshCw,
	Trash2,
	UtensilsCrossed,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FolioApiError } from "@/lib/folio-api";
import { listMenuItems, type MenuItem } from "@/lib/fnb-api";
import {
	createMenuItem,
	getMenuItemDetail,
	listIngredients,
	setMenuItemPrice,
	setMenuItemRecipe,
	toggleMenuItemAvailability,
	updateMenuItem,
	type CreateMenuItemPayload,
	type IngredientCatalogRow,
	type MenuCategory,
	type MenuItemFull,
	type MenuVegFlag,
	type RecipeIngredientInput,
} from "@/lib/menu-management-api";
import { MenuItemThumb, formatINR } from "@/components/fnb/menu-visuals";
import { PhotoField } from "@/components/property/photo-field";

// ─── constants ───────────────────────────────────────────────────────────────

const CATEGORIES: MenuCategory[] = [
	"Starters",
	"Mains",
	"Desserts",
	"Beverages",
	"Alcohol",
	"Sides",
	"Breakfast",
	"Other",
];

const VEG_FLAGS: MenuVegFlag[] = ["Veg", "Non-veg", "Egg", "Vegan"];

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractError(err: unknown): string {
	if (err instanceof FolioApiError) {
		const b = err.blockers?.[0];
		if (b) return b.message ?? b.title ?? String(err);
	}
	return String(err);
}

function MarginBadge({
	margin,
	marginPct,
}: {
	margin: number | null;
	marginPct: number | null;
}) {
	if (margin === null) {
		return (
			<span className="text-xs text-muted-foreground italic">No recipe</span>
		);
	}
	const good = marginPct !== null && marginPct >= 60;
	return (
		<Badge
			variant="outline"
			className={
				good
					? "border-green-600/40 text-green-700 dark:text-green-400"
					: "border-yellow-600/40 text-yellow-700 dark:text-yellow-400"
			}
		>
			{formatINR(margin)}
			{marginPct !== null ? ` · ${marginPct.toFixed(0)}%` : ""}
		</Badge>
	);
}

// ─── item form (create + edit) ────────────────────────────────────────────────

type ItemFormValues = {
	item_name: string;
	category: MenuCategory;
	veg_flag: MenuVegFlag;
	price: string;
	spice_level: string;
	prep_time_minutes: string;
	description: string;
	allergens: string;
	tags: string;
	image: string;
};

function blankForm(outlet: string): ItemFormValues & { outlet: string } {
	return {
		outlet,
		item_name: "",
		category: "Mains",
		veg_flag: "Veg",
		price: "",
		spice_level: "0",
		prep_time_minutes: "0",
		description: "",
		allergens: "",
		tags: "",
		image: "",
	};
}

function fromMenuItem(item: MenuItem): ItemFormValues {
	return {
		item_name: item.item_name,
		category: item.category as MenuCategory,
		veg_flag: (item.veg_flag as MenuVegFlag) ?? "Veg",
		price: String(item.price),
		spice_level: String(item.spice_level ?? 0),
		prep_time_minutes: String(item.prep_time_minutes ?? 0),
		description: item.description ?? "",
		allergens: item.allergens ?? "",
		tags: item.tags ?? "",
		image: item.image ?? "",
	};
}

// ─── ItemFormSheet ─────────────────────────────────────────────────────────

function ItemFormSheet({
	open,
	mode,
	initialValues,
	onClose,
	onSaved,
}: {
	open: boolean;
	mode: "create" | "edit";
	initialValues: ItemFormValues & { outlet: string; name?: string };
	onClose: () => void;
	onSaved: (item: MenuItem) => void;
}) {
	const [form, setForm] = useState(initialValues);
	const [busy, setBusy] = useState(false);

	// Reset on open
	useEffect(() => {
		if (open) setForm(initialValues);
	}, [open, initialValues]);

	function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
		setForm((prev) => ({ ...prev, [k]: v }));
	}

	async function handleSave() {
		if (!form.item_name.trim()) {
			toast.error("Item name is required");
			return;
		}
		const price = parseFloat(form.price);
		if (!price || price <= 0) {
			toast.error("Price must be greater than 0");
			return;
		}
		setBusy(true);
		try {
			if (mode === "create") {
				const payload: CreateMenuItemPayload = {
					item_name: form.item_name.trim(),
					outlet: form.outlet,
					category: form.category,
					price,
					veg_flag: form.veg_flag,
					spice_level: parseInt(form.spice_level) || 0,
					prep_time_minutes: parseInt(form.prep_time_minutes) || 0,
					description: form.description || undefined,
					allergens: form.allergens || undefined,
					tags: form.tags || undefined,
					image: form.image || undefined,
				};
				const res = await createMenuItem(payload);
				toast.success("Menu item created", { description: form.item_name });
				onSaved(res.menu_item as unknown as MenuItem);
			} else {
				if (!initialValues.name) return;
				const payload = {
					item_name: form.item_name.trim(),
					category: form.category,
					veg_flag: form.veg_flag,
					price,
					spice_level: parseInt(form.spice_level) || 0,
					prep_time_minutes: parseInt(form.prep_time_minutes) || 0,
					description: form.description || undefined,
					allergens: form.allergens || undefined,
					tags: form.tags || undefined,
					image: form.image || undefined,
				};
				const res = await updateMenuItem(initialValues.name, payload);
				toast.success("Item updated", { description: form.item_name });
				onSaved(res.menu_item as unknown as MenuItem);
			}
		} catch (err) {
			toast.error(mode === "create" ? "Could not create item" : "Could not save item", {
				description: extractError(err),
			});
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="w-[520px] max-w-full overflow-y-auto">
				<SheetHeader>
					<SheetTitle>{mode === "create" ? "New menu item" : "Edit item"}</SheetTitle>
					<SheetDescription>
						{mode === "create"
							? "Add a new item to this outlet's menu."
							: "Update item details. Price changes sync to ERPNext Item Price."}
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6 flex flex-col gap-4">
					{/* Image */}
					<div>
						<Label className="mb-1.5 block">Photo</Label>
						<PhotoField
							image={form.image || null}
							label={form.item_name || "Item photo"}
							onUploaded={(url) => set("image", url)}
						/>
					</div>

					{/* Name */}
					<div>
						<Label htmlFor="mi-name" className="mb-1.5 block">
							Item name <span className="text-destructive">*</span>
						</Label>
						<Input
							id="mi-name"
							value={form.item_name}
							onChange={(e) => set("item_name", e.target.value)}
							placeholder="e.g. Butter Chicken"
						/>
					</div>

					{/* Category + Veg flag */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label htmlFor="mi-cat" className="mb-1.5 block">
								Category <span className="text-destructive">*</span>
							</Label>
							<Select value={form.category} onValueChange={(v) => set("category", v as MenuCategory)}>
								<SelectTrigger id="mi-cat">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CATEGORIES.map((c) => (
										<SelectItem key={c} value={c}>
											{c}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="mi-veg" className="mb-1.5 block">
								Dietary
							</Label>
							<Select value={form.veg_flag} onValueChange={(v) => set("veg_flag", v as MenuVegFlag)}>
								<SelectTrigger id="mi-veg">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{VEG_FLAGS.map((f) => (
										<SelectItem key={f} value={f}>
											{f}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Price + Spice + Prep */}
					<div className="grid grid-cols-3 gap-3">
						<div>
							<Label htmlFor="mi-price" className="mb-1.5 block">
								Price (₹) <span className="text-destructive">*</span>
							</Label>
							<Input
								id="mi-price"
								type="number"
								min={0}
								step={0.01}
								value={form.price}
								onChange={(e) => set("price", e.target.value)}
								placeholder="0"
							/>
						</div>
						<div>
							<Label htmlFor="mi-spice" className="mb-1.5 block">
								Spice (0–5)
							</Label>
							<Input
								id="mi-spice"
								type="number"
								min={0}
								max={5}
								step={1}
								value={form.spice_level}
								onChange={(e) => set("spice_level", e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="mi-prep" className="mb-1.5 block">
								Prep (min)
							</Label>
							<Input
								id="mi-prep"
								type="number"
								min={0}
								step={1}
								value={form.prep_time_minutes}
								onChange={(e) => set("prep_time_minutes", e.target.value)}
							/>
						</div>
					</div>

					{/* Description */}
					<div>
						<Label htmlFor="mi-desc" className="mb-1.5 block">
							Description
						</Label>
						<Textarea
							id="mi-desc"
							value={form.description}
							onChange={(e) => set("description", e.target.value)}
							rows={3}
							placeholder="Short tasting note…"
						/>
					</div>

					{/* Allergens + Tags */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<Label htmlFor="mi-allergens" className="mb-1.5 block">
								Allergens
							</Label>
							<Input
								id="mi-allergens"
								value={form.allergens}
								onChange={(e) => set("allergens", e.target.value)}
								placeholder="Dairy, Nuts…"
							/>
						</div>
						<div>
							<Label htmlFor="mi-tags" className="mb-1.5 block">
								Tags
							</Label>
							<Input
								id="mi-tags"
								value={form.tags}
								onChange={(e) => set("tags", e.target.value)}
								placeholder="Signature, Chef pick…"
							/>
						</div>
					</div>
				</div>

				<SheetFooter className="mt-6">
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={busy}>
						{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
						{mode === "create" ? "Create item" : "Save changes"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── InlinePriceEdit ───────────────────────────────────────────────────────

function InlinePriceEdit({
	itemName,
	currentPrice,
	onSaved,
}: {
	itemName: string;
	currentPrice: number;
	onSaved: (updated: MenuItem) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(String(currentPrice));
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	function startEdit() {
		setValue(String(currentPrice));
		setEditing(true);
		requestAnimationFrame(() => inputRef.current?.select());
	}

	async function commit() {
		const price = parseFloat(value);
		if (!price || price <= 0) {
			toast.error("Price must be > 0");
			setEditing(false);
			return;
		}
		if (price === currentPrice) {
			setEditing(false);
			return;
		}
		setBusy(true);
		try {
			const res = await setMenuItemPrice(itemName, price);
			onSaved(res.menu_item as unknown as MenuItem);
			toast.success("Price updated");
		} catch (err) {
			toast.error("Could not update price", { description: extractError(err) });
		} finally {
			setBusy(false);
			setEditing(false);
		}
	}

	if (!editing) {
		return (
			<button
				onClick={startEdit}
				className="group flex items-center gap-1 text-sm font-medium tabular-nums hover:text-foreground"
				title="Click to edit price"
				data-testid={`price-edit-${itemName}`}
			>
				{formatINR(currentPrice)}
				<Edit2 className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
			</button>
		);
	}

	return (
		<div className="flex items-center gap-1">
			<span className="text-xs text-muted-foreground">₹</span>
			<Input
				ref={inputRef}
				type="number"
				min={0}
				step={0.01}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") setEditing(false);
				}}
				className="h-7 w-24 text-sm"
				disabled={busy}
				autoFocus
			/>
			{busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
		</div>
	);
}

// ─── RecipeEditor ───────────────────────────────────────────────────────────

type DraftIngredient = {
	item_code: string;
	item_name: string;
	qty: string;
	uom: string;
	rate: number;
};

function RecipeSheet({
	open,
	itemName,
	onClose,
	onSaved,
}: {
	open: boolean;
	itemName: string;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [detail, setDetail] = useState<MenuItemFull | null>(null);
	const [catalog, setCatalog] = useState<IngredientCatalogRow[]>([]);
	const [rows, setRows] = useState<DraftIngredient[]>([]);
	const [search, setSearch] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		Promise.all([getMenuItemDetail(itemName), listIngredients()])
			.then(([d, c]) => {
				setDetail(d);
				setCatalog(c.ingredients);
				setRows(
					(d.recipe.ingredients ?? []).map((ing) => ({
						item_code: ing.item_code,
						item_name: ing.item_name,
						qty: String(ing.qty),
						uom: ing.uom,
						rate: ing.rate,
					})),
				);
			})
			.catch((err) => {
				toast.error("Could not load recipe", { description: extractError(err) });
				onClose();
			})
			.finally(() => setLoading(false));
	}, [open, itemName, onClose]);

	const filteredCatalog = search.trim()
		? catalog.filter(
				(c) =>
					c.item_name.toLowerCase().includes(search.toLowerCase()) ||
					c.item_code.toLowerCase().includes(search.toLowerCase()),
			)
		: catalog;

	function addIngredient(c: IngredientCatalogRow) {
		if (rows.some((r) => r.item_code === c.item_code)) return;
		setRows((prev) => [
			...prev,
			{ item_code: c.item_code, item_name: c.item_name, qty: "1", uom: c.stock_uom, rate: c.valuation_rate },
		]);
		setSearch("");
	}

	function removeRow(code: string) {
		setRows((prev) => prev.filter((r) => r.item_code !== code));
	}

	function updateQty(code: string, qty: string) {
		setRows((prev) => prev.map((r) => (r.item_code === code ? { ...r, qty } : r)));
	}

	function updateUom(code: string, uom: string) {
		setRows((prev) => prev.map((r) => (r.item_code === code ? { ...r, uom } : r)));
	}

	async function handleSave() {
		if (rows.some((r) => !parseFloat(r.qty) || parseFloat(r.qty) <= 0)) {
			toast.error("All quantities must be > 0");
			return;
		}
		setBusy(true);
		try {
			const ingredients: RecipeIngredientInput[] = rows.map((r) => ({
				item_code: r.item_code,
				qty: parseFloat(r.qty),
				uom: r.uom || undefined,
			}));
			const res = await setMenuItemRecipe(itemName, ingredients);
			toast.success("Recipe saved", {
				description: `${res.ingredient_count} ingredient(s) · Cost ${formatINR(res.recipe_cost)} · Margin ${formatINR(res.margin)}`,
			});
			onSaved();
			onClose();
		} catch (err) {
			toast.error("Could not save recipe", { description: extractError(err) });
		} finally {
			setBusy(false);
		}
	}

	const recipeCost = rows.reduce((sum, r) => {
		const qty = parseFloat(r.qty) || 0;
		return sum + qty * r.rate;
	}, 0);

	const menuPrice = detail?.menu_item.price ?? 0;
	const margin = menuPrice > 0 ? menuPrice - recipeCost : null;

	return (
		<Sheet open={open} onOpenChange={(o) => !o && onClose()}>
			<SheetContent className="w-[600px] max-w-full overflow-y-auto">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<ChefHat className="size-5" /> Recipe editor
					</SheetTitle>
					<SheetDescription>
						{detail ? `${detail.menu_item.item_name} · ${formatINR(menuPrice)}` : "Loading…"}
					</SheetDescription>
				</SheetHeader>

				{loading ? (
					<div className="mt-12 flex justify-center">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<div className="mt-6 flex flex-col gap-5">
						{/* Cost / margin summary */}
						{rows.length > 0 && (
							<div className="flex flex-wrap gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
								<span>
									Recipe cost:{" "}
									<strong className="tabular-nums">{formatINR(recipeCost)}</strong>
								</span>
								<span>
									Price:{" "}
									<strong className="tabular-nums">{formatINR(menuPrice)}</strong>
								</span>
								{margin !== null && (
									<span>
										Margin:{" "}
										<strong
											className={`tabular-nums ${margin >= 0 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
										>
											{formatINR(margin)}
											{menuPrice > 0
												? ` (${((margin / menuPrice) * 100).toFixed(0)}%)`
												: ""}
										</strong>
									</span>
								)}
							</div>
						)}

						{/* Current ingredients */}
						{rows.length > 0 ? (
							<div className="flex flex-col gap-2">
								<Label className="text-xs uppercase tracking-wide text-muted-foreground">
									Ingredients
								</Label>
								{rows.map((r) => (
									<div
										key={r.item_code}
										className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
									>
										<span className="flex-1 text-sm">{r.item_name}</span>
										<Input
											type="number"
											min={0}
											step={0.01}
											value={r.qty}
											onChange={(e) => updateQty(r.item_code, e.target.value)}
											className="h-7 w-20 text-sm tabular-nums"
										/>
										<Input
											value={r.uom}
											onChange={(e) => updateUom(r.item_code, e.target.value)}
											className="h-7 w-16 text-sm"
											placeholder="UOM"
										/>
										<span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
											{formatINR((parseFloat(r.qty) || 0) * r.rate)}
										</span>
										<Button
											variant="ghost"
											size="icon"
											className="size-7 text-muted-foreground hover:text-destructive"
											onClick={() => removeRow(r.item_code)}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
								No ingredients yet — search below to add.
							</div>
						)}

						{/* Ingredient picker */}
						<div>
							<Label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
								Add ingredient
							</Label>
							<Input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search raw material…"
								className="mb-2"
							/>
							{search.trim() && (
								<div className="max-h-48 overflow-y-auto rounded-md border">
									{filteredCatalog.length === 0 ? (
										<p className="px-3 py-2 text-sm text-muted-foreground">No match</p>
									) : (
										filteredCatalog.slice(0, 20).map((c) => {
											const already = rows.some((r) => r.item_code === c.item_code);
											return (
												<button
													key={c.item_code}
													onClick={() => addIngredient(c)}
													disabled={already}
													className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40"
												>
													<span>{c.item_name}</span>
													<span className="text-xs text-muted-foreground">
														{c.stock_uom}
													</span>
												</button>
											);
										})
									)}
								</div>
							)}
						</div>
					</div>
				)}

				<SheetFooter className="mt-6">
					<Button variant="outline" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={busy || loading || rows.length === 0}>
						{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
						Save recipe
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ─── MenuItemRow ────────────────────────────────────────────────────────────

function MenuItemRow({
	item,
	onUpdated,
	onRefresh,
}: {
	item: MenuItem & { margin?: number | null; margin_pct?: number | null };
	onUpdated: (updated: MenuItem) => void;
	onRefresh: () => void;
}) {
	const [available, setAvailable] = useState(!!item.is_available);
	const [toggling, setToggling] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [recipeOpen, setRecipeOpen] = useState(false);

	// Keep in sync if parent refreshes
	useEffect(() => {
		setAvailable(!!item.is_available);
	}, [item.is_available]);

	async function handleToggle(val: boolean) {
		setToggling(true);
		setAvailable(val);
		try {
			const res = await toggleMenuItemAvailability(item.name, val);
			onUpdated(res.menu_item as unknown as MenuItem);
		} catch (err) {
			setAvailable(!val); // revert
			toast.error("Could not toggle availability", { description: extractError(err) });
		} finally {
			setToggling(false);
		}
	}

	return (
		<>
			<div
				className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-opacity ${!available ? "opacity-60" : ""}`}
				data-testid={`menu-row-${item.name}`}
			>
				<MenuItemThumb
					src={item.image}
					category={item.category}
					name={item.item_name}
					vegFlag={item.veg_flag}
					size="md"
				/>

				<div className="flex-1 min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="font-medium text-sm leading-snug">{item.item_name}</span>
						<Badge variant="secondary" className="text-[10px]">
							{item.category}
						</Badge>
						{!available && (
							<Badge variant="secondary" className="text-[10px]">
								86'd
							</Badge>
						)}
					</div>
					<div className="mt-0.5">
						<MarginBadge margin={item.margin ?? null} marginPct={item.margin_pct ?? null} />
					</div>
				</div>

				<div className="flex items-center gap-4 shrink-0">
					<InlinePriceEdit
						itemName={item.name}
						currentPrice={item.price}
						onSaved={onUpdated}
					/>

					<div className="flex items-center gap-1.5" title={available ? "Available" : "86'd"}>
						{toggling ? (
							<Loader2 className="size-4 animate-spin text-muted-foreground" />
						) : (
							<Switch
								checked={available}
								onCheckedChange={handleToggle}
								aria-label={`Toggle ${item.item_name} availability`}
								data-testid={`avail-toggle-${item.name}`}
							/>
						)}
					</div>

					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						onClick={() => setRecipeOpen(true)}
						title="Recipe / BOM"
						data-testid={`recipe-btn-${item.name}`}
					>
						<BookOpen className="size-4" />
					</Button>

					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						onClick={() => setEditOpen(true)}
						title="Edit item"
						data-testid={`edit-btn-${item.name}`}
					>
						<Edit2 className="size-4" />
					</Button>
				</div>
			</div>

			<ItemFormSheet
				open={editOpen}
				mode="edit"
				initialValues={{ ...fromMenuItem(item), outlet: item.outlet ?? "", name: item.name }}
				onClose={() => setEditOpen(false)}
				onSaved={(updated) => {
					onUpdated(updated);
					setEditOpen(false);
				}}
			/>

			<RecipeSheet
				open={recipeOpen}
				itemName={item.name}
				onClose={() => setRecipeOpen(false)}
				onSaved={onRefresh}
			/>
		</>
	);
}

// ─── main tab ────────────────────────────────────────────────────────────────

type ItemWithMargin = MenuItem & { margin?: number | null; margin_pct?: number | null };

export default function MenuManagementTab({ outlet }: { outlet: string }) {
	const [items, setItems] = useState<ItemWithMargin[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [filterCat, setFilterCat] = useState<MenuCategory | "">("");

	const load = useCallback(async () => {
		if (!outlet) {
			setItems([]);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await listMenuItems(outlet);
			setItems(res.items as ItemWithMargin[]);
		} catch (err) {
			setError(extractError(err));
		} finally {
			setLoading(false);
		}
	}, [outlet]);

	useEffect(() => {
		void load();
	}, [load]);

	function patchItem(updated: MenuItem) {
		setItems((prev) =>
			prev.map((it) =>
				it.name === (updated as MenuItem & { name: string }).name
					? { ...it, ...updated }
					: it,
			),
		);
	}

	const displayed = filterCat
		? items.filter((it) => it.category === filterCat)
		: items;

	const ALL_CAT = "__all__";

	return (
		<div className="flex flex-col gap-4" data-testid="menu-management-tab">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Select
						value={filterCat || ALL_CAT}
						onValueChange={(v) => setFilterCat(v === ALL_CAT ? "" : (v as MenuCategory))}
					>
						<SelectTrigger className="h-8 w-44 text-sm">
							<SelectValue placeholder="All categories" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_CAT}>All categories</SelectItem>
							{CATEGORIES.map((c) => (
								<SelectItem key={c} value={c}>
									{c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="text-xs text-muted-foreground tabular-nums">
						{displayed.length} item{displayed.length !== 1 ? "s" : ""}
					</span>
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={load}
						disabled={loading}
						data-testid="menu-refresh"
					>
						{loading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RefreshCw className="size-4" />
						)}
					</Button>
					<Button
						size="sm"
						onClick={() => setCreateOpen(true)}
						disabled={!outlet}
						data-testid="menu-new-item"
					>
						<Plus className="mr-1 size-4" /> New item
					</Button>
				</div>
			</div>

			{/* Content */}
			{!outlet ? (
				<Card>
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						<UtensilsCrossed className="mx-auto mb-2 size-6 opacity-40" />
						Select an outlet to manage its menu.
					</CardContent>
				</Card>
			) : error ? (
				<Card>
					<CardContent className="py-10 text-center text-sm text-destructive">
						{error}
					</CardContent>
				</Card>
			) : loading && items.length === 0 ? (
				<div className="flex justify-center py-16">
					<Loader2 className="size-7 animate-spin text-muted-foreground" />
				</div>
			) : displayed.length === 0 ? (
				<Card>
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						No items{filterCat ? ` in ${filterCat}` : ""} for this outlet.{" "}
						{!filterCat && (
							<button
								onClick={() => setCreateOpen(true)}
								className="underline underline-offset-2 hover:text-foreground"
							>
								Add the first one.
							</button>
						)}
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-2">
					{displayed.map((item) => (
						<MenuItemRow
							key={item.name}
							item={item}
							onUpdated={patchItem}
							onRefresh={load}
						/>
					))}
				</div>
			)}

			{/* Create sheet */}
			<ItemFormSheet
				open={createOpen}
				mode="create"
				initialValues={blankForm(outlet)}
				onClose={() => setCreateOpen(false)}
				onSaved={(newItem) => {
					setItems((prev) => [newItem as ItemWithMargin, ...prev]);
					setCreateOpen(false);
				}}
			/>
		</div>
	);
}
