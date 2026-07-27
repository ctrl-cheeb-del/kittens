"use client";

/**
 * A real dropdown.
 *
 * A native <select> renders the OS popup, which no amount of CSS reaches — on
 * macOS that means a dark system menu dropped onto a cream page. This is a
 * plain listbox so the menu inherits the brand like everything else.
 *
 * Keeps the keyboard contract a select has: Enter/Space/arrows to open, arrows
 * to move, Enter to pick, Escape to dismiss, click-away to close.
 */

import { useEffect, useRef, useState } from "react";

export interface Choice {
  id: string;
  name: string;
  hint?: string;
}

export function ViewPicker({
  choices,
  value,
  onChange,
}: {
  choices: readonly Choice[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, choices.findIndex((c) => c.id === value)),
  );
  const root = useRef<HTMLDivElement>(null);
  const current = choices.find((c) => c.id === value) ?? choices[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.max(0, choices.findIndex((c) => c.id === value)));
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % choices.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + choices.length) % choices.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(choices[active].id);
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        {current.name}
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className={`h-3 w-3 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="View"
          className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg shadow-graphite/10"
        >
          {choices.map((c, i) => {
            const selected = c.id === value;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c.id)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    i === active ? "bg-muted" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-[3px] w-3.5 shrink-0 text-[11px] ${
                      selected ? "text-canopy" : "text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm ${
                        selected ? "font-semibold text-ink" : "text-ink"
                      }`}
                    >
                      {c.name}
                    </span>
                    {c.hint && (
                      <span className="block text-[12px] leading-snug text-muted-foreground">
                        {c.hint}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
