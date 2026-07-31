/**
 * One source for the home page FAQ.
 *
 * Rendered visibly by the explainer and emitted as FAQPage structured data
 * from the same array, because answers that appear only in the markup and not
 * on the page are exactly what the structured-data guidelines prohibit.
 * Plain strings, so the two can never drift.
 */

export type Faq = { q: string; a: string };

export const FAQ: Faq[] = [
  {
    q: "What is a TLS fingerprint?",
    a: "A short string derived from the TLS ClientHello your client sends before any HTTP request exists. It hashes which cipher suites, extensions and elliptic curves were offered, and in some schemes the order they were offered in. Because those choices come from the TLS library rather than from anything you configure per-request, the result identifies the software making the connection.",
  },
  {
    q: "How do I check my own JA3 and JA4 fingerprint?",
    a: "Load this page in the client you want to measure, or call the API from it: curl -s https://kittens.sh/api/clean returns the JA3 hash, the JA4 fingerprint and the Akamai HTTP/2 hash as JSON. The response always describes the connection it arrived on, so whatever you call it with is what gets measured.",
  },
  {
    q: "Is JA3 still reliable?",
    a: "Not for identifying browsers. JA3 hashes the extension list in the order sent, and Chrome began randomising that order in 2023, so one browser produces a different JA3 on every connection. It remains useful for clients that do not randomise, which includes most scripted tooling, and it is still widely present in threat intelligence feeds. JA4 sorts the lists before hashing and is stable across the same clients.",
  },
  {
    q: "Why does my User-Agent not match my TLS fingerprint?",
    a: "Because the two are set in different places. The User-Agent is a header your code chooses freely; the fingerprint falls out of the TLS library actually performing the handshake. Setting a Chrome User-Agent on a Python requests session changes the header and nothing about the handshake, so the connection announces Python while the header claims Chrome. Servers that compare the two treat the disagreement as a strong signal.",
  },
  {
    q: "Can I change my TLS fingerprint?",
    a: "Yes, but not by setting headers. It requires a client that lets you control the handshake itself: curl-impersonate and curl_cffi ship browser-matched builds, and libraries such as tls-client and rnet expose the cipher and extension ordering directly. Whether a given build still matches its target after a dependency update is the thing worth checking empirically.",
  },
  {
    q: "Does kittens.sh store anything?",
    a: "No. The fingerprint is computed from the live connection and returned on that same connection. Nothing is written to disk, responses are never cached, and there is no key or account to create.",
  },
];
