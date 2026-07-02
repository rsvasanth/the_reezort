#!/usr/bin/env node
/**
 * Doctype ↔ TypeScript parity guard.
 *
 * The frontend string-literal unions MUST match the backing doctype Select
 * options exactly. When they drift (a hand-typed value the backend never
 * emits, or a missing option), the UI silently sends invalid payloads (HTTP
 * 417) or mis-renders. This script is the cheap, deterministic check that
 * would have caught the fabricated "Room Cleaning" / "Open" / "Stayover"
 * vocabulary before it ever reached a browser.
 *
 * Run: `yarn check:contracts` (also runs as part of `yarn build`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const doctypeBase = resolve(here, "../../the_reezort/the_reezort/doctype");
const libBase = resolve(here, "../src/lib");

// Each entry: a TS union that must equal a doctype Select field's options.
const CONTRACTS = [
	// housekeeping-api.ts ↔ Room / Housekeeping Task
	{ file: "housekeeping-api.ts", type: "HousekeepingStatus", doctype: "room", field: "housekeeping_status" },
	{ file: "housekeeping-api.ts", type: "OccupancyStatus", doctype: "room", field: "occupancy_status" },
	{ file: "housekeeping-api.ts", type: "MaintenanceStatus", doctype: "room", field: "maintenance_status" },
	{ file: "housekeeping-api.ts", type: "SellableStatus", doctype: "room", field: "sellable_status" },
	{ file: "housekeeping-api.ts", type: "TaskType", doctype: "housekeeping_task", field: "task_type" },
	{ file: "housekeeping-api.ts", type: "TaskStatus", doctype: "housekeeping_task", field: "task_status" },
	{ file: "housekeeping-api.ts", type: "TaskPriority", doctype: "housekeeping_task", field: "priority" },
	// condition-api.ts ↔ Room Condition Capture
	{ file: "condition-api.ts", type: "CaptureStage", doctype: "room_condition_capture", field: "capture_stage" },
	{ file: "condition-api.ts", type: "OverallCondition", doctype: "room_condition_capture", field: "overall_condition" },
	// folio-api.ts ↔ Guest Folio / Folio Line
	{ file: "folio-api.ts", type: "FolioStatus", doctype: "guest_folio", field: "folio_status" },
	{ file: "folio-api.ts", type: "PostingStatus", doctype: "guest_folio", field: "posting_status" },
	{ file: "folio-api.ts", type: "BalanceStatus", doctype: "guest_folio", field: "balance_status" },
	{ file: "folio-api.ts", type: "FolioType", doctype: "guest_folio", field: "folio_type" },
	{ file: "folio-api.ts", type: "LineType", doctype: "folio_line", field: "line_type" },
	{ file: "folio-api.ts", type: "LineStatus", doctype: "folio_line", field: "line_status" },
	{ file: "folio-api.ts", type: "TaxTreatment", doctype: "folio_line", field: "tax_treatment" },
	{ file: "folio-api.ts", type: "SourceModule", doctype: "folio_line", field: "source_module" },
	// restaurant-api.ts ↔ Restaurant Order / Restaurant Order Item / Restaurant Table
	{ file: "restaurant-api.ts", type: "RestaurantOrderState", doctype: "restaurant_order", field: "state" },
	{ file: "restaurant-api.ts", type: "KitchenSection", doctype: "restaurant_order", field: "kitchen_section" },
	{ file: "restaurant-api.ts", type: "RestaurantOrderItemLineStatus", doctype: "restaurant_order_item", field: "line_status" },
	{ file: "restaurant-api.ts", type: "RestaurantTableZone", doctype: "restaurant_table", field: "zone" },
];

function doctypeOptions(doctype, field) {
	const json = JSON.parse(readFileSync(resolve(doctypeBase, doctype, `${doctype}.json`), "utf8"));
	const f = (json.fields || []).find((x) => x.fieldname === field && x.fieldtype === "Select");
	if (!f) throw new Error(`Select field ${doctype}.${field} not found`);
	return (f.options || "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function tsUnion(file, type) {
	const src = readFileSync(resolve(libBase, file), "utf8");
	const m = src.match(new RegExp(`export type ${type}\\s*=([\\s\\S]*?);`));
	if (!m) throw new Error(`TS type ${type} not found in ${file}`);
	return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

let failures = 0;
for (const c of CONTRACTS) {
	const doc = new Set(doctypeOptions(c.doctype, c.field));
	const ts = new Set(tsUnion(c.file, c.type));
	const fabricated = [...ts].filter((v) => !doc.has(v)); // in TS, not in doctype → will break
	const missing = [...doc].filter((v) => !ts.has(v)); // in doctype, not in TS → incomplete
	if (fabricated.length || missing.length) {
		failures++;
		console.error(`✗ ${c.type} (${c.file}) ≠ ${c.doctype}.${c.field}`);
		if (fabricated.length) console.error(`    fabricated (not in doctype): ${JSON.stringify(fabricated)}`);
		if (missing.length) console.error(`    missing (in doctype):        ${JSON.stringify(missing)}`);
	}
}

if (failures) {
	console.error(`\n${failures} contract(s) out of sync with the doctype source of truth.`);
	process.exit(1);
}
console.log(`✓ ${CONTRACTS.length} doctype↔TS contracts in sync.`);
