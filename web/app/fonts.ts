import { DM_Mono, DM_Sans, Hanken_Grotesk } from "next/font/google";

// Mirrors revnu's font slots so the two products read as one family.
// Body / UI copy.
export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "700"],
});

// Fingerprints, hex values, header names. Everything this site measures is
// fixed-width protocol data, so mono does a lot of the work here.
export const dmMono = DM_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["300", "400", "500"],
});

// Display slot. Brand spec calls for Roc Grotesk (paid); Hanken Grotesk is the
// same stand-in revnu uses until the licensed files are dropped in.
export const display = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["500", "700", "800"],
});
