# Five-minute demo

The sequence below is the counter-argument to *"it's just another e-commerce platform."*
Everything before step 3 is setup; step 3 is the product.

**Before you start:** sign in as a `SCHEMA_ADMIN`, and have `seedAmazonFull.sql` loaded (or an
empty workspace, and use the Sample path in step 0).

---

## 0 · Start from nothing — 20 seconds

*Only if the catalog is empty.*

Open **Data Center**. Instead of a blank pane with a button, you get three real paths: Import,
Sample, Build. Click **Load a catalog**.

You land on `Gaming Laptops` → **Schema**, which is the one screen worth seeing first.

> **Say:** "It didn't drop me on a dashboard. It dropped me on the screen that explains the
> model."

---

## 1 · The model, in one screen — 45 seconds

You are on `Gaming Laptops` → **Schema**.

Point at the **Inherited** block: seven fields, grouped by where they came from — `brand`,
`model_number`, `warranty_months` from **Electronics**; `screen_size_in`, `ram_gb`, `cpu`, `gpu`
from **Laptops**. Below it, **Defined here**: `refresh_rate_hz`, `has_rgb`.

Note the amber dot on `warranty_months` — Gaming Laptops overrides it to required, and
`Electronics` is unaffected.

> **Say:** "Three levels deep. The schema is composed, not copied. And the override is local —
> the parent doesn't know about it."

Click **Smartphones** in the tree → Schema. Same three Electronics fields, none of the Laptops
ones.

> **Say:** "This is the bug in template-based tools. Smartphones and Laptops share an ancestor
> and nothing else. In a one-template-per-category model, adding `gpu` for laptops pollutes
> every phone."

---

## 2 · Add a field, watch the blast radius stay small — 30 seconds

Back on `Gaming Laptops` → Schema. **Add field** → label `Refresh Rate Hz`, type `number`.

Watch the key derive itself, and the **Preview** pane on the right update live — that is the
same `<DynamicForm>` the Items tab renders, so the preview cannot drift from reality.

Click **Smartphones**: untouched.

---

## 3 · The impact dialog — 2 minutes · **this is the demo**

Go to **Electronics** → **Schema**. Find `warranty_months` and tick **required**.

**Do not click anything yet.** Point at the badge that just appeared next to *Review changes* —
it turned amber the moment the checkbox flipped.

> **Say:** "That's a live analysis running against real rows, debounced as I type. I haven't
> saved anything. It's telling me the risk is building."

Click **Review changes**.

Read the header aloud: *"3 categories · 48 items · 1 destructive change"* — or whatever your seed
gives. Then read one card verbatim:

> *"31 of 48 items have no value for this field and will be flagged incomplete."*

> **Say:** "Not '31 items affected'. It tells me what happens to them."

Point at the remediation radio group. Note that **Backfill** and **Leave blank** are the
options, that the safest is preselected, and that nothing here can delete anything.

Now make it destructive: go back, **delete** `model_number`, and reopen the dialog.

> **Say:** "Now it's destructive. It's counted the items holding a value, it's showing me five
> of them, and the default is *move to orphaned data* — not delete. Delete is there, it's red,
> and it needs a second confirmation that names the count. Nothing in this app destroys a value
> without being asked twice."

Pick **Backfill** with `12` on the required change, **Move to orphaned** on the removal, and
click **Apply changes**.

Read the toast: *"v2 · 48 items updated · 31 backfilled"* with an **Undo**.

---

## 4 · History and diff — 45 seconds

**History** tab. The timeline shows `v2 · just now · you · 1 now required, 1 removed`, with a
red severity dot. Expand it — the recorded summary includes **which remediation was chosen and
how many items it touched**.

Set the diff to compare **v1 → v2**. Field-level, colour-coded, `−` for the removed field, `~`
for the changed one with the changed property named.

> **Say:** "Append-only. If I restore v1 now, it writes v3 — v1 and v2 stay readable forever. An
> audit trail you can edit isn't an audit trail."

If the strip is showing, point at *"N items were written against v1 and older"* — item versions
only bump when a migration actually touched the row, which is what makes that number mean
something.

---

## 5 · Cross-category search — 45 seconds

**⌘K**, type `apple`. Item results appear above the categories, from **Laptops, Smartphones and
Tablets** at once. Hit **See all N results →**.

On the search page, type `brand:Apple price:>500` — or use a field your seed has. Point at the
facets: they are counted over the *whole* match set, not the visible page.

> **Say:** "This only works because `brand` on Laptops and `brand` on Tablets are asserted to be
> the same attribute, not two strings that happen to spell alike. That's what the attribute
> registry buys."

Select two items **from different categories** and hit **Compare**. The shared rows are exactly
the inherited fields; the rest show a dash.

> **Say:** "Comparing a laptop against a tablet works, and the rows they share are the ones they
> inherit. That's the model doing visible work."

---

## 6 · Import and inference — 60 seconds

**Data Center** → **Import data** in the rail footer. Paste this:

```csv
Product Name,Brand,RAM,Release Date,Condition,In Stock,Internal Notes
ZenBook 14,ASUS,16 GB,2024-03-01,New,yes,
ROG Strix,ASUS,32 GB,2024-05-12,New,yes,
Legion 5,Lenovo,16 GB,2023-11-20,Refurbished,no,
ThinkPad X1,Lenovo,32 GB,2024-01-08,New,yes,
Blade 15,Razer,16 GB,2024-02-14,Used,no,
```

Click **Use this data** → **Next**.

The Review step is the payoff. Point at:

- `RAM` typed as **number** with unit **GB** — *"it read the unit off the values"*
- `Condition` typed as **select** with the options found
- `In Stock` as **boolean**
- `Internal Notes`, 100% empty, **skipped by default**
- Every row stating its evidence: *"5/5 values parse as numbers, all in GB"*

> **Say:** "Least-certain columns sort to the top, so the ones worth arguing with are the ones
> you see first."

**Next** → pick **An existing category** → `Laptops`. Point at the **mapping table**: `Brand`
matched onto the *inherited* `brand` rather than creating a duplicate beside it.

> **Say:** "It proposed that; it didn't do it silently. Every row is a dropdown I can correct."

**Next** → the preview shows the first rows exactly as the Items table will, with any
unconvertible cell listed by line number *before* committing. **Import**.

---

## The closing line

> "Changing a data model against live records is the scariest routine operation in software.
> Every other tool here lets you do it and find out afterwards. This one shows you the blast
> radius, makes you choose what happens to each value that can't survive, does it in one
> transaction, and keeps a version you can diff and roll back."

---

## If something goes wrong

- **Sample refuses to load** — it only runs into an empty workspace, by design. Truncate or use
  a fresh project.
- **The severity badge never appears** — the schema editor's live analysis needs `impact.sql`
  applied.
- **Search returns nothing** — `search.sql` adds a *generated* column; existing rows get it on
  the table rewrite, so re-check the file actually ran.
- **`brand:Sony` finds nothing** — no seed contains Sony. Use `brand:Apple`.
