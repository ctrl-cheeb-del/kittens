/**
 * The mascot, and the fastest read on the page.
 *
 * Three moods, driven by the verdict rather than decoration:
 *   content     the handshake agrees with the User-Agent
 *   suspicious  they disagree, which is the one alarming state here
 *   curious     not enough signal to say
 *
 * Line art on currentColor so it inherits canopy, terracotta or muted from the
 * verdict without a second palette.
 */

export type Mood = "content" | "suspicious" | "curious";

export function Cat({ mood, className = "" }: { mood: Mood; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={
        mood === "content"
          ? "Content cat: the handshake matches the User-Agent"
          : mood === "suspicious"
            ? "Suspicious cat: the handshake and User-Agent disagree"
            : "Curious cat: not enough signal to judge"
      }
    >
      {/* Ears. The suspicious cat flattens them back. */}
      {mood === "suspicious" ? (
        <>
          <path d="M15 27 L9 17 L25 20" />
          <path d="M49 27 L55 17 L39 20" />
        </>
      ) : (
        <>
          <path d="M17 25 L15 9 L29 18" />
          <path d="M47 25 L49 9 L35 18" />
        </>
      )}

      {/* Head */}
      <path d="M32 15c11 0 19 8 19 19.5S43 52 32 52 13 45 13 34.5 21 15 32 15z" />

      {/* Eyes */}
      {mood === "content" && (
        <>
          <path d="M21.5 32.5c2-3.2 5.5-3.2 7.5 0" />
          <path d="M35 32.5c2-3.2 5.5-3.2 7.5 0" />
        </>
      )}
      {mood === "suspicious" && (
        <>
          {/* Narrowed eyes plus a raised brow: side-eye. */}
          <path d="M21.5 33.5h7.5" />
          <path d="M35 33.5h7.5" />
          <path d="M20.5 28l8.5 1.8" opacity={0.55} />
          <path d="M43.5 28L35 29.8" opacity={0.55} />
        </>
      )}
      {mood === "curious" && (
        <>
          <circle cx="25.2" cy="32.5" r="2.7" fill="currentColor" stroke="none" />
          <circle cx="38.8" cy="32.5" r="2.7" fill="currentColor" stroke="none" />
        </>
      )}

      {/* Nose */}
      <path d="M29.8 38.5h4.4L32 41.5z" fill="currentColor" stroke="none" />

      {/* Mouth */}
      {mood === "content" && (
        <>
          <path d="M32 41.5c-2.6 4-6.5 2-6.5 2" />
          <path d="M32 41.5c2.6 4 6.5 2 6.5 2" />
        </>
      )}
      {mood === "suspicious" && <path d="M27 45.5h10" />}
      {mood === "curious" && (
        <circle cx="32" cy="45" r="2" fill="none" strokeWidth={2} />
      )}

      {/* Whiskers */}
      <g opacity={0.4}>
        <path d="M6 33h9M6 39.5h9M58 33h-9M58 39.5h-9" />
      </g>
    </svg>
  );
}
