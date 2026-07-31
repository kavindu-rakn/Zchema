"use client";

// ── Step 1 · Source ──────────────────────────────────────────
// Drop a file, paste text, or fetch a URL.
//
// The URL fetch runs in the BROWSER, not on the server. A server-side
// fetch of a user-supplied URL is a server-side request forgery hole —
// it would happily fetch a cloud metadata endpoint or an internal
// service. Fetching client-side means the browser's own CORS rules
// apply, which costs us some public URLs and costs an attacker the
// entire class of attack.

import { useRef, useState } from "react";
import { FileUp, Link2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { parseCsv, parseJson } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { ParsedTable } from "@/lib/csv";

/** Beyond this the browser starts to struggle and the wizard lies about being fast. */
const MAX_ROWS = 10_000;

type Mode = "paste" | "url";

export function SourceStep({
  onParsed,
}: {
  onParsed: (table: ParsedTable, sourceName: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<ParsedTable | null>(null);

  const parse = (raw: string, sourceName: string) => {
    setError(null);

    const trimmed = raw.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }

    // A leading [ or { is JSON; everything else is delimited text.
    const table =
      trimmed.startsWith("[") || trimmed.startsWith("{")
        ? parseJson(trimmed)
        : parseCsv(trimmed);

    if (table.rows.length === 0) {
      setPreview(null);
      setError(table.warnings[0] ?? "Nothing could be read from that.");
      return;
    }

    if (table.rows.length > MAX_ROWS) {
      setPreview(null);
      setError(
        `That is ${table.rows.length.toLocaleString()} rows. This importer handles up to ${MAX_ROWS.toLocaleString()} at a time — split the file and run it twice.`
      );
      return;
    }

    setPreview(table);
    setName(sourceName);
  };

  const readFile = async (file: File) => {
    setError(null);
    const content = await file.text();
    setText(content.slice(0, 2_000_000));
    parse(content, file.name);
  };

  const fetchUrl = async () => {
    setError(null);
    setFetching(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The server returned ${response.status}.`);
      const content = await response.text();
      setText(content);
      parse(content, url.split("/").pop() || "imported");
    } catch (cause) {
      setError(
        `Could not fetch that URL: ${(cause as Error).message}. Most sites block cross-origin reads — downloading the file and dropping it here always works.`
      );
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
        className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-8 text-center"
      >
        <FileUp className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-foreground">Drop a CSV, TSV or JSON file here</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Nothing is uploaded — the file is read in your browser.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => fileRef.current?.click()}
        >
          Choose a file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.json,text/csv,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
      </div>

      {/* Paste / URL */}
      <div className="flex gap-1">
        {(["paste", "url"] as Mode[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              mode === option
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            {option === "paste" ? "Paste text" : "From a URL"}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            parse(event.target.value, name || "pasted-data");
          }}
          rows={8}
          placeholder={"name,brand,ram\nZenBook,ASUS,16 GB"}
          aria-label="Paste your data"
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/products.csv"
              className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button variant="outline" onClick={fetchUrl} disabled={!url.trim() || fetching}>
            {fetching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Fetch
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Live count, so the parse is visibly working before Next is pressed */}
      {preview && (
        <div className="space-y-2 rounded-md border border-border bg-card/50 px-3 py-2">
          <p className="text-sm text-foreground">
            <strong>{preview.rows.length.toLocaleString()}</strong> row
            {preview.rows.length === 1 ? "" : "s"} ·{" "}
            <strong>{preview.headers.length}</strong> column
            {preview.headers.length === 1 ? "" : "s"}
            {preview.delimiter && (
              <span className="text-muted-foreground">
                {" · "}
                {describeDelimiter(preview.delimiter)}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {preview.headers.join(" · ")}
          </p>

          {preview.warnings.length > 0 && (
            <ul className="space-y-0.5">
              {preview.warnings.slice(0, 3).map((warning, index) => (
                <li key={index} className="text-[11px] text-warning">
                  {warning}
                </li>
              ))}
              {preview.warnings.length > 3 && (
                <li className="text-[11px] text-muted-foreground">
                  and {preview.warnings.length - 3} more
                </li>
              )}
            </ul>
          )}

          <Button size="sm" onClick={() => onParsed(preview, name || "imported")}>
            Use this data
          </Button>
        </div>
      )}
    </div>
  );
}

function describeDelimiter(delimiter: string): string {
  if (delimiter === "\t") return "tab-separated";
  if (delimiter === ";") return "semicolon-separated";
  if (delimiter === "|") return "pipe-separated";
  if (delimiter === ",") return "comma-separated";
  return "JSON";
}
