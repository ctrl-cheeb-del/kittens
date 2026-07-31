"use client";

/**
 * "On this page", built from the DOM rather than from a list each page has to
 * declare and keep in step with its own headings. Same reasoning as the
 * markdown mirrors: a hand-maintained copy of a page's structure is a copy
 * that goes stale, and a table of contents that lies is worse than none.
 *
 * It also assigns the ids, so the headings themselves stay plain <h2>s. This
 * is navigation, not content — the headings are already in the static HTML for
 * anything that reads the page without running JavaScript.
 */

import { useEffect, useState } from "react";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function Toc() {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);

  useEffect(() => {
    const headings = Array.from(
      document.querySelectorAll<HTMLHeadingElement>("article[data-md] h2"),
    );
    setItems(
      headings.map((h) => {
        const text = h.textContent ?? "";
        if (!h.id) h.id = slug(text);
        return { id: h.id, text };
      }),
    );
  }, []);

  if (items.length < 2) return null;

  return (
    <nav
      aria-label="On this page"
      className="sticky top-10 hidden self-start xl:block"
    >
      <p className="label mb-3">On this page</p>
      <ul className="space-y-2 border-l border-line">
        {items.map(({ id, text }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="-ml-px block border-l border-transparent pl-3 text-sm leading-snug text-muted-foreground transition-colors hover:border-canopy hover:text-ink"
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
