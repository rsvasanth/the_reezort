/**
 * GST-compliant Tax Invoice PDF for the guest at checkout.
 *
 * Renders an A4 portrait invoice with property GSTIN, itemised charges,
 * CGST/SGST breakdown (assumes intra-state 9%+9% on the 18% total), amount in
 * words (Indian numbering), payment received, and a QR verifier.
 *
 * Source of truth: billing.api.get_invoice_bundle (folio + Sales Invoice +
 * Payment Entries + guest profile + company GSTIN). No writes.
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

import type { FolioApiEnvelope } from "@/lib/folio-api";

// ---------- types mirroring the backend bundle ----------

export type InvoiceBundle = {
	folio: {
		name: string;
		resort_property: string;
		company: string;
		stay?: string | null;
		reservation?: string | null;
		customer: string;
		currency: string;
		folio_status: string;
		arrival_date?: string | null;
		departure_date?: string | null;
		current_room?: string | null;
	};
	totals: {
		total_charges: number;
		total_discounts: number;
		total_taxes_estimated: number;
		total_paid: number;
		outstanding_amount: number;
	};
	guest_profile?: {
		name: string;
		guest_full_name: string;
		email: string | null;
		phone: string | null;
		nationality: string | null;
		address: string | null;
		id_type: string | null;
		id_number: string | null;
	} | null;
	stay?: {
		name: string;
		stay_status: string;
		current_room: string | null;
		arrival_date: string;
		departure_date: string;
		adult_count: number | null;
		child_count: number | null;
	} | null;
	invoices: Array<{
		name: string;
		posting_date: string;
		net_total: number;
		total_taxes_and_charges: number;
		grand_total: number;
		rounded_total: number;
		total_advance: number;
		outstanding_amount: number;
		place_of_supply: string | null;
		currency: string;
		customer: string;
		customer_name: string;
		items: Array<{ item_code: string; item_name: string; description: string; qty: number; rate: number; amount: number; hsn_code: string | null }>;
		taxes: Array<{ description: string; rate: number; tax_amount: number }>;
	}>;
	payments: Array<{ name: string; posting_date: string; mode_of_payment: string; paid_amount: number; reference_no: string | null }>;
	company: { name: string; abbr: string; country: string; phone_no: string | null; email: string | null } | null;
	company_gstin: string | null;
	resort_property: string;
};

// ---------- transport ----------

export async function fetchInvoiceBundle(folioName: string): Promise<InvoiceBundle> {
	const response = await fetch(
		`/api/method/the_reezort.billing.api.get_invoice_bundle?guest_folio=${encodeURIComponent(folioName)}`,
		{ credentials: "include", headers: { Accept: "application/json" } },
	);
	if (!response.ok) throw new Error(`Invoice bundle fetch failed (${response.status})`);
	const raw = await response.json();
	const envelope = (raw?.message ?? raw) as FolioApiEnvelope<InvoiceBundle>;
	if (!envelope?.data) throw new Error("Invoice bundle returned empty");
	return envelope.data;
}

// ---------- helpers ----------

function money(n: number, currency = "INR"): string {
	const symbol = currency === "INR" ? "₹" : `${currency} `;
	return symbol + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Indian-numbering number-to-words for INR grand total. */
function numberToWordsIndian(num: number): string {
	if (!Number.isFinite(num) || num < 0) return "";
	const rupees = Math.floor(num);
	const paise = Math.round((num - rupees) * 100);

	const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
	const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

	function twoDigit(n: number): string {
		if (n < 20) return ones[n];
		const t = Math.floor(n / 10);
		const u = n % 10;
		return u === 0 ? tens[t] : `${tens[t]} ${ones[u]}`;
	}
	function threeDigit(n: number): string {
		const h = Math.floor(n / 100);
		const rest = n % 100;
		if (h === 0) return twoDigit(rest);
		if (rest === 0) return `${ones[h]} Hundred`;
		return `${ones[h]} Hundred ${twoDigit(rest)}`;
	}
	function convert(n: number): string {
		if (n === 0) return "Zero";
		const crore = Math.floor(n / 10000000);
		let rem = n % 10000000;
		const lakh = Math.floor(rem / 100000);
		rem = rem % 100000;
		const thousand = Math.floor(rem / 1000);
		rem = rem % 1000;
		const hundred = rem;
		const parts: string[] = [];
		if (crore) parts.push(`${threeDigit(crore)} Crore`);
		if (lakh) parts.push(`${threeDigit(lakh)} Lakh`);
		if (thousand) parts.push(`${threeDigit(thousand)} Thousand`);
		if (hundred) parts.push(threeDigit(hundred));
		return parts.join(" ");
	}

	const rupeesText = `${convert(rupees)} Rupees`;
	if (paise > 0) return `${rupeesText} and ${convert(paise)} Paise Only`;
	return `${rupeesText} Only`;
}

function safe(s: string | null | undefined, fallback = "—"): string {
	return s && s.trim() ? s : fallback;
}

/** Split a total tax figure into 9% CGST + 9% SGST (intra-state 18% default). */
function splitCgstSgst(taxes: Array<{ description: string; rate: number; tax_amount: number }>): { cgst: number; sgst: number; igst: number; other: number } {
	let cgst = 0;
	let sgst = 0;
	let igst = 0;
	let other = 0;
	for (const t of taxes) {
		const d = (t.description ?? "").toLowerCase();
		if (d.includes("cgst")) cgst += t.tax_amount;
		else if (d.includes("sgst")) sgst += t.tax_amount;
		else if (d.includes("igst")) igst += t.tax_amount;
		else other += t.tax_amount;
	}
	// If no split available but a total exists, assume even 9%+9%.
	if (cgst === 0 && sgst === 0 && igst === 0 && other > 0) {
		cgst = other / 2;
		sgst = other / 2;
		other = 0;
	}
	return { cgst, sgst, igst, other };
}

// ---------- render ----------

export async function printGuestTaxInvoice(bundle: InvoiceBundle): Promise<void> {
	const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
	const W = doc.internal.pageSize.getWidth(); // 210
	const H = doc.internal.pageSize.getHeight(); // 297
	const M = 12; // margin
	let y = M;

	// ---------- Title band ----------
	doc.setFillColor(15, 23, 42);
	doc.rect(0, 0, W, 24, "F");
	doc.setTextColor(255);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(18);
	doc.text("THE REEZORT", M, 12);
	doc.setFontSize(9);
	doc.setFont("helvetica", "normal");
	doc.text(bundle.company?.name ?? bundle.folio.company, M, 17);
	doc.text(`GSTIN: ${bundle.company_gstin ?? "—"}`, M, 21);

	doc.setFont("helvetica", "bold");
	doc.setFontSize(14);
	doc.text("TAX INVOICE", W - M, 12, { align: "right" });
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.text("Original for Recipient", W - M, 17, { align: "right" });
	doc.text(new Date().toLocaleString(), W - M, 21, { align: "right" });

	doc.setTextColor(15, 23, 42);
	y = 32;

	// ---------- Invoice metadata ----------
	const inv = bundle.invoices[0]; // primary invoice for this stay
	const invNum = inv?.name ?? "—";
	const invDate = inv?.posting_date ?? new Date().toISOString().slice(0, 10);

	doc.setFont("helvetica", "bold");
	doc.setFontSize(10);
	doc.text("Invoice No.", M, y);
	doc.text("Invoice Date", M + 70, y);
	doc.text("Place of Supply", M + 130, y);
	doc.setFont("courier", "normal");
	doc.setFontSize(10);
	doc.text(invNum, M, y + 5);
	doc.setFont("helvetica", "normal");
	doc.text(invDate, M + 70, y + 5);
	doc.text(inv?.place_of_supply ?? "—", M + 130, y + 5);
	y += 12;

	// ---------- Bill To ----------
	doc.setDrawColor(210);
	doc.setLineWidth(0.2);
	doc.line(M, y, W - M, y);
	y += 5;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(10);
	doc.text("BILL TO", M, y);
	doc.text("STAY", M + 100, y);
	y += 5;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(11);
	doc.text(bundle.guest_profile?.guest_full_name ?? bundle.folio.customer, M, y);

	doc.text(`Room ${safe(bundle.stay?.current_room)}`, M + 100, y);
	y += 5;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	if (bundle.guest_profile?.address) {
		const addr = doc.splitTextToSize(bundle.guest_profile.address, 90);
		doc.text(addr, M, y);
		y += addr.length * 4;
	}
	if (bundle.guest_profile?.email) { doc.text(bundle.guest_profile.email, M, y); y += 4; }
	if (bundle.guest_profile?.phone) { doc.text(bundle.guest_profile.phone, M, y); y += 4; }

	// Stay column details
	let sy = 47;
	sy += 5; // arrival
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.text(`Arrival: ${safe(bundle.stay?.arrival_date ?? bundle.folio.arrival_date)}`, M + 100, sy);
	sy += 4;
	doc.text(`Departure: ${safe(bundle.stay?.departure_date ?? bundle.folio.departure_date)}`, M + 100, sy);
	sy += 4;
	doc.text(`Reservation: ${safe(bundle.folio.reservation)}`, M + 100, sy);
	sy += 4;
	doc.text(`Folio: ${bundle.folio.name}`, M + 100, sy);

	y = Math.max(y, sy) + 8;

	// ---------- Line items table ----------
	doc.setFillColor(240, 240, 245);
	doc.rect(M, y, W - 2 * M, 7, "F");
	doc.setFont("helvetica", "bold");
	doc.setFontSize(9);
	doc.setTextColor(30);
	doc.text("DESCRIPTION", M + 2, y + 5);
	doc.text("HSN", M + 100, y + 5);
	doc.text("QTY", M + 120, y + 5, { align: "right" });
	doc.text("RATE", M + 145, y + 5, { align: "right" });
	doc.text("AMOUNT", W - M - 2, y + 5, { align: "right" });
	y += 9;

	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	const items = inv?.items ?? [];
	if (items.length === 0) {
		doc.setTextColor(120);
		doc.text("No invoiced items yet.", M + 2, y + 4);
		y += 10;
	} else {
		for (const item of items) {
			const desc = doc.splitTextToSize(item.item_name || item.description || item.item_code, 85);
			doc.setTextColor(30);
			doc.text(desc, M + 2, y);
			doc.text(item.hsn_code ?? "—", M + 100, y);
			doc.text(String(item.qty), M + 120, y, { align: "right" });
			doc.text(money(item.rate, inv?.currency), M + 145, y, { align: "right" });
			doc.setFont("helvetica", "bold");
			doc.text(money(item.amount, inv?.currency), W - M - 2, y, { align: "right" });
			doc.setFont("helvetica", "normal");
			y += Math.max(desc.length * 4, 6);
		}
	}

	// ---------- Totals block ----------
	y += 3;
	doc.setDrawColor(210);
	doc.line(M, y, W - M, y);
	y += 6;

	const tax = splitCgstSgst(inv?.taxes ?? []);
	const netTotal = inv?.net_total ?? bundle.totals.total_charges;
	const grandTotal = inv?.rounded_total ?? inv?.grand_total ?? bundle.totals.total_charges + bundle.totals.total_taxes_estimated;
	const advance = inv?.total_advance ?? 0;

	function statLine(label: string, value: string, bold = false, color: [number, number, number] = [30, 30, 30]) {
		doc.setTextColor(...color);
		doc.setFont("helvetica", bold ? "bold" : "normal");
		doc.setFontSize(bold ? 11 : 9);
		doc.text(label, M + 90, y);
		doc.text(value, W - M - 2, y, { align: "right" });
		y += bold ? 7 : 5;
	}

	statLine("Sub-total", money(netTotal, inv?.currency));
	if (tax.cgst > 0) statLine("CGST @ 9%", money(tax.cgst, inv?.currency));
	if (tax.sgst > 0) statLine("SGST @ 9%", money(tax.sgst, inv?.currency));
	if (tax.igst > 0) statLine("IGST @ 18%", money(tax.igst, inv?.currency));
	if (tax.other > 0) statLine("Other taxes", money(tax.other, inv?.currency));

	doc.setDrawColor(180);
	doc.line(M + 90, y - 1, W - M, y - 1);
	statLine("GRAND TOTAL", money(grandTotal, inv?.currency), true, [15, 23, 42]);

	if (advance > 0) statLine("Less: Advance applied", `− ${money(advance, inv?.currency)}`, false, [80, 80, 80]);
	statLine("Net Payable", money(Math.max(grandTotal - advance, 0), inv?.currency), true, [15, 23, 42]);

	// ---------- Amount in words ----------
	y += 3;
	doc.setFillColor(248, 250, 252);
	doc.rect(M, y, W - 2 * M, 10, "F");
	doc.setFont("helvetica", "bold");
	doc.setFontSize(8);
	doc.setTextColor(80);
	doc.text("AMOUNT IN WORDS", M + 2, y + 4);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.setTextColor(30);
	const words = numberToWordsIndian(grandTotal);
	doc.text(doc.splitTextToSize(words, W - 2 * M - 4), M + 2, y + 8);
	y += 14;

	// ---------- Payments received ----------
	if (bundle.payments.length > 0) {
		doc.setFont("helvetica", "bold");
		doc.setFontSize(10);
		doc.text("PAYMENT RECEIVED", M, y);
		y += 5;
		doc.setFont("helvetica", "normal");
		doc.setFontSize(9);
		for (const p of bundle.payments) {
			doc.text(`${p.posting_date} · ${p.mode_of_payment} · ${p.name}${p.reference_no ? ` · Ref ${p.reference_no}` : ""}`, M, y);
			doc.setFont("helvetica", "bold");
			doc.text(money(p.paid_amount, bundle.folio.currency), W - M, y, { align: "right" });
			doc.setFont("helvetica", "normal");
			y += 4.5;
		}
		y += 3;
	}

	// ---------- QR verifier ----------
	const qrPayload = JSON.stringify({
		type: "INVOICE",
		invoice: invNum,
		folio: bundle.folio.name,
		grand_total: grandTotal,
		date: invDate,
		guest: bundle.guest_profile?.guest_full_name ?? bundle.folio.customer,
	});
	try {
		const qr = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, scale: 5 });
		doc.addImage(qr, "PNG", W - M - 26, H - M - 38, 26, 26);
		doc.setFontSize(7);
		doc.setTextColor(120);
		doc.text("Scan to verify", W - M - 13, H - M - 9, { align: "center" });
	} catch { /* QR failure is non-fatal */ }

	// ---------- Signature + footer ----------
	doc.setTextColor(120);
	doc.setFontSize(9);
	doc.text("For THE REEZORT", M, H - M - 30);
	doc.setDrawColor(120);
	doc.line(M, H - M - 15, M + 60, H - M - 15);
	doc.text("Authorised Signatory", M, H - M - 10);

	doc.setFontSize(7);
	doc.setTextColor(140);
	doc.text("This is a computer-generated invoice. Thank you for staying with us.", W / 2, H - 5, { align: "center" });

	const filename = `TAX-INVOICE-${invNum}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
	doc.save(filename);
}
