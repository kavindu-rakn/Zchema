# Zchema — Overhaul Plans

Seven sequential phases. Each file is a self-contained brief for Claude Code.

| Phase | File | Theme | Depends on |
|---|---|---|---|
| 1 | `implementation_plan_number_1.md` | Data model: schema inheritance, blueprints, versions | — |
| 2 | `implementation_plan_number_2.md` | Navigation shell + Data Center workspace | 1 |
| 3 | `implementation_plan_number_3.md` | Real tree + schema composition UI | 1, 2 |
| 4 | `implementation_plan_number_4.md` | Items workspace on effective schema | 1, 3 |
| 5 | `implementation_plan_number_5.md` | Schema impact analysis + versioning | 1, 3, 4 |
| 6 | `implementation_plan_number_6.md` | Attribute library + global search | 1, 4 |
| 7 | `implementation_plan_number_7.md` | Schema inference, onboarding, polish | all |

## The one-line pitch this overhaul is buying

> Zchema is not a catalog. It is a **schema management system for catalog data** — change your data model against live records and see exactly what breaks *before* it breaks.

## What is being fixed

1. **Inverted workflow.** Templates-first is backwards. The **tree is the product**; schema is defined on the node, blueprints become optional accelerators.
2. **No attribute inheritance** (the real bug). A child category could not add fields its parent lacked. Fixed by category-owned schema composition.
3. **No differentiation.** Fixed by impact analysis, versioning + diff, attribute library, and schema inference.
4. **Flat Categories/Catalog pages.** Merged into one master-detail tree workspace.
5. **Sidebar carrying no weight.** Replaced by a top bar; inside the Data Center the tree *is* the navigation.

## Ground rules for every phase

- **Never auto-commit.** Stop at each checkpoint and let the human commit.
- Next.js here is **16.2.11** — read `node_modules/next/dist/docs/` before writing route/API code. Training-data Next.js conventions are not reliable.
- Run `npm run build` before declaring a phase done.
