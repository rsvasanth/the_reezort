/**
 * Farewell slip — compact A6 portrait PDF handed to the guest at reception on
 * departure. Not a legal document (the Tax Invoice is separate). This is the
 * "thank you" receipt: guest name, room, stay dates, total paid, invoice ref,
 * QR to leave a review or plan the next stay.
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export type FarewellContext = {
	folio: { name: string; currency: string; total_charges: number; total_paid: number };
	invoice: { name: string; grand_total: number; posting_date: string } | null;
	guest: { name: string; email: string | null; phone: string | null };
	stay: { current_room: string | null; arrival_date: string | null; departure_date: string | null; nights: number | null };
	property: string;
	company: string;
	reviewUrl?: string; // where to send the guest — defaults to prod domain
	timestamp: string;
};

function money(n: number, currency = "INR"): string {
	const symbol = currency === "INR" ? "₹" : `${currency} `;
	return symbol + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null): string {
	if (!iso) return "—";
	try {
		return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
	} catch {
		return iso;
	}
}

export async function printFarewellSlip(ctx: FarewellContext): Promise<void> {
	// A6 portrait — 105 × 148 mm — common receipt/postcard size, folds neatly.
	const doc = new jsPDF({ unit: "mm", format: "a6", orientation: "portrait" });
	const W = doc.internal.pageSize.getWidth(); // 105
	const H = doc.internal.pageSize.getHeight(); // 148
	const M = 8;

	// ---------- header brand strip ----------
	doc.setFillColor(41, 38, 34); // warm ink
	doc.rect(0, 0, W, 16, "F");
	doc.setTextColor(255);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(12);
	doc.text("THE REEZORT", W / 2, 8, { align: "center" });
	doc.setFont("helvetica", "normal");
	doc.setFontSize(7);
	doc.text(ctx.property, W / 2, 12.5, { align: "center" });

	doc.setTextColor(41, 38, 34);

	// ---------- thank-you note ----------
	let y = 24;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.setTextColor(120);
	doc.text("Thank you for staying with us", W / 2, y, { align: "center" });

	y += 8;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(16);
	doc.setTextColor(41, 38, 34);
	// Wrap long names.
	const nameLines = doc.splitTextToSize(ctx.guest.name, W - 2 * M);
	doc.text(nameLines, W / 2, y, { align: "center" });
	y += nameLines.length * 6;

	// ---------- stay summary ----------
	y += 4;
	doc.setDrawColor(210);
	doc.line(M, y, W - M, y);
	y += 6;

	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.setTextColor(120);
	doc.text("ROOM", M, y);
	doc.text("STAY", M + 40, y);
	doc.text("NIGHTS", W - M - 15, y);
	y += 5;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(10);
	doc.setTextColor(41, 38, 34);
	doc.text(ctx.stay.current_room ?? "—", M, y);
	doc.text(`${fmtDate(ctx.stay.arrival_date)} → ${fmtDate(ctx.stay.departure_date)}`, M + 40, y);
	doc.text(String(ctx.stay.nights ?? "—"), W - M, y, { align: "right" });

	// ---------- payment confirmation ----------
	y += 10;
	doc.setDrawColor(210);
	doc.line(M, y, W - M, y);
	y += 6;

	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.setTextColor(120);
	doc.text("TOTAL PAID", M, y);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(14);
	doc.setTextColor(16, 185, 129); // emerald-500
	doc.text(money(ctx.invoice?.grand_total ?? ctx.folio.total_paid, ctx.folio.currency), W - M, y, { align: "right" });

	y += 6;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(7);
	doc.setTextColor(120);
	if (ctx.invoice) {
		doc.text(`Invoice ${ctx.invoice.name} · ${ctx.invoice.posting_date}`, M, y);
	} else {
		doc.text(`Folio ${ctx.folio.name}`, M, y);
	}

	// ---------- QR code (bottom-center) ----------
	y += 10;
	const qrPayload = JSON.stringify({
		type: "FAREWELL",
		folio: ctx.folio.name,
		invoice: ctx.invoice?.name ?? null,
		guest: ctx.guest.name,
		room: ctx.stay.current_room,
		total: ctx.invoice?.grand_total ?? ctx.folio.total_paid,
		review_url: ctx.reviewUrl ?? "https://app.thereezort.com/review",
	});
	try {
		const qr = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, scale: 5 });
		const qrSize = 32;
		doc.addImage(qr, "PNG", (W - qrSize) / 2, y, qrSize, qrSize);
		y += qrSize + 3;
		doc.setFont("helvetica", "normal");
		doc.setFontSize(7);
		doc.setTextColor(120);
		doc.text("Scan to leave a review or plan your next stay", W / 2, y, { align: "center" });
	} catch {
		/* non-fatal */
	}

	// ---------- Farewell footer ----------
	doc.setFillColor(251, 249, 245);
	doc.rect(0, H - 22, W, 22, "F");

	doc.setFont("helvetica", "italic");
	doc.setFontSize(9);
	doc.setTextColor(41, 38, 34);
	doc.text("Safe travels — we can’t wait to welcome you back.", W / 2, H - 15, { align: "center" });

	doc.setFont("helvetica", "normal");
	doc.setFontSize(7);
	doc.setTextColor(80);
	doc.text("app.thereezort.com  ·  hello@thereezort.com", W / 2, H - 9, { align: "center" });
	doc.setFontSize(6);
	doc.setTextColor(140);
	doc.text(
		`${ctx.company}  ·  ${new Date(ctx.timestamp).toLocaleString()}`,
		W / 2,
		H - 4,
		{ align: "center" },
	);

	const stamp = new Date(ctx.timestamp).toISOString().slice(0, 10).replace(/-/g, "");
	doc.save(`FAREWELL-${ctx.folio.name}-${stamp}.pdf`);
}
