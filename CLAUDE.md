# CLAUDE.md

This file is the handoff guide for Claude Code working on THE REEZORT custom Frappe app.

## Project Identity

THE REEZORT is a five-star hotel / resort management system built as a custom Frappe app on top of ERPNext.

Locked stack:

- Frappe Framework v15
- ERPNext v15
- Custom app: `the_reezort`
- React SPA: `resort-app`
- UI system: shadcn/ui, lucide-react, Frappe Doppio-style SPA integration
- Staging site (AWS, for cloud access and testing): `https://app.thereezort.com`
  — this is NOT production; there is no live environment yet

Project/spec repo:

- `/Users/alphaworkz/Documents/THE REEZORT`
- GitHub: `rsvasanth/the-reezort`

App repo:

- `/Users/alphaworkz/Documents/reezort-bench/apps/the_reezort`
- GitHub: `rsvasanth/the_reezort`

Bench root:

- `/Users/alphaworkz/Documents/reezort-bench`

Local site:

- `the-reezort.localhost`

## Collaboration Model

Updated 2026-06-29 by owner decision: **Claude is the lead architect and chief designer driving the project. Codex is the implementation engineer.**

Claude (lead architect / chief designer) owns:

- Architecture decisions, Frappe/ERPNext design boundaries, and the ERPNext posting boundary
- Spec and API-contract stewardship, and progress tracking
- The design system and UI/UX direction for the React SPA (`resort-app`)
- Breaking work into precise, verifiable task packets for Codex
- Reviewing Codex's code against specs, contracts, the constitution, and acceptance criteria
- Integration sequencing and merge decisions

Codex (implementation engineer) owns:

- Writing code strictly against the task packets, contracts, and acceptance criteria Claude authors
- Tests for every backend service and focused refactors within packet scope
- Staying inside the scope of the assigned packet

Codex must not make architectural or boundary decisions unilaterally — raise them to the architect. Neither agent makes broad unrequested rewrites. Production deployment still requires explicit owner approval.

See `AGENTS.md` for Codex's working contract.

## Source Of Truth

Specs live in:

- `/Users/alphaworkz/Documents/THE REEZORT/specs`

Most relevant current specs:

- `specs/001-property-setup-room-inventory`
- `specs/002-reservation-engine`
- `specs/004-guest-folio-erpnext-billing`
- `specs/008-erpnext-back-office`
- `specs/015-security-audit-compliance`

Before implementing a module, read its `spec.md`, `data-model.md`, `contracts/api.md`, and `tasks.md`.

## Current State

Latest app commits at handoff:

- `0af86a8 Add resort management prototype dashboard`
- `53ca2d2 Add property room inventory doctypes`
- `03d555e Add live property dashboard APIs`
- `54f0821 Add ERPNext demo site bootstrap`
- `2bc07e8 Seed ERPNext hotel demo masters`
- `43b8d8e Add reservation engine foundation`

Latest project progress commit:

- `57eba50 Update implementation progress tracking`

Implemented and deployed:

- Frappe/ERPNext production setup on EC2
- React SPA foundation at `/resort-app`
- shadcn theme switcher
- Property setup and room inventory foundation
- ERPNext demo business seed
- Reservation engine foundation

Production demo data:

- ERPNext Company: `THE REEZORT Private Limited`
- Resort Property: `RZ-DEMO`
- Rooms: 16
- Room types: Deluxe Sea View, Executive Suite, Beachfront Villa
- Service locations: All Day Dining, Pool Bar, Room Service
- Hotel Items, Item Prices, Warehouses, Cost Centers, Customers, Suppliers, Payment Modes
- Opening stock entry: `MAT-STE-2026-00001`
- Reservation smoke: `RZ-RES-2026-00001`

## Existing Backend Modules

App package:

- `the_reezort/property/api.py`
- `the_reezort/reservation/api.py`
- `the_reezort/setup/bootstrap.py`

DocTypes already added:

- Resort Property
- Resort Building
- Resort Floor
- Room Type
- Room Type Amenity
- Room
- Room Connection
- Room Amenity
- Room Amenity Override
- Service Location
- Operating Hours
- Guest Profile
- Reservation
- Reservation Room
- Reservation Guest
- Room Hold

## Current API Surface

Property:

- `the_reezort.property.api.get_room_status_board`
- `the_reezort.property.api.get_room_type_availability`
- `the_reezort.property.api.find_allocatable_rooms`
- `the_reezort.property.api.run_setup_completeness_check`
- `the_reezort.property.api.seed_demo_property`
- `the_reezort.property.api.get_management_dashboard_snapshot`

Reservation:

- `the_reezort.reservation.api.search_availability`
- `the_reezort.reservation.api.create_quote_or_hold`
- `the_reezort.reservation.api.confirm_reservation`
- `the_reezort.reservation.api.cancel_reservation`
- `the_reezort.reservation.api.get_reservation_summary`

Setup:

- `the_reezort.setup.bootstrap.bootstrap_demo_site`

## ERPNext Boundary Rules

ERPNext owns:

- Company
- Accounts, GL, taxes, receivables, payables
- Customer, Supplier
- Item, Item Price
- Warehouse, Stock Ledger
- Sales Invoice, Payment Entry, Credit Note, Journal Entry
- Cost Center
- HR, payroll, buying, stock, assets where standard ERPNext fits

THE REEZORT custom app owns:

- Property and room inventory
- Reservations
- PMS stay lifecycle
- Guest folios
- Folio charges and operational billing state
- Restaurant/F&B room posting and direct billing wrappers
- Housekeeping, maintenance, concierge, events
- Controlled handoff to ERPNext financial documents

Do not recreate ERPNext accounting or stock logic in custom DocTypes.

## Coding Rules

- Follow existing Frappe metadata-driven patterns.
- Prefer DocTypes and service methods over ad hoc database tables.
- All booking/billing mutations must go through whitelisted service methods.
- Do not let public/Guest APIs expose arbitrary private reservation or folio details.
- Use `frappe.throw` for business validation.
- Use `ignore_permissions=True` only inside trusted service methods with explicit permission checks.
- Do not post GL, Sales Invoice, or Payment Entry directly from Reservation.
- Folio/Billing service will be the ERPNext posting boundary.
- Add focused tests for every backend service.
- Keep edits scoped. Do not reformat unrelated files.
- Do not commit secrets, tokens, `.pem` files, or local site config.
- Do not use destructive git commands.

## Branch And Git Rules

Default working branch prefix:

- `codex/`

Current app branch:

- `codex/sprint-0-bench-setup`

Before changing code:

```bash
cd /Users/alphaworkz/Documents/reezort-bench/apps/the_reezort
git status --short
git branch --show-current
```

Commit small, reviewable units.

Good commit message examples:

- `Add guest folio doctypes`
- `Open folio from confirmed reservation`
- `Post folio settlement to ERPNext invoice`
- `Add folio workspace UI foundation`

## Local Commands

Run from bench root:

```bash
cd /Users/alphaworkz/Documents/reezort-bench
```

Migrate:

```bash
bench --site the-reezort.localhost migrate
```

Run focused Frappe tests:

```bash
bench --site the-reezort.localhost run-tests --module the_reezort.property.test_api --skip-test-records
bench --site the-reezort.localhost run-tests --module the_reezort.reservation.test_api --skip-test-records
bench --site the-reezort.localhost run-tests --module the_reezort.the_reezort.doctype.room.test_room --skip-test-records
bench --site the-reezort.localhost run-tests --module the_reezort.the_reezort.doctype.service_location.test_service_location --skip-test-records
```

Compile Python:

```bash
env/bin/python -m compileall apps/the_reezort/the_reezort
find apps/the_reezort/the_reezort -type d -name __pycache__ -prune -exec rm -rf {} +
find apps/the_reezort/the_reezort -name '*.pyc' -delete
```

Frontend commands:

```bash
cd /Users/alphaworkz/Documents/reezort-bench/apps/the_reezort/resort-app
yarn lint
yarn build
```

Frontend build output is committed into:

- `the_reezort/public/resort-app`
- `the_reezort/www/resort-app.html`

## Deploy Guardrail

`app.thereezort.com` is **staging** on AWS — a test environment, not a release
target. Deploying there is routine, but still ask first: it is shared, and other
people may be looking at it.

Deploys have been handled from Codex using the EC2 SSH key already present on the
machine (`~/.ssh/Reezort.pem`). When a real production environment exists, it gets
its own guardrail and explicit owner approval per deploy.

If asked to prepare deployment, provide the exact commands and ask for confirmation unless the user explicitly says to deploy.

## Current Next Task Queue

Next implementation target:

- `004 Guest Folio and ERPNext Billing` foundation.

Recommended task packets:

1. Create `Guest Folio` DocType and tests.
2. Create `Folio Line` child/linked DocType and validation tests.
3. Add API: `open_folio_from_reservation`.
4. Add API: `add_folio_charge`.
5. Map room charges to ERPNext Items using existing seeded room service Items.
6. Add API: `get_folio_summary`.
7. Add controlled posting log DocType before creating Sales Invoice.
8. Add ERPNext Sales Invoice posting only after folio totals/tests are stable.
9. Add React folio screen after backend APIs are proven.

First packet recommendation:

```text
Read specs/004-guest-folio-erpnext-billing. Implement only Guest Folio + Folio Line DocTypes, controller validations, and tests. Do not implement ERPNext Sales Invoice posting yet.
```

Acceptance for first folio packet:

- A confirmed reservation can open one primary Guest Folio.
- Folio links property, company, reservation, customer, currency.
- Folio starts in `Open` status.
- Folio line can hold a room charge with item code and amount.
- Posted/closed folio cannot accept normal charges.
- Tests cover validation and idempotency.

## Design/UI Rules

React UI should remain:

- Premium, calm, operational, dense but readable
- shadcn/ui based
- lucide icons in buttons
- No generic marketing landing pages
- No one-note purple/blue gradients
- No nested cards
- No visible instruction text explaining basic UI mechanics

Use existing components and patterns under:

- `resort-app/src/components`
- `resort-app/src/components/ui`
- `resort-app/src/lib`

## Important Notes

- Spa/ancillary services are parked for post-year-one operations.
- Public reservation availability search is allowed, but reservation private details are not public.
- Current production public SPA may show mock fallback for protected APIs when not logged in.
- Always update project progress specs after accepted app work.
