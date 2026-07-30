// ── Export ───────────────────────────────────────────────────
// GET /api/export?q=…&format=csv|json&category=<uuid>&orphaned=1
//
// STREAMED, not assembled. Building the whole file in memory works
// beautifully at 200 items and falls over at 200,000 — and the failure
// mode is the server running out of heap, not a slow download. Rows are
// pulled from the database a page at a time and pushed to the client as
// they arrive, so peak memory is one page regardless of the export size.
//
// Route Handlers are uncached by default in Next 16, which is what we
// want: an export must reflect the catalog now.

import { NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { getSearchableFields, resolveCategorySlug, searchItems } from "@/lib/data/search";
import { parseQuery } from "@/lib/query-dsl";
import { csvRow, exportFilename, exportHeader, itemToRow } from "@/lib/export";

/** Rows fetched per round trip. Peak memory is one of these. */
const PAGE_SIZE = 500;

/**
 * Hard stop, so a malformed request cannot stream forever.
 * Reached only by an export nobody asked for.
 */
const MAX_ROWS = 100_000;

export async function GET(request: NextRequest) {
  // An export is a bulk read of everything the caller can see, so it
  // gets the same gate as any other read: you must be signed in. RLS
  // still applies underneath.
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Sign in to export.", { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "json" ? "json" : "csv";
  const includeOrphaned = params.get("orphaned") === "1";
  const query = params.get("q") ?? "";

  const parsed = parseQuery(query);

  // An explicit ?category= wins over the query's own `in:` scope: the
  // Items tab passes the category it is showing, and the search page
  // passes none.
  const explicitCategory = params.get("category");
  const scope = explicitCategory
    ? { id: explicitCategory, name: params.get("scopeName") ?? "export" }
    : parsed.scope
      ? await resolveCategorySlug(parsed.scope)
      : null;

  if (parsed.scope && !explicitCategory && !scope) {
    return new Response(`No category has the slug "${parsed.scope}".`, { status: 404 });
  }

  const searchArgs = {
    text: parsed.text,
    filters: parsed.filters,
    categoryId: scope?.id ?? null,
    // The Items tab can be showing one category's own rows; exporting
    // its whole subtree would hand back more than the screen showed.
    includeSubtree: params.get("subtree") !== "0",
  };

  // COLUMNS COME FROM THE SCHEMA, not from scanning every row first.
  // Deriving the union of keys by reading the whole result set would
  // mean two full passes — and the second pass is the thing we are
  // streaming precisely to avoid holding in memory.
  const fields = await getSearchableFields(scope?.id ?? null);
  const columns = fields.map((field) => field.key);

  const encoder = new TextEncoder();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = exportFilename(scope?.name ?? "catalog", format, stamp);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (format === "csv") {
          controller.enqueue(
            encoder.encode(csvRow(exportHeader(columns, { includeOrphaned })))
          );
        } else {
          controller.enqueue(encoder.encode("[\n"));
        }

        let page = 1;
        let written = 0;
        let more = true;

        while (more && written < MAX_ROWS) {
          const { rows } = await searchItems({
            ...searchArgs,
            page,
            pageSize: PAGE_SIZE,
          });

          for (const row of rows) {
            if (format === "csv") {
              controller.enqueue(
                encoder.encode(
                  csvRow(itemToRow(row, columns, { includeOrphaned }))
                )
              );
            } else {
              const payload: Record<string, unknown> = {
                _id: row.id,
                _category: row.category_path,
                ...Object.fromEntries(
                  Object.entries(row.data ?? {}).filter(([key]) => key !== "__orphaned")
                ),
              };
              if (includeOrphaned && row.data?.__orphaned) {
                payload.__orphaned = row.data.__orphaned;
              }
              controller.enqueue(
                encoder.encode(`${written > 0 ? ",\n" : ""}${JSON.stringify(payload)}`)
              );
            }
            written += 1;
          }

          more = rows.length === PAGE_SIZE;
          page += 1;
        }

        if (format === "json") controller.enqueue(encoder.encode("\n]\n"));
        controller.close();
      } catch (error) {
        // The headers are already sent by this point, so there is no
        // way to turn this into a 500. Abort the stream instead — a
        // truncated download that errors is far better than one that
        // silently ends early and looks complete.
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
