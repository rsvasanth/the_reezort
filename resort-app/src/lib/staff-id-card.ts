/**
 * Client-side Staff ID card PDF (spec 008, ui-ux-staff-id-card).
 *
 * CR80 landscape (85.6 × 53.98 mm) with:
 *  - Property brand + "Staff ID"
 *  - Photo (or filled-initials fallback) + name + designation + code + joined
 *  - QR to the ERPNext Employee doc URL (top-right)
 *  - Code-128 barcode of the employee code at the bottom
 *
 * No server round-trip beyond the data already loaded on the Staff page.
 */

import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export type StaffIdCardData = {
	employee: string;
	employee_name: string;
	designation: string | null;
	image: string | null;
	date_of_joining?: string | null;
	property_name?: string;
	site_origin?: string;
};

// ---------- helpers ----------

function initialsFor(name: string): string {
	const words = name.trim().split(/\s+/).slice(0, 2);
	return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

async function urlToDataUrl(url: string): Promise<string | null> {
	// Handle both absolute URLs and Frappe's server-relative /files/... paths.
	const absolute = url.startsWith("http") ? url : `${window.location.origin}${url}`;
	try {
		const res = await fetch(absolute, { credentials: "include" });
		if (!res.ok) return null;
		const blob = await res.blob();
		return await new Promise((resolve) => {
			const r = new FileReader();
			r.onloadend = () => resolve(typeof r.result === "string" ? r.result : null);
			r.onerror = () => resolve(null);
			r.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}

function drawInitialsAvatar(doc: jsPDF, name: string, x: number, y: number, w: number, h: number) {
	doc.setFillColor(233, 236, 239);
	doc.roundedRect(x, y, w, h, 2, 2, "F");
	doc.setTextColor(100);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(18);
	doc.text(initialsFor(name), x + w / 2, y + h / 2 + 3.5, { align: "center" });
	doc.setTextColor(0);
}

function code128DataUrl(text: string, width = 340, height = 60): string {
	if (typeof document === "undefined") return "";
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	try {
		JsBarcode(canvas, text, {
			format: "CODE128",
			displayValue: true,
			height,
			width: 2,
			margin: 0,
			font: "Helvetica",
			fontSize: 12,
			textMargin: 2,
			background: "#ffffff",
			lineColor: "#000000",
		});
		return canvas.toDataURL("image/png");
	} catch {
		return "";
	}
}

// ---------- main render ----------

export async function buildStaffIdCardPdf(data: StaffIdCardData): Promise<jsPDF> {
	const cardW = 85.6;
	const cardH = 53.98;
	const doc = new jsPDF({ unit: "mm", format: [cardW, cardH], orientation: "landscape" });

	// Border
	doc.setDrawColor(200);
	doc.setLineWidth(0.3);
	doc.roundedRect(1.5, 1.5, cardW - 3, cardH - 3, 3, 3);

	// Brand block (top-left)
	const brand = data.property_name || "THE REEZORT";
	doc.setFont("helvetica", "bold");
	doc.setFontSize(11);
	doc.setTextColor(0);
	doc.text(brand, 5, 8);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text("STAFF ID", 5, 12);
	doc.setTextColor(0);

	// QR (top-right)
	const site = data.site_origin || (typeof window !== "undefined" ? window.location.origin : "");
	const employeeUrl = site ? `${site}/app/employee/${encodeURIComponent(data.employee)}` : data.employee;
	try {
		const qrData = await QRCode.toDataURL(employeeUrl, { width: 300, margin: 0 });
		doc.addImage(qrData, "PNG", cardW - 18, 3.5, 14, 14, undefined, "FAST");
	} catch {
		// QR failure isn't fatal; skip.
	}

	// Photo / avatar (left side, below brand)
	const photoW = 20;
	const photoH = 24;
	const photoX = 5;
	const photoY = 15;
	let photoRendered = false;
	if (data.image) {
		const dataUrl = await urlToDataUrl(data.image);
		if (dataUrl) {
			try {
				doc.addImage(dataUrl, "PNG", photoX, photoY, photoW, photoH, undefined, "FAST");
				photoRendered = true;
			} catch {
				photoRendered = false;
			}
		}
	}
	if (!photoRendered) {
		drawInitialsAvatar(doc, data.employee_name, photoX, photoY, photoW, photoH);
	}

	// Text block (right of photo)
	const textX = photoX + photoW + 4;
	doc.setFont("helvetica", "bold");
	doc.setFontSize(11);
	doc.text((data.employee_name || "").toUpperCase(), textX, photoY + 5);
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.text(data.designation || "Staff", textX, photoY + 10);
	doc.setFontSize(8);
	doc.setTextColor(80);
	doc.text(`ID · ${data.employee}`, textX, photoY + 15);
	if (data.date_of_joining) {
		doc.text(`Joined · ${data.date_of_joining}`, textX, photoY + 20);
	}
	doc.setTextColor(0);

	// Barcode strip along bottom
	const barcodeDataUrl = code128DataUrl(data.employee, 600, 90);
	if (barcodeDataUrl) {
		doc.addImage(barcodeDataUrl, "PNG", 5, cardH - 12, cardW - 10, 8, undefined, "FAST");
	}

	return doc;
}

export async function downloadStaffIdCard(data: StaffIdCardData): Promise<void> {
	const doc = await buildStaffIdCardPdf(data);
	const code = (data.employee || data.employee_name || "staff").replace(/[^\w-]+/g, "-");
	doc.save(`Staff_ID_${code}.pdf`);
}
