import type { Config } from "tailwindcss";

// Tokens mirror revnu's brand book (revnu2/DESIGN.md) so kittens sits in the
// same family. Prefer the named brand colors over raw hex.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        card: "hsl(var(--card))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },

        // Brand aliases, same as revnu.
        cream: "hsl(var(--background))",
        ink: "hsl(var(--foreground))",
        line: "hsl(var(--border))",

        // Named brand colors from the brand book.
        canopy: "#1C8F4C",
        sprout: "#22C55E",
        moss: "#14663A",
        undergrowth: "#082B17",
        terracotta: "#C65D3B",
        pitch: "#171717",
        graphite: "#2A2A2A",
        snow: "#FEFEFE",
        cloud: "#F0F0F0",
        chalk: "#E5E5E5",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        display: ["var(--font-display)", "-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
      },
      letterSpacing: {
        tighter: "-0.025em",
      },
      transitionTimingFunction: {
        swoosh: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
