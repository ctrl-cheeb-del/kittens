/**
 * The frame every page sits in: masthead, footer, and the article shell the
 * written pages share.
 *
 * The footer carries a full link grid rather than just the meta row. With a
 * static export there is no crawl-friendly navigation anywhere else, and a
 * sitewide grid puts every page one click from every other — which is also
 * how a reader who arrived on /ja3 from a search finds /guides/ua-mismatch.
 */

import { Toc } from "@/components/Toc";

// Relative, so links work on whatever host this is served from.
const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN_URL ?? "";

export const REPO_URL = "https://github.com/ctrl-cheeb-del/kittens";

const FINGERPRINTS: [string, string][] = [
  ["/ja4/", "JA4"],
  ["/ja3/", "JA3"],
  ["/akamai/", "Akamai HTTP/2"],
];

const GUIDES: [string, string][] = [
  ["/guides/curl-impersonate/", "Verify curl-impersonate"],
  ["/guides/ua-mismatch/", "User-Agent mismatches"],
  ["/guides/ci-assertions/", "Pin a fingerprint in CI"],
];

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-6 py-5 lg:px-8">
        <a href="/" className="font-display text-lg font-extrabold tracking-tight">
          kittens<span className="text-canopy">.sh</span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/" className="transition-colors hover:text-ink">
            Inspect
          </a>
          <a href="/about/" className="transition-colors hover:text-ink">
            About
          </a>
          <a href="/docs/" className="transition-colors hover:text-ink">
            Docs
          </a>
          <a href={`${ORIGIN}/api/all`} className="transition-colors hover:text-ink">
            API
          </a>
        </nav>
      </div>
    </header>
  );
}

function LinkColumn({
  heading,
  links,
}: {
  heading: string;
  links: [string, string][];
}) {
  return (
    <div>
      <p className="label mb-3">{heading}</p>
      <ul className="space-y-1.5 text-sm">
        {links.map(([href, text]) => (
          <li key={href}>
            <a
              href={href}
              className="text-muted-foreground underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-10 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-3">
          <LinkColumn heading="Fingerprints" links={FINGERPRINTS} />
          <LinkColumn heading="Guides" links={GUIDES} />
          <LinkColumn
            heading="Reference"
            links={[
              ["/", "Inspect your connection"],
              ["/about/", "About this service"],
              ["/docs/", "API documentation"],
              [REPO_URL, "Source on GitHub"],
            ]}
          />
        </div>

        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-sm text-muted-foreground">
          <span>Measured from your connection. Nothing is stored.</span>
          <span className="font-mono text-[11px]">JA3 · JA4 · Akamai HTTP/2</span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span>
            Sponsored by{" "}
            <a
              href="https://revnu.com"
              className="font-medium text-canopy underline-offset-2 hover:underline"
            >
              Revnu
            </a>
          </span>
          <span>
            Made by{" "}
            <a
              href="https://freebrey.art"
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              Art Freebrey
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

/** Fixed-width block for wire data, commands and JSON. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="no-scrollbar overflow-x-auto rounded-2xl border border-line bg-card p-4 font-mono text-[12px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

/** Inline mono, for a path or a field name mid-sentence. */
export function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[13px] text-canopy">{children}</code>;
}

/** The site's pages, for the rail beside a written page. */
function SideNav() {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-10 hidden self-start space-y-7 lg:block"
    >
      <LinkColumn heading="Fingerprints" links={FINGERPRINTS} />
      <LinkColumn heading="Guides" links={GUIDES} />
      <LinkColumn
        heading="Reference"
        links={[
          ["/", "Inspect"],
          ["/about/", "About"],
          ["/docs/", "API"],
        ]}
      />
    </nav>
  );
}

/**
 * The shell for a written page.
 *
 * Three columns at full width: site nav, the prose, and the page's own
 * headings. The measure stays around 70 characters — running body text the
 * full 1240px would be roughly 150 characters a line, which nobody can read —
 * but the rails fill the width rather than leaving a column of prose stranded
 * against empty space, and both of them earn their place. The nav is also the
 * only in-body internal linking these pages have.
 */
export function Article({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1240px] px-6 lg:px-8">
        <div className="gap-10 py-14 lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:py-20 xl:grid-cols-[180px_minmax(0,1fr)_190px]">
          <SideNav />
          {/* data-md marks the region the postbuild step converts to the .md
              mirror for this page. One per page, always the prose. */}
          <article data-md className="min-w-0 max-w-[740px]">
            {children}
          </article>
          <Toc />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
