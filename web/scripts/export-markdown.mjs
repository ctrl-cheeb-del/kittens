/**
 * Emit a plain-text mirror of every written page, plus llms-full.txt.
 *
 * Runs as `postbuild`, so it reads the HTML Next just exported rather than a
 * second copy of the prose. That is the whole point: a hand-maintained
 * markdown twin of nine pages drifts within a week, and a stale mirror is
 * worse than none — it is the version an assistant quotes.
 *
 * Each page marks its prose with `data-md`. Everything outside it (masthead,
 * footer link grid, the live fingerprint) is chrome and is dropped.
 *
 * No dependencies: the HTML here is our own output, so the small set of tags
 * it can contain is known. A general-purpose parser would be the right call
 * against arbitrary input, and the wrong one against this.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath rather than .pathname: the latter leaves percent-encoding in
// place, so a checkout under a directory with a space in it would resolve to a
// path that does not exist.
const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kittens.sh";

/** Page order, matching the sitemap. Path → output slug. */
const PAGES = [
  ["/", "index"],
  ["/about/", "about"],
  ["/ja4/", "ja4"],
  ["/ja3/", "ja3"],
  ["/akamai/", "akamai"],
  ["/docs/", "docs"],
  ["/guides/curl-impersonate/", "guides/curl-impersonate"],
  ["/guides/ua-mismatch/", "guides/ua-mismatch"],
  ["/guides/ci-assertions/", "guides/ci-assertions"],
];

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
  rarr: "→", larr: "←", times: "×",
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Named last, so a literal "&amp;lt;" decodes to "&lt;" and stops there.
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

const stripTags = (s) => s.replace(/<[^>]+>/g, "");

/**
 * Inner HTML of the single element carrying `data-md`, matched by counting
 * opens and closes of its own tag name so nesting does not truncate it.
 */
function extractRegion(html) {
  const open = /<(article|section|details)\b[^>]*\bdata-md\b[^>]*>/i.exec(html);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const start = open.index + open[0].length;
  const scan = new RegExp(`<(/?)${tag}\\b`, "gi");
  scan.lastIndex = start;
  let depth = 1;
  for (let m; (m = scan.exec(html)); ) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return null;
}

/** Links, emphasis and inline code — anything legal inside a table cell. */
function inline(html) {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const label = inline(text).replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("#")) return label;
      return `[${label}](${href.startsWith("/") ? SITE + href : href})`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${inline(t).trim()}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${inline(t).trim()}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${decode(stripTags(t)).trim()}\``)
    .replace(/<[^>]+>/g, "");
}

const cell = (html) =>
  decode(inline(html)).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

function tableToMarkdown(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cell(c[1])),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const [head, ...body] = rows;
  return [
    `| ${pad(head).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((r) => `| ${pad(r).join(" | ")} |`),
  ].join("\n");
}

const tidy = (t) => inline(t).replace(/\s+/g, " ").trim();

/**
 * `shift` demotes every heading, so a page's own h1 sits under the document
 * title rather than competing with it — one level in a standalone .md, two in
 * llms-full.txt where each page is already a section.
 */
function toMarkdown(fragment, shift = 0) {
  let html = fragment
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "")
    // The disclosure toggle is UI, and its label repeats the heading below it.
    .replace(/<summary\b[\s\S]*?<\/summary>/gi, "");

  // Code and tables come out first and go back in last: their contents would
  // otherwise be mangled by every rule below, the whitespace collapse most of
  // all. NUL delimits the placeholder because it cannot occur in the exported
  // HTML and nothing downstream touches it.
  const blocks = [];
  const hold = (kind, text) => `\0${blocks.push({ kind, text }) - 1}\0`;

  html = html.replace(
    /<pre\b[^>]*>(?:\s*<code\b[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/gi,
    (_, body) => hold("code", decode(stripTags(body)).replace(/^\n+|\s+$/g, "")),
  );
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, body) =>
    hold("table", tableToMarkdown(body)),
  );

  html = html
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) =>
      `\n\n${"#".repeat(Math.min(6, Number(n) + shift))} ${tidy(t)}\n\n`)
    .replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, (_, t) => `\n\n**${tidy(t)}**\n\n`)
    .replace(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, (_, t) => `${tidy(t)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${tidy(t)}`)
    .replace(/<\/(p|div|ul|ol|dl|section|h[1-6])>/gi, "\n\n");

  let md = decode(inline(html))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  md = md.replace(/\0(\d+)\0/g, (_, i) => {
    const { kind, text } = blocks[Number(i)];
    return kind === "code" ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : `\n\n${text}\n\n`;
  });

  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const meta = (html, re) => decode((re.exec(html)?.[1] ?? "").trim());

async function main() {
  const sections = [];

  for (const [path, slug] of PAGES) {
    const file = join(OUT, path === "/" ? "index.html" : `${path}index.html`);
    let html;
    try {
      html = await readFile(file, "utf8");
    } catch {
      console.warn(`export-markdown: no export at ${path}, skipping`);
      continue;
    }

    const region = extractRegion(html);
    if (!region) {
      console.warn(`export-markdown: no [data-md] region in ${path}, skipping`);
      continue;
    }

    const title = meta(html, /<title>([\s\S]*?)<\/title>/i);
    const description = meta(html, /<meta name="description" content="([^"]*)"/i);
    const url = SITE + path;

    const dest = join(OUT, `${slug}.md`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(
      dest,
      `# ${title}\n\n> ${description}\n\nURL: ${url}\n\n${toMarkdown(region, 1)}`,
    );

    sections.push({ url, title, description, body: toMarkdown(region, 2) });
    console.log(`export-markdown: ${slug}.md`);
  }

  const full = [
    "# kittens.sh — complete text",
    "",
    "> Every page of kittens.sh in one file, generated at build time from the",
    "> published HTML. kittens.sh reports the JA3, JA4 and Akamai HTTP/2",
    "> fingerprint of the connection that reaches it, decoded field by field,",
    "> over a free JSON API with no key. Each page is also available on its own",
    "> as <page-url>.md — for example https://kittens.sh/ja4.md.",
    "",
    ...sections.flatMap(({ url, title, description, body }) => [
      "---",
      "",
      `## ${title}`,
      "",
      `> ${description}`,
      "",
      `URL: ${url}`,
      "",
      body,
    ]),
  ].join("\n");

  await writeFile(join(OUT, "llms-full.txt"), full);
  console.log(`export-markdown: llms-full.txt (${full.split(/\s+/).length} words)`);
}

await main();
