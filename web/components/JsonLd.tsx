/**
 * Structured data, emitted into the static HTML.
 *
 * Worth the bytes for a tool like this: the pages that describe JA3 and JA4 are
 * definitional, and a crawler or an assistant reading them benefits from being
 * told plainly that this is a free, no-signup diagnostic rather than having to
 * infer it from prose.
 */

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // The payload is authored here, never user input, so there is nothing to
      // escape beyond the closing-tag sequence JSON.stringify cannot produce.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
