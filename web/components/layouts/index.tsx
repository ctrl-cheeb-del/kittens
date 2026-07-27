"use client";

/**
 * There is one report. The other two entries are lenses on the same data at a
 * level the default deliberately summarises, so this is a small view picker
 * rather than a row of layout options.
 */

import { useEffect, useState } from "react";
import type { Classification } from "@/lib/classify";
import type { Section } from "@/lib/sections";
import type { Fingerprint } from "@/lib/types";
import { ViewPicker as Picker } from "./ViewPicker";
import { Hexdump, Overview, Periodic } from "./variants";

export const VIEWS = [
  { id: "overview", name: "Overview", hint: "counts, fingerprints and signals" },
  { id: "periodic", name: "All values", hint: "every cipher, extension and group" },
  { id: "hexdump", name: "Raw bytes", hint: "the ClientHello, annotated" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

const STORAGE_KEY = "kittens:view";
const DEFAULT: ViewId = "overview";

export function useView(): [ViewId, (id: ViewId) => void] {
  const [view, setView] = useState<ViewId>(DEFAULT);

  // Read after mount: this is a static export, so touching localStorage during
  // render would mismatch on hydration.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ViewId | null;
    if (saved && VIEWS.some((v) => v.id === saved)) setView(saved);
  }, []);

  const choose = (id: ViewId) => {
    setView(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private mode. Not worth surfacing.
    }
  };

  return [view, choose];
}

export function ViewPicker({
  value,
  onChange,
}: {
  value: ViewId;
  onChange: (id: ViewId) => void;
}) {
  return (
    <Picker
      choices={VIEWS}
      value={value}
      onChange={(id) => onChange(id as ViewId)}
    />
  );
}

export function Report({
  view,
  fp,
  verdict,
  sections,
}: {
  view: ViewId;
  fp: Fingerprint;
  verdict: Classification;
  sections: Section[];
}) {
  switch (view) {
    case "periodic":
      return <Periodic fp={fp} />;
    case "hexdump":
      return <Hexdump fp={fp} />;
    default:
      return <Overview fp={fp} verdict={verdict} sections={sections} />;
  }
}
