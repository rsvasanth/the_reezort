# AGENTS.md

Working contract for Codex on THE REEZORT custom Frappe app.

## Your role

You are the **implementation engineer**. The lead architect / chief designer (Claude) owns architecture, design boundaries, the ERPNext posting boundary, API contracts, UI/UX direction, and merge decisions. You write code against the **task packets** the architect authors.

- Implement strictly to the packet's scope, contract, and acceptance criteria.
- Do **not** make architectural, schema-boundary, or ERPNext-posting decisions on your own. If a packet is ambiguous, underspecified, or you believe it should change, raise it to the architect instead of improvising.
- Do not expand scope, refactor unrelated code, or reformat untouched files.
- Add focused tests for every backend service you implement.

## How work flows

1. The architect gives you a task packet: goal, files to touch, DocType fields / API signature, business rules, and acceptance criteria.
2. You implement it on a `codex/` feature branch.
3. You run the relevant tests + `bench migrate` and report results.
4. The architect reviews against the packet and the constitution, then decides on merge.

## Source of truth

- Specs: `/Users/alphaworkz/Documents/THE REEZORT/specs` — read `spec.md`, `data-model.md`, `contracts/api.md`, `tasks.md` for the module before implementing.
- Architecture/boundary rules and project facts: `CLAUDE.md` in this repo (read it — coding rules, ERPNext boundary, git, and local commands all live there).

## Hard rules (do not violate)

- All booking/billing mutations go through whitelisted service methods.
- The Folio/Billing service is the **only** ERPNext posting boundary. Never post GL Entry, Sales Invoice, or Payment Entry directly from Reservation, Stay, or outlet code.
- Custom app must not create `GL Entry` directly in normal workflow.
- Use `frappe.throw` for business validation; `ignore_permissions=True` only inside trusted service methods with explicit permission checks.
- Idempotent source-created records must enforce a unique `idempotency_key`.
- Do not commit secrets, tokens, `.pem` files, or local site config. No destructive git commands.
- Do not deploy to production. Deployment requires explicit owner approval and is not yours to initiate.
