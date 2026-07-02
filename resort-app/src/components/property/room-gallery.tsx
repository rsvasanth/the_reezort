/**
 * RoomGallery — compact tile strip with lightbox. Absolute-height flex
 * layout (no CSS-grid + aspect games) so the container is literally
 * pinned at 320px tall on desktop. Never grows with the source image.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, ImageIcon, Maximize2, X } from "lucide-react";

import { staggerContainer, staggerItem, EASE_OUT } from "@/lib/motion";
import type { GalleryItem } from "@/lib/timeline-api";

type Props = {
	items: GalleryItem[];
	roomLabel?: string;
};

export function RoomGallery({ items, roomLabel = "Villa" }: Props) {
	const [lightboxAt, setLightboxAt] = useState<number | null>(null);

	const hero = items[0];
	const side = items.slice(1, 4);
	const extraCount = Math.max(0, items.length - 4);

	if (!hero) {
		return (
			<div className="flex h-40 w-full items-center justify-center rounded-lg border bg-muted/40 text-sm text-muted-foreground">
				<ImageIcon className="mr-2 size-4" /> No renders yet — seed villa images to populate.
			</div>
		);
	}

	function openAt(index: number) { setLightboxAt(index); }

	return (
		<>
			{/* Desktop: 1 hero (2/3 width) + 3 stacked tiles (1/3 width), h-80.
			    Mobile: stacked hero on top + 2x2 grid below, both height-capped. */}
			<motion.div
				className="flex flex-col gap-2 md:h-80 md:flex-row"
				variants={staggerContainer}
				initial="hidden"
				animate="show"
				data-testid="room-gallery"
			>
				{/* Hero */}
				<motion.button
					variants={staggerItem}
					onClick={() => openAt(0)}
					className="group relative h-48 overflow-hidden rounded-lg border md:h-full md:flex-[2]"
					aria-label={`Open ${hero.caption} in gallery`}
					data-testid="hero-tile"
				>
					<img
						src={hero.image}
						alt={hero.caption}
						className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					/>
					<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
					<div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
						<Maximize2 className="size-3" />
						{hero.caption}
					</div>
				</motion.button>

				{/* Side tiles */}
				<div className="grid grid-cols-2 gap-2 md:flex md:h-full md:flex-1 md:flex-col">
					{side.map((g, i) => {
						const isLast = i === side.length - 1 && extraCount > 0;
						return (
							<motion.button
								key={g.image}
								variants={staggerItem}
								onClick={() => openAt(i + 1)}
								className="group relative h-28 overflow-hidden rounded-lg border md:h-0 md:flex-1"
								aria-label={`Open ${g.caption}`}
								data-testid={`tile-${i + 1}`}
							>
								<img
									src={g.image}
									alt={g.caption}
									className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
								/>
								<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
								{isLast ? (
									<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
										+{extraCount} more
									</div>
								) : null}
							</motion.button>
						);
					})}
					{Array.from({ length: Math.max(0, 3 - side.length) }).map((_, i) => (
						<div
							key={`blank-${i}`}
							className="hidden h-28 rounded-lg border border-dashed bg-muted/40 md:block md:h-0 md:flex-1"
							aria-hidden
						/>
					))}
				</div>
			</motion.div>

			<AnimatePresence>
				{lightboxAt !== null ? (
					<Lightbox
						items={items}
						index={lightboxAt}
						onIndex={(i) => setLightboxAt(i)}
						onClose={() => setLightboxAt(null)}
						roomLabel={roomLabel}
					/>
				) : null}
			</AnimatePresence>
		</>
	);
}

function Lightbox({
	items,
	index,
	onIndex,
	onClose,
	roomLabel,
}: {
	items: GalleryItem[];
	index: number;
	onIndex: (i: number) => void;
	onClose: () => void;
	roomLabel: string;
}) {
	const item = items[index];

	const go = useCallback(
		(delta: number) => onIndex((index + delta + items.length) % items.length),
		[index, items.length, onIndex],
	);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowRight") go(1);
			else if (e.key === "ArrowLeft") go(-1);
		}
		window.addEventListener("keydown", onKey);
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = "";
		};
	}, [go, onClose]);

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.2 }}
			className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm"
			data-testid="lightbox"
			onClick={onClose}
		>
			<div className="flex items-center justify-between px-4 py-3 text-white">
				<div className="text-sm font-medium">
					{roomLabel} · {item.caption}
					<span className="ml-2 text-xs text-white/60">{index + 1} / {items.length}</span>
				</div>
				<button
					type="button"
					className="rounded-full p-1.5 transition-colors hover:bg-white/10"
					aria-label="Close gallery"
					onClick={(e) => { e.stopPropagation(); onClose(); }}
					data-testid="lightbox-close"
				>
					<X className="size-5" />
				</button>
			</div>

			<div
				className="relative flex flex-1 items-center justify-center px-4 pb-4"
				onClick={(e) => e.stopPropagation()}
			>
				<AnimatePresence mode="wait">
					<motion.img
						key={item.image}
						src={item.image}
						alt={item.caption}
						className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
						initial={{ opacity: 0, scale: 0.98 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.28, ease: EASE_OUT }}
					/>
				</AnimatePresence>

				{items.length > 1 ? (
					<>
						<button
							type="button"
							className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
							aria-label="Previous image"
							onClick={() => go(-1)}
						>
							<ChevronLeft className="size-5" />
						</button>
						<button
							type="button"
							className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
							aria-label="Next image"
							onClick={() => go(1)}
						>
							<ChevronRight className="size-5" />
						</button>
					</>
				) : null}
			</div>

			{items.length > 1 ? (
				<div className="flex items-center justify-center gap-2 pb-4">
					{items.map((_, i) => (
						<button
							type="button"
							key={i}
							aria-label={`Image ${i + 1}`}
							className={`h-1.5 rounded-full bg-white/40 transition-all hover:bg-white/70 ${
								i === index ? "w-6 bg-white" : "w-1.5"
							}`}
							onClick={() => onIndex(i)}
						/>
					))}
				</div>
			) : null}
		</motion.div>
	);
}
