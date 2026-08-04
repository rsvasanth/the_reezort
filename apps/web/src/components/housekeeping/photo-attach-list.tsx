/**
 * PhotoAttachList — camera/upload control for housekeeping room photos.
 *
 * Uploads each file immediately via /api/method/upload_file (public, same as
 * room-condition photos) and reports the accumulated list of TaskPhoto rows
 * to the parent. Used by the complete-task and inspection sheets.
 */

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadConditionPhoto } from "@/lib/condition-api";
import type { TaskPhoto } from "@/lib/housekeeping-api";

export function PhotoAttachList({
	photos,
	onChange,
	label = "Add photo",
	disabled = false,
}: {
	photos: TaskPhoto[];
	onChange: (next: TaskPhoto[]) => void;
	label?: string;
	disabled?: boolean;
}) {
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [uploading, setUploading] = useState(false);

	async function onFiles(files: File[]) {
		if (files.length === 0) return;
		setUploading(true);
		try {
			const uploaded = await Promise.all(
				files.map(async (file): Promise<TaskPhoto> => {
					const up = await uploadConditionPhoto(file);
					return { image: up.file_url, caption: "" };
				})
			);
			onChange([...photos, ...uploaded]);
		} catch (error) {
			toast.error("Photo upload failed", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setUploading(false);
		}
	}

	function setCaption(index: number, caption: string) {
		onChange(photos.map((p, i) => (i === index ? { ...p, caption } : p)));
	}

	function remove(index: number) {
		onChange(photos.filter((_, i) => i !== index));
	}

	return (
		<div className="flex flex-col gap-2">
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				capture="environment"
				multiple
				className="hidden"
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					void onFiles(files);
				}}
			/>
			{photos.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{photos.map((photo, index) => (
						<li key={photo.image} className="flex items-center gap-2 rounded-md border p-2">
							<a href={photo.image} target="_blank" rel="noreferrer" className="shrink-0">
								<img
									src={photo.image}
									alt={photo.caption || `Photo ${index + 1}`}
									className="size-14 rounded object-cover"
								/>
							</a>
							<Input
								value={photo.caption ?? ""}
								onChange={(e) => setCaption(index, e.target.value)}
								placeholder="Caption (e.g. Bed & linen)"
								className="h-8 text-xs"
								disabled={disabled}
							/>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="size-7 shrink-0"
								disabled={disabled}
								onClick={() => remove(index)}
								aria-label="Remove photo"
							>
								<X className="size-3.5" />
							</Button>
						</li>
					))}
				</ul>
			) : null}
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="w-fit"
				disabled={disabled || uploading}
				onClick={() => fileRef.current?.click()}
				data-testid="photo-attach-add"
			>
				{uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
				{label}
			</Button>
		</div>
	);
}
