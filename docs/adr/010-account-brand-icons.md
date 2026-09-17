# ADR 010: Account brand and Brazilian instrument icons

**Status:** Accepted  
**Date:** 2026-09-17

## Context

Accounts already persist an optional `icon` text identifier. The desktop and
Android WebView clients currently resolve a small set of generic identifiers to
Lucide icons. Brazilian users commonly distinguish accounts by provider or
instrument — for example Nubank, Itaú, Tesouro Direto and CDB — so a generic
bank or investment glyph is often not sufficiently recognizable.

The application runs the same React renderer in the browser, Tauri desktop
shell and Android WebView. The account icon value is also mirrored through the
offline store. A solution should therefore remain portable and avoid coupling
the API or offline database to client-specific assets.

## Decision

Extend the shared account icon catalog with stable identifiers for:

- common Brazilian banks and payment accounts;
- Brazilian savings and investment instruments; and
- the existing generic account icons.

The identifier remains a plain string in `accounts.icon`. The backend continues
to treat it as an opaque value, while each client resolves it locally.

Brand entries render two-letter monogram chips in the provider's representative
colour rather than bundling official logo artwork. Instrument entries resolve to
Lucide glyphs. This provides recognition without adding image assets or making
the database depend on a particular rendering library.

When creating an account, the form suggests a brand or instrument from the
account name (accent-insensitive and punctuation-insensitive). A suggestion is
only applied until the user explicitly chooses an icon. Editing an existing
account preserves its stored icon, including legacy values.

## Consequences

- No database migration or API contract change is required.
- Existing generic and unknown persisted values remain compatible through the
  existing kind-based fallback.
- The picker is grouped into banks, investments, money/savings and other.
- Brand colours and monograms are client-rendered and should not be treated as
  official logo assets or endorsements.
- Adding a new client requires implementing the same stable-id catalog if it
  wants brand-specific rendering; generic fallback remains available.
- The catalog is intentionally curated rather than exhaustive. A search or
  user-uploaded icon system can be considered separately if the list grows.
