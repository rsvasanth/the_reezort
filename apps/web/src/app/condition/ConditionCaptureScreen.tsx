import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
	AlertTriangle,
	Camera,
	CheckCircle2,
	ImagePlus,
	Loader2,
	Lock,
	Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import {
	captureRoomCondition,
	ConditionApiError,
	getRoomConditionCaptures,
	uploadConditionPhoto,
} from "@/lib/condition-api";
import type {
	CaptureStage,
	ConditionCapture,
	ConditionPhoto,
	OverallCondition,
} from "@/lib/condition-api";

// ---------- Types ----------

type LoadState = "loading" | "ready" | "error";
type SubmitState = "idle" | "uploading" | "submitting" | "done";

/** A photo the user has selected but not yet submitted — holds the local File for upload + a preview URL. */
type PendingPhoto = {
	id: string; // stable local key for React list rendering
	file: File;
	previewUrl: string;
	caption: string;
	area: string;
};

// ---------- Constants ----------

const STAGES: CaptureStage[] = ["Check-In", "Check-Out"];

const CONDITIONS: OverallCondition[] = ["Good", "Minor Issues", "Damage Noted"];

const CONDITION_BADGE: Record<OverallCondition, { label: string; className: string }> = {
	Good: { label: "Good", className: "border-success/40 bg-success text-success dark:bg-success/30 dark:text-success" },
	"Minor Issues": { label: "Minor Issues", className: "border-warning/40 bg-warning text-warning dark:bg-warning/30 dark:text-warning" },
	"Damage Noted": { label: "Damage Noted", className: "border-destructive/40 bg-destructive/10 text-destructive" },
};

// ---------- Screen ----------

type Props = {
	stay: string;
};

export default function ConditionCaptureScreen({ stay }: Props) {
	const [loadState, setLoadState] = useState<LoadState>("loading");
	const [loadError, setLoadError] = useState<string>("");
	const [captures, setCaptures] = useState<ConditionCapture[]>([]);

	// Form state
	const [stage, setStage] = useState<CaptureStage>("Check-In");
	const [overallCondition, setOverallCondition] = useState<OverallCondition>("Good");
	const [notes, setNotes] = useState<string>("");
	const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
	const [submitState, setSubmitState] = useState<SubmitState>("idle");
	const [submitError, setSubmitError] = useState<string>("");

	const fileInputRef = useRef<HTMLInputElement>(null);

	const load = useCallback(() => {
		setLoadState("loading");
		setLoadError("");
		getRoomConditionCaptures(stay)
			.then(({ captures: fetched }) => {
				setCaptures(fetched);
				// Pre-select the first stage that isn't already captured
				const capturedStages = new Set(fetched.map((c) => c.capture_stage));
				const nextStage = STAGES.find((s) => !capturedStages.has(s));
				if (nextStage) setStage(nextStage);
				setLoadState("ready");
			})
			.catch((err: unknown) => {
				const msg =
					err instanceof ConditionApiError
						? `Failed to load captures (${err.status})`
						: "Couldn't load room condition captures.";
				setLoadError(msg);
				setLoadState("error");
			});
	}, [stay]);

	useEffect(() => {
		load();
	}, [load]);

	// Clean up object URLs when photos are removed or component unmounts
	useEffect(() => {
		return () => {
			for (const p of pendingPhotos) {
				URL.revokeObjectURL(p.previewUrl);
			}
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const capturedStages = new Set(captures.map((c) => c.capture_stage));
	const stageIsReadOnly = capturedStages.has(stage);
	const canSubmit =
		!stageIsReadOnly &&
		pendingPhotos.length >= 1 &&
		submitState === "idle";

	function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
		const files = Array.from(e.target.files ?? []);
		if (files.length === 0) return;

		const next: PendingPhoto[] = files.map((file) => ({
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			file,
			previewUrl: URL.createObjectURL(file),
			caption: "",
			area: "",
		}));
		setPendingPhotos((prev) => [...prev, ...next]);
		// Reset so the same file can be re-selected if removed and re-added
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	function removePhoto(id: string) {
		setPendingPhotos((prev) => {
			const removed = prev.find((p) => p.id === id);
			if (removed) URL.revokeObjectURL(removed.previewUrl);
			return prev.filter((p) => p.id !== id);
		});
	}

	function updatePhotoField(id: string, field: "caption" | "area", value: string) {
		setPendingPhotos((prev) =>
			prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
		);
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;

		setSubmitError("");
		setSubmitState("uploading");

		let uploadedPhotos: ConditionPhoto[];
		try {
			uploadedPhotos = await Promise.all(
				pendingPhotos.map(async (pending): Promise<ConditionPhoto> => {
					const { file_url } = await uploadConditionPhoto(pending.file);
					return {
						image: file_url,
						...(pending.caption.trim() ? { caption: pending.caption.trim() } : {}),
						...(pending.area.trim() ? { area: pending.area.trim() } : {}),
					};
				})
			);
		} catch (err) {
			const msg =
				err instanceof ConditionApiError
					? `Photo upload failed (${err.status}) — check your connection.`
					: "Photo upload failed — try again.";
			setSubmitError(msg);
			setSubmitState("idle");
			toast.error("Photo upload failed", { description: msg });
			return;
		}

		setSubmitState("submitting");

		try {
			await captureRoomCondition({
				stay,
				capture_stage: stage,
				photos: uploadedPhotos,
				overall_condition: overallCondition,
				notes: notes.trim() || undefined,
			});

			// Clean up preview URLs before clearing pending photos
			for (const p of pendingPhotos) {
				URL.revokeObjectURL(p.previewUrl);
			}
			setPendingPhotos([]);
			setNotes("");
			setSubmitState("done");
			toast.success(`${stage} condition captured`, {
				description: `Room condition recorded for stage: ${stage}.`,
			});
			load(); // Refresh captures list
		} catch (err) {
			const msg =
				err instanceof ConditionApiError
					? `Capture failed (${err.status}) — ${err.message}`
					: "Capture failed — try again.";
			setSubmitError(msg);
			setSubmitState("idle");
			toast.error("Condition capture failed", { description: msg });
		}
	}

	// ---------- Render ----------

	return (
		<TooltipProvider>
			<div className="flex flex-col gap-6">
				{/* Existing captures */}
				<section className="flex flex-col gap-4">
					<div className="flex items-center justify-between">
						<h2 className="text-base font-semibold">Condition Captures</h2>
						{loadState === "ready" && (
							<Badge variant="outline" className="text-xs">
								{captures.length} capture{captures.length !== 1 ? "s" : ""}
							</Badge>
						)}
					</div>

					{loadState === "loading" && <CapturesSkeleton />}

					{loadState === "error" && (
						<Card className="border-destructive/40">
							<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
								<div className="rounded-full bg-destructive/10 p-3 text-destructive">
									<AlertTriangle className="size-5" />
								</div>
								<p className="text-sm text-muted-foreground">{loadError}</p>
								<Button size="sm" onClick={load}>
									Retry
								</Button>
							</CardContent>
						</Card>
					)}

					{loadState === "ready" && captures.length === 0 && (
						<Card>
							<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
								<div className="rounded-full bg-muted p-3">
									<Camera className="size-5 text-muted-foreground" />
								</div>
								<p className="text-sm text-muted-foreground">
									No captures yet — use the form below to record the first one.
								</p>
							</CardContent>
						</Card>
					)}

					{loadState === "ready" && captures.length > 0 && (
						<div className="grid gap-4 sm:grid-cols-2">
							{captures.map((capture) => (
								<CaptureCard key={capture.name} capture={capture} />
							))}
						</div>
					)}
				</section>

				{/* Capture form — hidden while still loading */}
				{loadState !== "loading" && (
					<section className="flex flex-col gap-4">
						<h2 className="text-base font-semibold">Add Capture</h2>

						<Card>
							<CardContent className="p-6">
								<form onSubmit={handleSubmit} className="flex flex-col gap-5">
									{/* Stage selector */}
									<FormField
										label="Stage"
										tooltip="Which point in the stay this capture covers."
									>
										<Select
											value={stage}
											onValueChange={(v) => setStage(v as CaptureStage)}
											disabled={submitState !== "idle"}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{STAGES.map((s) => (
													<SelectItem key={s} value={s} disabled={capturedStages.has(s)}>
														<span className="flex items-center gap-2">
															{s}
															{capturedStages.has(s) && (
																<Lock className="size-3 text-muted-foreground" />
															)}
														</span>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</FormField>

									{/* Read-only banner for captured stage */}
									{stageIsReadOnly && (
										<div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
											<Lock className="size-4 shrink-0" />
											<span>
												{stage} has already been captured and is read-only.
											</span>
										</div>
									)}

									{/* Condition + notes only shown when stage is not read-only */}
									{!stageIsReadOnly && (
										<>
											<FormField
												label="Overall condition"
												tooltip="Your assessment of the room's overall state."
											>
												<Select
													value={overallCondition}
													onValueChange={(v) =>
														setOverallCondition(v as OverallCondition)
													}
													disabled={submitState !== "idle"}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{CONDITIONS.map((c) => (
															<SelectItem key={c} value={c}>
																{c}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</FormField>

											<FormField
												label="Notes"
												tooltip="Optional freeform observations about room condition."
											>
												<textarea
													placeholder="Any observations, damage details, or handover notes…"
													value={notes}
													onChange={(e) => setNotes(e.target.value)}
													disabled={submitState !== "idle"}
													rows={3}
													className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
												/>
											</FormField>

											{/* Photo attachment */}
											<div className="flex flex-col gap-3">
												<div className="flex items-center justify-between">
													<Label>
														Photos{" "}
														<span className="text-xs text-muted-foreground">
															(at least 1 required)
														</span>
													</Label>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																type="button"
																size="sm"
																variant="outline"
																onClick={() => fileInputRef.current?.click()}
																disabled={submitState !== "idle"}
															>
																<ImagePlus className="mr-1.5 size-4" />
																Attach photo
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															Select one or more image files to attach
														</TooltipContent>
													</Tooltip>
												</div>

												{/* Hidden file input */}
												<input
													ref={fileInputRef}
													type="file"
													accept="image/*"
													multiple
													className="hidden"
													onChange={handleFileChange}
												/>

												{pendingPhotos.length === 0 && (
													<div className="flex items-center justify-center rounded-md border border-dashed py-8 text-sm text-muted-foreground">
														No photos attached — click "Attach photo" to add some.
													</div>
												)}

												{pendingPhotos.length > 0 && (
													<div className="flex flex-col gap-3">
														{pendingPhotos.map((photo) => (
															<PendingPhotoRow
																key={photo.id}
																photo={photo}
																disabled={submitState !== "idle"}
																onRemove={removePhoto}
																onFieldChange={updatePhotoField}
															/>
														))}
													</div>
												)}
											</div>

											{/* Error banner */}
											{submitError && (
												<div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
													<AlertTriangle className="mt-0.5 size-4 shrink-0" />
													<span>{submitError}</span>
												</div>
											)}

											{/* Success banner after submit */}
											{submitState === "done" && (
												<div className="flex items-start gap-2 rounded-md border border-success/40 bg-success px-3 py-2 text-sm text-success dark:bg-success/30 dark:text-success">
													<CheckCircle2 className="mt-0.5 size-4 shrink-0" />
													<span>Capture recorded — stage is now read-only.</span>
												</div>
											)}

											{/* Submit row */}
											<div className="flex justify-end gap-2 pt-1">
												<Tooltip>
													<TooltipTrigger asChild>
														{/* Wrap in span so Tooltip works even when button is disabled */}
														<span>
															<Button
																type="submit"
																disabled={!canSubmit}
																className="min-w-[10rem]"
															>
																{submitState === "uploading" && (
																	<>
																		<Loader2 className="mr-2 size-4 animate-spin" />
																		Uploading…
																	</>
																)}
																{submitState === "submitting" && (
																	<>
																		<Loader2 className="mr-2 size-4 animate-spin" />
																		Saving…
																	</>
																)}
																{(submitState === "idle" || submitState === "done") && (
																	<>
																		<Camera className="mr-2 size-4" />
																		Save {stage} Capture
																	</>
																)}
															</Button>
														</span>
													</TooltipTrigger>
													{pendingPhotos.length === 0 && (
														<TooltipContent>
															Attach at least one photo before saving
														</TooltipContent>
													)}
												</Tooltip>
											</div>
										</>
									)}
								</form>
							</CardContent>
						</Card>
					</section>
				)}
			</div>
		</TooltipProvider>
	);
}

// ---------- Sub-components ----------

function CaptureCard({ capture }: { capture: ConditionCapture }) {
	const condStyle = capture.overall_condition
		? CONDITION_BADGE[capture.overall_condition]
		: null;

	const capturedAt = formatDateTime(capture.captured_at);

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between gap-2">
					<CardTitle className="text-sm font-semibold">{capture.capture_stage}</CardTitle>
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge variant="outline" className="text-xs">
							<Lock className="mr-1 size-2.5" />
							Read-only
						</Badge>
						{condStyle && (
							<Badge
								variant="outline"
								className={`text-xs ${condStyle.className}`}
							>
								{condStyle.label}
							</Badge>
						)}
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					Captured by <span className="font-medium text-foreground">{capture.captured_by}</span>{" "}
					· {capturedAt}
				</p>
				{capture.notes && (
					<p className="mt-1 text-xs text-muted-foreground italic">{capture.notes}</p>
				)}
			</CardHeader>

			{capture.photos.length > 0 && (
				<CardContent className="pt-0">
					<div className="grid grid-cols-3 gap-2">
						{capture.photos.map((photo, idx) => (
							<Tooltip key={`${capture.name}-photo-${idx}`}>
								<TooltipTrigger asChild>
									<div className="relative aspect-square overflow-hidden rounded-md bg-muted">
										<img
											src={photo.image}
											alt={photo.caption ?? photo.area ?? `Photo ${idx + 1}`}
											className="h-full w-full object-cover"
										/>
									</div>
								</TooltipTrigger>
								{(photo.caption || photo.area) && (
									<TooltipContent>
										{photo.area && <span className="font-medium">{photo.area}: </span>}
										{photo.caption}
									</TooltipContent>
								)}
							</Tooltip>
						))}
					</div>
				</CardContent>
			)}
		</Card>
	);
}

type PendingPhotoRowProps = {
	photo: PendingPhoto;
	disabled: boolean;
	onRemove: (id: string) => void;
	onFieldChange: (id: string, field: "caption" | "area", value: string) => void;
};

function PendingPhotoRow({ photo, disabled, onRemove, onFieldChange }: PendingPhotoRowProps) {
	return (
		<div className="flex gap-3 rounded-md border p-3">
			<div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
				<img
					src={photo.previewUrl}
					alt={photo.caption || photo.file.name}
					className="h-full w-full object-cover"
				/>
			</div>
			<div className="flex flex-1 flex-col gap-2">
				<Input
					placeholder="Area (e.g. Bathroom, Balcony)"
					value={photo.area}
					onChange={(e) => onFieldChange(photo.id, "area", e.target.value)}
					disabled={disabled}
					className="h-7 text-xs"
				/>
				<Input
					placeholder="Caption (optional)"
					value={photo.caption}
					onChange={(e) => onFieldChange(photo.id, "caption", e.target.value)}
					disabled={disabled}
					className="h-7 text-xs"
				/>
				<p className="truncate text-xs text-muted-foreground">{photo.file.name}</p>
			</div>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
						onClick={() => onRemove(photo.id)}
						disabled={disabled}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Remove this photo</TooltipContent>
			</Tooltip>
		</div>
	);
}

function FormField({
	label,
	tooltip,
	children,
}: {
	label: string;
	tooltip?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<Label>{label}</Label>
				{tooltip && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span
								className="inline-flex size-4 cursor-default items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
								aria-label={tooltip}
							>
								?
							</span>
						</TooltipTrigger>
						<TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
					</Tooltip>
				)}
			</div>
			{children}
		</div>
	);
}

function CapturesSkeleton() {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{[0, 1].map((i) => (
				<Card key={i}>
					<CardHeader className="pb-3">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="mt-1 h-3 w-40" />
					</CardHeader>
					<CardContent className="pt-0">
						<div className="grid grid-cols-3 gap-2">
							{[0, 1, 2].map((j) => (
								<Skeleton key={j} className="aspect-square rounded-md" />
							))}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

// ---------- Utilities ----------

function formatDateTime(isoString: string): string {
	if (!isoString) return "";
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(isoString));
	} catch {
		return isoString;
	}
}
