/**
 * The tape: an ordered ribbon of protocol values.
 *
 * This is the page's argument. JA3, JA4 and the Akamai fingerprint are all
 * hashes over *sequences*, so the one thing the UI must make undeniable is
 * order — hence index numbers on every cell and horizontal scroll rather than
 * wrapping, which would imply the arrangement is cosmetic.
 *
 * GREASE cells are struck through because that is exactly their fate: present
 * on the wire, excluded from every hash.
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
    <section className="tape-block">
      <div className="tape-head">
        <span className="tape-title">{title}</span>
        <span className="tape-count">
          {counted} hashed
          {greased > 0 ? ` · ${greased} GREASE discarded` : ""}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
      <div className="tape" role="list" aria-label={title}>
        {cells.map((c, i) => (
          <div
            role="listitem"
            className={c.grease ? "cell grease" : "cell"}
            key={`${c.hex}-${i}`}
            title={c.grease ? `${c.hex} — GREASE, excluded from hashes` : `${c.hex} ${c.name}`}
          >
            <span className="cell-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="cell-hex">{c.hex}</span>
            <span className="cell-name">{c.grease ? "GREASE" : c.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
