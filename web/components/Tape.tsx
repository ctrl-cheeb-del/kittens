/**
 * The tape: an ordered ribbon of protocol values.
 *
 * JA3, JA4 and the Akamai fingerprint are all hashes over *sequences*, so the
 * one thing this UI has to make undeniable is order. Hence an index on every
 * cell, and horizontal scroll rather than wrapping, which would imply the
 * arrangement is cosmetic.
 */

interface Cell {
  hex: string;
  name: string;
  grease: boolean;
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

      <div
        role="list"
        aria-label={title}
        className="no-scrollbar flex overflow-x-auto rounded-2xl border border-line bg-card"
      >
        {cells.map((c, i) => (
          <div
            role="listitem"
            key={`${c.hex}-${i}`}
            title={
              c.grease
                ? `${c.hex} is GREASE, excluded from every hash`
                : `${c.hex} ${c.name}`
            }
            className={`cell ${c.grease ? "cell-grease" : ""}`}
          >
            <span className="font-mono text-[10px] text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
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
          </div>
        ))}
      </div>
    </section>
  );
}
