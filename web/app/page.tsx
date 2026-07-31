/**
 * The home page is a server component so everything except the measurement
 * itself is in the HTML.
 *
 * The measurement cannot be: a fingerprint rendered at build time would
 * describe the build machine. That part lives in <Inspector />, which fetches
 * over the very connection that loaded this page. Everything below it is
 * static prose, and is the only thing a crawler or an assistant without
 * JavaScript will see.
 */

import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { Explainer } from "@/components/Explainer";
import { Inspector } from "@/components/Inspector";
import { JsonLd } from "@/components/JsonLd";
import { FAQ } from "@/lib/faq";
import { SITE_URL } from "@/lib/seo";

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE_URL}/#faq`,
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto w-full max-w-[1240px] px-6 lg:px-8">
        <Inspector />
        <Explainer />
      </main>

      <SiteFooter />
      <JsonLd data={FAQ_SCHEMA} />
    </div>
  );
}
