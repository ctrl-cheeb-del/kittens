"use client";

/**
 * The tape: an ordered ribbon of protocol values.
 *
 * JA3, JA4 and the Akamai fingerprint are all hashes over *sequences*, so the
 * one thing this UI has to make undeniable is order. Hence an index on every
 * cell, and horizontal scroll rather than wrapping, which would imply the
 * arrangement is cosmetic.
 *
 * Cells copy their hex on click, since a single cipher or extension id is
 * exactly what gets pasted into an issue or a test.
 */

import { useState } from "react";

interface Cell {
  hex: string;
  name: string;
  grease: boolean;
}

function TapeCell({ c, index }: { c: Cell; index: number }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={
        copied
          ? "Copied"
          : c.grease
            ? `${c.hex} is GREASE, excluded from every hash. Click to copy.`
            : `${c.hex} ${c.name}. Click to copy.`
      }
      onClick={() => {
        navigator.clipboard?.writeText(c.hex).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
      className={`cell text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] ${
        c.grease ? "cell-grease" : ""
      }`}
    >
      <span className="font-mono text-[10px] text-muted-foreground">
        {copied ? "copied" : String(index + 1).padStart(2, "0")}
      </span>
      <span
        className={`font-mono text-[13px] ${
          c.grease ? "text-muted-foreground line-through" : "text-canopy"
        }`}
      >
        {c.hex}
      </span>
      <span className="max-w-[150px] truncate text-[11px] text-muted-foreground">
        {c.grease ? "GREASE" : c.name}
      </span>
    </button>
  );
}

export function Tape({
  title,
  cells,
  note,
}: {
  title: string;
  cells: Cell[];
  note?: string;
}) {
  if (cells.length === 0) return null;

  const greased = cells.filter((c) => c.grease).length;
  const counted = cells.length - greased;

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {counted} hashed
          {greased > 0 ? ` · ${greased} GREASE dropped` : ""}
          {note ? ` · ${note}` : ""}
        </span>
      </div>

      {/* A group rather than a list: these are buttons, and role="listitem"
          on a button suppresses the button role for screen readers. */}
      <div
        role="group"
        aria-label={title}
        className="no-scrollbar flex overflow-x-auto rounded-2xl border border-line bg-card"
      >
        {cells.map((c, i) => (
          <TapeCell key={`${c.hex}-${i}`} c={c} index={i} />
        ))}
      </div>
    </section>
  );
}
