"use client";

/** Primitives every layout variant shares. */

import { useState } from "react";
import type { Extra, Field, Section } from "@/lib/sections";

/* ------------------------------------------------------------------ bits */

/** Long values can't sit in a narrow label/value pair without overflowing. */
const STACK_ABOVE = 26;

export function Strength({ weight }: { weight: number }) {
  const filled = Math.max(1, Math.min(4, weight));
  return (
    <span
      className="mt-[3px] flex shrink-0 items-end gap-[2px]"
      title={`Signal strength ${filled} of 4`}
      aria-label={`Signal strength ${filled} of 4`}
    >
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`w-[3px] rounded-[1px] ${n <= filled ? "bg-canopy" : "bg-chalk"}`}
          style={{ height: `${3 + n * 2}px` }}
        />
      ))}
    </span>
  );
}

/** Values worth copying are everything except our own placeholder text. */
const PLACEHOLDERS = new Set(["—", "not sent", "none", "0"]);

export function isCopyable(value: string) {
  return value.length > 0 && !PLACEHOLDERS.has(value);
}

/**
 * Click any value to copy it.
 *
 * Every number on this page exists to be pasted into a test, an issue or a
 * config, so copy is the default interaction rather than a feature of three
 * privileged rows. Kept chrome-free until hover so a page of copy buttons
 * doesn't read as a page of buttons.
 */
export function CopyValue({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!isCopyable(value)) {
    return <span className={className}>{value}</span>;
  }

  return (
    <button
      type="button"
      title={copied ? "Copied" : "Click to copy"}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
      className={`group/c -mx-1 max-w-full rounded px-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${className}`}
    >
      <span className="break-all">{value}</span>
      <span
        className={`ml-1.5 align-middle text-[10px] transition-opacity ${
          copied
            ? "text-canopy opacity-100"
            : "text-muted-foreground opacity-0 group-hover/c:opacity-100"
        }`}
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

export function FieldRow({ f, showStrength }: { f: Field; showStrength?: boolean }) {
  const stacked = f.value.length > STACK_ABOVE;

  if (showStrength && f.strength) {
    return (
      <li className="flex items-start gap-3 border-b border-line/60 py-2 last:border-b-0">
        <Strength weight={f.strength} />
        <span className="flex-1 text-[13px] leading-snug">{f.value}</span>
        <span
          className={`shrink-0 font-mono text-[10px] ${
            f.agrees ? "text-canopy" : "text-muted-foreground"
          }`}
        >
          {f.label}
        </span>
      </li>
    );
  }

  return (
    <div
      className={`border-b border-line/60 py-2 last:border-b-0 ${
        stacked ? "" : "grid grid-cols-[minmax(88px,40%)_1fr] items-baseline gap-3"
      }`}
    >
      <dt className={`text-[13px] text-muted-foreground ${stacked ? "mb-1" : ""}`}>
        {f.label}
      </dt>
      <dd className={`min-w-0 text-[13px] ${f.mono ? "break-all font-mono" : "break-words"}`}>
        <CopyValue value={f.value} />
      </dd>
    </div>
  );
}

export function ExtraBlock({ extra }: { extra: Extra }) {
  if (extra.kind === "code") {
    return (
      <>
        <p className="label mb-2 mt-5">{extra.label}</p>
        <p className="break-all rounded-lg border border-line bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {extra.text}
        </p>
      </>
    );
  }
  return (
    <>
      <p className="label mb-2 mt-5">{extra.label}</p>
      <div className="flex flex-wrap gap-1.5">
        {extra.items.map((p) => (
          <span
            key={p}
            className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
              p === extra.active
                ? "bg-canopy text-snow"
                : "border border-line text-muted-foreground"
            }`}
          >
            {p}
          </span>
        ))}
      </div>
    </>
  );
}

export function Body({ s, showStrength }: { s: Section; showStrength?: boolean }) {
  const isSignals = s.id === "signals" && showStrength;
  return (
    <>
      {isSignals ? (
        <ul>
          {s.fields.map((f, i) => (
            <FieldRow key={i} f={f} showStrength />
          ))}
        </ul>
      ) : (
        <dl>
          {s.fields.map((f, i) => (
            <FieldRow key={i} f={f} />
          ))}
        </dl>
      )}
      {s.extra && <ExtraBlock extra={s.extra} />}
    </>
  );
}

