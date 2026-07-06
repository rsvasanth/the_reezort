import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Lightweight canvas signature pad. Emits a PNG data-URL on each stroke end via
 * onChange, and an empty string when cleared. No external dependency.
 */
export function SignaturePad({
	value,
	onChange,
	disabled,
}: {
	value: string | null;
	onChange: (dataUrl: string) => void;
	disabled?: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const drawing = useRef(false);
	const [hasInk, setHasInk] = useState<boolean>(Boolean(value));

	// Paint an existing signature (e.g. re-entering a signed card) once on mount.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !value) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const img = new Image();
		img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		img.src = value;
		setHasInk(true);
		// Only on first paint — strokes after this are user-driven.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
		const rect = e.currentTarget.getBoundingClientRect();
		return [e.clientX - rect.left, e.clientY - rect.top];
	}

	function start(e: React.PointerEvent<HTMLCanvasElement>) {
		if (disabled) return;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		drawing.current = true;
		const [x, y] = point(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function move(e: React.PointerEvent<HTMLCanvasElement>) {
		if (!drawing.current || disabled) return;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		const [x, y] = point(e);
		ctx.lineTo(x, y);
		ctx.strokeStyle = "#292622";
		ctx.lineWidth = 2;
		ctx.lineCap = "round";
		ctx.stroke();
		setHasInk(true);
	}

	function end() {
		if (!drawing.current) return;
		drawing.current = false;
		const canvas = canvasRef.current;
		if (canvas) onChange(canvas.toDataURL("image/png"));
	}

	function clear() {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
		setHasInk(false);
		onChange("");
	}

	return (
		<div className="flex flex-col gap-2">
			<canvas
				ref={canvasRef}
				width={460}
				height={150}
				onPointerDown={start}
				onPointerMove={move}
				onPointerUp={end}
				onPointerLeave={end}
				className="w-full max-w-[460px] touch-none rounded-md border border-input bg-background"
				aria-label="Guest signature pad"
			/>
			<div className="flex items-center gap-3">
				<Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled || !hasInk}>
					Clear
				</Button>
				<span className="text-xs text-muted-foreground">
					{hasInk ? "Signed" : "Sign above with mouse or finger"}
				</span>
			</div>
		</div>
	);
}
