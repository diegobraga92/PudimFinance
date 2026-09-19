# ADR 012: Category icon catalog and picker

**Status:** Accepted  
**Date:** 2026-09-19

## Context

Categories persist an optional `icon` text identifier. The browser, Tauri desktop
shell and Android WebView run the same React renderer, which resolves the value
to a Lucide glyph in `CategoryIcon`. The catalog began with 17 generic
identifiers, offered in a flat nine-column grid with no grouping and no search.

Users organise spending by more specific concepts — meals, food delivery,
medicine, doctor visits, contractors, transit and pets — so a small generic set
forces arbitrary icon choices, and the fixed grid does not scale to a larger
catalog.

## Decision

- Expand `shared/category-icons.ts` into a grouped, labelled, alias-annotated
  catalog of ~110 identifiers covering common income and expense themes, while
  retaining every legacy identifier.
- Keep `categories.icon` an opaque string. The backend and OpenAPI contract are
  unchanged, and unknown persisted values still fall back to the generic tag.
- Store icon and group names as i18n keys (`categories.icon.*`,
  `categories.icon.group.*`) so picker labels and accessibility names are
  localised in English and pt-BR.
- Add bilingual search aliases per icon and expose `suggestCategoryIcon`, applied
  while a new category name is typed until the user picks an icon.
- Rebuild the picker around a search field and a grouped, responsive grid. The
  list is bounded (`overflow`) only from `md` up; on phones it relies on the
  bottom-sheet dialog's own scroll to avoid nested scrolling.

## Consequences

- No database migration or API contract change is required.
- Existing and seeded categories keep their icons; unknown values remain
  compatible through the `Tag` fallback.
- Adding a new client requires mapping the same identifiers, or falling back to a
  generic glyph.
- The catalog is curated rather than exhaustive and can grow without schema
  changes.
