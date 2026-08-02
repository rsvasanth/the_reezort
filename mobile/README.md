# Reezort Mobile

Android-first Expo monorepo. Two apps, one set of shared packages.
Spec: `specs/016-mobile-apps/` in the-reezort repo.

| App | Audience | Distribution | Design language |
| --- | --- | --- | --- |
| `apps/ops` | Staff (housekeeping, maintenance, managers) | Sideloaded APK, BYOD Android | Material 3, consumed not built |
| `apps/guest` | Guests | Google Play | Reezort brand, derived from the `#/book` marketing site |

Two binaries, not one role-switched app: the guest app faces Play review and
must not contain staff surfaces; the ops app must not be publicly installable.

## Packages

- `api-client` — frappe-js-sdk wrapper: token auth, typed calls, uploads
- `domain-types` — doctype-mirrored unions; participates in `check:contracts`
- `outbox` — SQLite write-behind queue with conflict surfacing (ops only)
- `ui` — token infrastructure and layout primitives only. **No shared visual
  components** — the two apps use different design languages by design
  (AD-016-008).

## Commands

    yarn install
    yarn typecheck
    yarn check:contracts
    yarn ops        # start the ops app
    yarn guest      # start the guest app
