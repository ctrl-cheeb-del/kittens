/**
 * The chunky button from revnu's brand book: a front surface sitting on a
 * slightly darker shadow lip, where :active drops the front 4px onto the
 * shadow. That mechanic is the whole visual identity of a revnu button, so it
 * is reproduced here rather than approximated with a flat fill.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "light";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  children,
  className = "",
  ...props
}: Props) {
  const isPrimary = variant === "primary";

  return (
    <button
      className={`group relative inline-flex h-11 items-start rounded-full
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]
        focus-visible:ring-offset-2 focus-visible:ring-offset-background
        disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 top-1 rounded-full ${
          isPrimary ? "bg-[hsl(var(--primary-shadow))]" : "bg-chalk"
        }`}
      />
      <span
        className={`relative inline-flex h-10 w-full items-center justify-center gap-2
          whitespace-nowrap rounded-full px-7 text-sm font-medium
          transition-transform duration-75 group-active:translate-y-1 ${
            isPrimary
              ? "bg-primary text-primary-foreground group-hover:bg-primary-hover"
              : "border border-line bg-snow text-pitch group-hover:bg-white"
          }`}
      >
        {children}
      </span>
    </button>
  );
}
