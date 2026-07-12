import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { uploadImage } from "@/lib/setup-api";

/**
 * Photo upload + preview for a property/room/room-type `image` field.
 * Uploads the chosen file to Frappe's File store, then hands the resulting
 * file_url back to the parent (which persists it via update_record). The
 * property console had no way to set these images before — the field existed
 * and rendered, but was desk-only to populate.
 */
export function PhotoField({
	image,
	label,
	onUploaded,
	className,
}: {
	image: string | null | undefined;
	label: string;
	onUploaded: (fileUrl: string) => Promise<void> | void;
	className?: string;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleFile(file: File | undefined) {
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			toast.error("Not an image", { description: "Pick a JPG, PNG, or WebP file." });
			return;
		}
		setBusy(true);
		try {
			const fileUrl = await uploadImage(file);
			await onUploaded(fileUrl);
			toast.success("Photo updated", { description: label });
		} catch (error) {
			toast.error("Could not upload photo", { description: String(error) });
		} finally {
			setBusy(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	return (
		<div className={className}>
			<div className="flex items-start gap-3">
				<div className="h-20 w-28 shrink-0 overflow-hidden rounded-md border bg-muted">
					{image ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={image} alt={label} className="h-full w-full object-cover" />
					) : (
						<div className="flex h-full w-full items-center justify-center text-muted-foreground">
							<ImagePlus className="size-5" />
						</div>
					)}
				</div>
				<div className="flex flex-col gap-1.5">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => inputRef.current?.click()}
						data-testid="upload-photo"
					>
						{busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
						{image ? "Change photo" : "Upload photo"}
					</Button>
					<span className="text-xs text-muted-foreground">JPG / PNG / WebP</span>
				</div>
			</div>
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(e) => handleFile(e.target.files?.[0])}
			/>
		</div>
	);
}
