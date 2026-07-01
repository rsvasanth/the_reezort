/**
 * Print a stay/checkout label as a PDF (A5, portrait). Includes a QR code that
 * encodes the full stay context (JSON) so it can be scanned back at any point
 * to look up the guest, folio, and financials without typing.
 *
 * Uses jsPDF + qrcode (dependency-free client-side generation — no server
 * template management, no wkhtmltopdf install).
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export type LabelContext = {
	type: "CHECKIN" | "CHECKOUT";
	folio: {
		name: string;
		total_charges: number;
		total_taxes_estimated: number;
		total_paid: number;
		outstanding_amount: number;
		currency: string;
		folio_status: string;
	};
	stay: {
		name: string | null;
		stay_status: string | null;
		current_room: string | null;
		arrival_date: string | null;
		departure_date: string | null;
	};
	reservation: {
		name: string;
		status: string;
		booking_source: string | null;
	};
	guest: {
		name: string;
		email: string | null;
		phone: string | null;
	};
	property: string;
	company: string;
	timestamp: string; // ISO
};

const RUPEE = "₹";

function money(n: number, currency: string): string {
	const symbol = currency === "INR" ? RUPEE : `${currency} `;
	return symbol + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function printStayLabel(ctx: LabelContext): Promise<void> {
	const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
	const W = doc.internal.pageSize.getWidth(); // 148mm
	const H = doc.internal.pageSize.getHeight(); // 210mm
	const PAD = 12;

	// ---------- Header band ----------
	doc.setFillColor(15, 23, 42); // slate-900
	doc.rect(0, 0, W, 22, "F");
	doc.setTextColor(255);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(16);
	doc.text("THE REEZORT", PAD, 10);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.text(ctx.company, PAD, 15);
	doc.text(ctx.property, PAD, 19);

	// Right-side title
	doc.setFont("helvetica", "bold");
	doc.setFontSize(11);
	const title = ctx.type === "CHECKIN" ? "CHECK-IN LABEL" : "CHECK-OUT LABEL";
	doc.text(title, W - PAD, 12, { align: "right" });
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.text(new Date(ctx.timestamp).toLocaleString(), W - PAD, 17, { align: "right" });

	doc.setTextColor(15, 23, 42);

	// ---------- QR code (top-right block) ----------
	const qrPayload = JSON.stringify({
		type: ctx.type,
		reservation: ctx.reservation.name,
		stay: ctx.stay.name,
		folio: ctx.folio.name,
		guest: ctx.guest.name,
		room: ctx.stay.current_room,
		arrival: ctx.stay.arrival_date,
		departure: ctx.stay.departure_date,
		outstanding: ctx.folio.outstanding_amount,
		currency: ctx.folio.currency,
	});
	const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
	const qrSize = 40;
	doc.addImage(qrDataUrl, "PNG", W - PAD - qrSize, 28, qrSize, qrSize);
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text("Scan for full record", W - PAD - qrSize / 2, 28 + qrSize + 3, { align: "center" });
	doc.setTextColor(15, 23, 42);

	// ---------- Guest block ----------
	let y = 34;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(20);
	doc.text(ctx.guest.name, PAD, y);
	y += 6;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	if (ctx.guest.email) { doc.text(ctx.guest.email, PAD, y); y += 4; }
	if (ctx.guest.phone) { doc.text(ctx.guest.phone, PAD, y); y += 4; }

	// ---------- Room / dates band ----------
	y = 82;
	doc.setDrawColor(200);
	doc.line(PAD, y, W - PAD, y);
	y += 6;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(9);
	doc.setTextColor(120);
	doc.text("ROOM", PAD, y);
	doc.text("ARRIVAL", PAD + 40, y);
	doc.text("DEPARTURE", PAD + 80, y);
	doc.setTextColor(15, 23, 42);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(13);
	y += 6;
	doc.text(ctx.stay.current_room ?? "—", PAD, y);
	doc.text(ctx.stay.arrival_date ?? "—", PAD + 40, y);
	doc.text(ctx.stay.departure_date ?? "—", PAD + 80, y);

	// ---------- IDs ----------
	y += 10;
	doc.setDrawColor(200);
	doc.line(PAD, y, W - PAD, y);
	y += 6;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.setTextColor(120);
	doc.text("Reservation", PAD, y);
	doc.setTextColor(15, 23, 42);
	doc.setFont("courier", "bold");
	doc.text(ctx.reservation.name, PAD + 22, y);

	y += 5;
	doc.setFont("helvetica", "normal");
	doc.setTextColor(120);
	doc.text("Stay", PAD, y);
	doc.setTextColor(15, 23, 42);
	doc.setFont("courier", "bold");
	doc.text(ctx.stay.name ?? "—", PAD + 22, y);

	y += 5;
	doc.setFont("helvetica", "normal");
	doc.setTextColor(120);
	doc.text("Folio", PAD, y);
	doc.setTextColor(15, 23, 42);
	doc.setFont("courier", "bold");
	doc.text(ctx.folio.name, PAD + 22, y);

	// ---------- Folio totals ----------
	y += 10;
	doc.setDrawColor(200);
	doc.line(PAD, y, W - PAD, y);
	y += 6;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(10);
	doc.text("FOLIO SUMMARY", PAD, y);
	y += 6;

	const rows: Array<[string, string]> = [
		["Charges", money(ctx.folio.total_charges, ctx.folio.currency)],
		["Taxes (est.)", money(ctx.folio.total_taxes_estimated, ctx.folio.currency)],
		["Paid", money(ctx.folio.total_paid, ctx.folio.currency)],
		["Outstanding", money(ctx.folio.outstanding_amount, ctx.folio.currency)],
	];
	doc.setFont("helvetica", "normal");
	doc.setFontSize(10);
	for (const [label, value] of rows) {
		doc.setTextColor(80);
		doc.text(label, PAD, y);
		doc.setTextColor(15, 23, 42);
		doc.setFont("helvetica", "bold");
		doc.text(value, W - PAD, y, { align: "right" });
		doc.setFont("helvetica", "normal");
		y += 6;
	}

	// Emphasize outstanding
	y += 2;
	doc.setDrawColor(180);
	doc.line(PAD, y, W - PAD, y);

	// ---------- Status band ----------
	y = H - 28;
	doc.setFillColor(ctx.type === "CHECKIN" ? 16 : 20, ctx.type === "CHECKIN" ? 185 : 184, ctx.type === "CHECKIN" ? 129 : 166); // emerald / sky
	doc.rect(0, y, W, 8, "F");
	doc.setTextColor(255);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(9);
	const stateText =
		ctx.type === "CHECKIN"
			? `CHECKED IN · ${ctx.stay.stay_status ?? "In House"}`
			: `CHECKED OUT · Folio ${ctx.folio.folio_status}`;
	doc.text(stateText, W / 2, y + 5.4, { align: "center" });

	// Footer
	doc.setTextColor(120);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(7);
	doc.text(
		`Printed ${new Date(ctx.timestamp).toLocaleString()}  ·  ${ctx.property}  ·  ${ctx.type === "CHECKIN" ? "Retain for room service" : "Retain for your records"}`,
		W / 2,
		H - 4,
		{ align: "center" }
	);

	// Save with a meaningful filename.
	const stamp = new Date(ctx.timestamp).toISOString().slice(0, 10).replace(/-/g, "");
	const filename = `${ctx.type}-${ctx.reservation.name}-${stamp}.pdf`;
	doc.save(filename);
}
