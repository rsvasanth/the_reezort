/**
 * Client-side Salary Slip PDF (spec 008, ui-ux-payroll-tab).
 *
 * A4 portrait, 40mm margins. Source of truth: staff.payroll_api.get_slip.
 * Owner constraint (2026-06-30): earnings only (no PF/ESI/PT) — deductions
 * table renders empty until we opt in later.
 */

import { jsPDF } from "jspdf";

// ---------- amount-in-words (Indian numbering) — mirrors tax-invoice.ts ----------

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

// ---------- shape ----------

export type PayslipData = {
	name: string;
	employee: string;
	employee_name: string;
	designation: string | null;
	department: string | null;
	company: string;
	start_date: string;
	end_date: string;
	posting_date: string;
	salary_structure: string;
	payment_days: number;
	total_working_days: number;
	gross_pay: number;
	total_deduction: number;
	net_pay: number;
	currency: string;
	earnings: Array<{ component: string; amount: number }>;
	deductions: Array<{ component: string; amount: number }>;
};

// ---------- render ----------

function formatINR(n: number): string {
	return new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: "INR",
		maximumFractionDigits: 2,
	}).format(n);
}

function periodLabel(startISO: string, endISO: string): string {
	const s = new Date(startISO);
	const e = new Date(endISO);
	const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
	if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
		return monthFmt.format(s);
	}
	const shortFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
	return `${shortFmt.format(s)} — ${shortFmt.format(e)}`;
}

export function buildPayslipPdf(slip: PayslipData): jsPDF {
	const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
	const pageW = 210;
	const margin = 20;
	let y = margin;

	// Header — company on the left, period on the right.
	doc.setFont("helvetica", "bold");
	doc.setFontSize(14);
	doc.text(slip.company, margin, y);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(10);
	doc.text(`Payslip · ${periodLabel(slip.start_date, slip.end_date)}`, pageW - margin, y, { align: "right" });
	y += 4;
	doc.setFontSize(8);
	doc.setTextColor(120);
	doc.text(slip.name, pageW - margin, y, { align: "right" });
	doc.setTextColor(0);
	y += 5;
	doc.setDrawColor(150);
	doc.line(margin, y, pageW - margin, y);
	y += 8;

	// Employee block
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text(slip.employee_name, margin, y);
	y += 5;
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	const meta = [
		`Employee: ${slip.employee}`,
		slip.designation ? `Designation: ${slip.designation}` : null,
		slip.department ? `Department: ${slip.department}` : null,
		`Structure: ${slip.salary_structure}`,
		`Payment days: ${slip.payment_days} / ${slip.total_working_days}`,
	].filter(Boolean) as string[];
	for (const line of meta) {
		doc.text(line, margin, y);
		y += 4.5;
	}

	y += 4;

	// Earnings + Deductions tables side-by-side
	const colW = (pageW - margin * 2 - 8) / 2;
	const colL = margin;
	const colR = margin + colW + 8;

	function renderColumn(x: number, title: string, rows: Array<{ component: string; amount: number }>, total: number) {
		let cy = y;
		doc.setFont("helvetica", "bold");
		doc.setFontSize(10);
		doc.text(title, x, cy);
		cy += 2;
		doc.setDrawColor(180);
		doc.line(x, cy, x + colW, cy);
		cy += 4;
		doc.setFont("helvetica", "normal");
		doc.setFontSize(9);
		if (rows.length === 0) {
			doc.setTextColor(140);
			doc.text("None", x, cy);
			doc.setTextColor(0);
			cy += 5;
		} else {
			for (const r of rows) {
				doc.text(r.component, x, cy);
				doc.text(formatINR(r.amount), x + colW, cy, { align: "right" });
				cy += 4.5;
			}
		}
		cy += 1;
		doc.setDrawColor(200);
		doc.line(x, cy, x + colW, cy);
		cy += 4;
		doc.setFont("helvetica", "bold");
		doc.text("Total", x, cy);
		doc.text(formatINR(total), x + colW, cy, { align: "right" });
		return cy;
	}

	const earnEnd = renderColumn(colL, "Earnings", slip.earnings, slip.gross_pay);
	const deductEnd = renderColumn(colR, "Deductions", slip.deductions, slip.total_deduction);
	y = Math.max(earnEnd, deductEnd) + 10;

	// Net pay block
	doc.setDrawColor(80);
	doc.setLineWidth(0.4);
	doc.rect(margin, y, pageW - margin * 2, 18);
	doc.setLineWidth(0.2);
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("Net pay", margin + 5, y + 7);
	doc.setFontSize(14);
	doc.text(formatINR(slip.net_pay), pageW - margin - 5, y + 7, { align: "right" });
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	const words = numberToWordsIndian(slip.net_pay);
	doc.text(`Amount in words: ${words}`, margin + 5, y + 14);
	y += 26;

	// Footer
	const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
	doc.setFontSize(8);
	doc.setTextColor(140);
	doc.text(`Generated by THE REEZORT · ${stamp}`, margin, 285);
	doc.setTextColor(0);

	return doc;
}

export function downloadPayslipPdf(slip: PayslipData) {
	const doc = buildPayslipPdf(slip);
	const period = periodLabel(slip.start_date, slip.end_date).replace(/[^\w]+/g, "-");
	const emp = slip.employee_name.replace(/[^\w]+/g, "-");
	doc.save(`Payslip_${emp}_${period}.pdf`);
}
