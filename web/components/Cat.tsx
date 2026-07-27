/**
 * The mascot: the classic anonymous ASCII cat, with the face swapped per
 * verdict. Rendered as text in the mono face rather than an icon, which suits
 * a site whose entire subject is bytes on a wire.
 *
 * The /\_/\ cat is traditional unattributed ASCII art (asciiart.eu lists it
 * unsigned, unlike the larger pieces there which carry artist initials).
 */

export type Mood = "content" | "suspicious" | "curious";

// Same three-line frame, different face. Kept as arrays so the backslashes
// stay literal and the columns line up exactly.
const FACES: Record<Mood, { lines: string[]; alt: string }> = {
  content: {
    lines: [" /\\_/\\ ", "( ^.^ )", " > ^ < "],
    alt: "Happy ASCII cat: the handshake matches the User-Agent",
  },
  suspicious: {
    lines: [" /\\_/\\ ", "( -.- )", " > ~ < "],
    alt: "Unimpressed ASCII cat: the handshake and User-Agent disagree",
  },
  curious: {
    lines: [" /\\_/\\ ", "( o.o )", " > ^ < "],
    alt: "Curious ASCII cat: not enough signal to judge",
  },
};

export function Cat({ mood, className = "" }: { mood: Mood; className?: string }) {
  const { lines, alt } = FACES[mood];
  return (
    <pre
      aria-label={alt}
      role="img"
      className={`select-none whitespace-pre font-mono text-[15px] font-medium leading-[1.25] ${className}`}
    >
      {lines.join("\n")}
    </pre>
  );
}
