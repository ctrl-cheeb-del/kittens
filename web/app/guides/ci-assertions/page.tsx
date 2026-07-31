import { Article, C, Code } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, techArticle } from "@/lib/seo";

const TITLE = "Pin a TLS fingerprint in CI";
const DESCRIPTION =
  "Assert that your HTTP client's JA4 and HTTP/2 fingerprint have not drifted, in bash, GitHub Actions or pytest — so a dependency bump that changes your handshake fails the build instead of production.";
const PATH = "/guides/ci-assertions/";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

export default function Guide() {
  return (
    <Article>
      <h1 className="h1 mb-4">Pin a fingerprint in CI</h1>
      <p className="lede mb-10">
        A TLS fingerprint is a good regression test for one specific reason: it
        changes when your TLS stack changes, including every time you did not
        mean to change it. A patch release of a transitive dependency can move
        it. Nothing else in your test suite will notice.
      </p>

      <h2 className="h2 mb-4 mt-12">The minimal version</h2>
      <p className="lede mb-4">
        <C>/api/ja4</C> returns the fingerprint as plain text with no JSON to
        parse, which makes the whole assertion a string comparison.
      </p>
      <Code>{`#!/usr/bin/env bash
set -euo pipefail

EXPECTED="t13d1516h2_8daaf6152771_e5627efa2ab1"
GOT=$(curl -s https://kittens.sh/api/ja4)

if [ "$GOT" != "$EXPECTED" ]; then
  echo "TLS fingerprint drifted" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  got:      $GOT" >&2
  exit 1
fi`}</Code>
      <p className="lede mt-4">
        Replace <C>curl</C> with whatever client you actually ship — the point is
        to measure the client under test, not the one your CI image happens to
        have.
      </p>

      <h2 className="h2 mb-4 mt-12">Make the failure readable</h2>
      <p className="lede mb-4">
        A diff of two hashes tells you something broke and nothing about what.{" "}
        <C>/api/ja4/raw</C> returns the fingerprint with both hashed halves
        expanded into the lists they were built from, so the failure output
        points at the cipher or extension that moved.
      </p>
      <Code>{`curl -s https://kittens.sh/api/ja4/raw > got.txt
diff -u expected.txt got.txt || {
  echo "handshake changed — review before updating the fixture" >&2
  exit 1
}`}</Code>
      <p className="lede mt-4">
        Commit <C>expected.txt</C>. When it legitimately changes, the diff in the
        pull request is the review.
      </p>

      <h2 className="h2 mb-4 mt-12">GitHub Actions</h2>
      <Code>{`name: fingerprint
on: [push, pull_request]

jobs:
  ja4:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Assert the handshake has not drifted
        run: |
          GOT=$(curl -s https://kittens.sh/api/ja4)
          echo "ja4: $GOT"
          test "$GOT" = "$(cat .github/expected-ja4.txt)"`}</Code>

      <h2 className="h2 mb-4 mt-12">pytest</h2>
      <Code>{`import httpx
import pytest

EXPECTED_JA4 = "t13d1516h2_8daaf6152771_e5627efa2ab1"


@pytest.mark.network
def test_client_fingerprint_has_not_drifted(client: httpx.Client):
    fp = client.get("https://kittens.sh/api/clean").json()
    assert fp["ja4"] == EXPECTED_JA4, (
        f"handshake changed: {fp['ja4']}. "
        "If this was intentional, update the fixture."
    )`}</Code>
      <p className="lede mt-4">
        Pass the same configured client your application uses. A fixture that
        builds a fresh default client tests the default, which is not the thing
        you are trying to protect.
      </p>

      <h2 className="h2 mb-4 mt-12">Four things that will bite</h2>
      <div className="space-y-4 text-base text-muted-foreground">
        <p>
          <strong className="font-semibold text-ink">
            Do not pin a browser JA3.
          </strong>{" "}
          Chrome randomises its extension order, so its{" "}
          <a href="/ja3/" className="text-canopy underline-offset-2 hover:underline">
            JA3
          </a>{" "}
          differs on every connection and the test fails immediately and
          forever. Pin{" "}
          <a href="/ja4/" className="text-canopy underline-offset-2 hover:underline">
            JA4
          </a>
          , which sorts before hashing. Scripted clients that do not randomise
          are safe to pin either way.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            Pin the HTTP/2 fingerprint too, separately.
          </strong>{" "}
          <C>akamai_hash</C> comes from a different layer and moves
          independently. A client can keep its JA4 across an upgrade and change
          its SETTINGS frame.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            The network is a dependency.
          </strong>{" "}
          This assertion needs egress, and it measures whatever finally reaches
          the origin — so a CI proxy that terminates TLS will be what gets
          fingerprinted. Mark the test so it can be skipped where there is no
          direct egress rather than letting it fail confusingly.
        </p>
        <p>
          <strong className="font-semibold text-ink">
            A red build is information, not a bug.
          </strong>{" "}
          The fingerprint changing means your TLS stack changed. Sometimes that
          is a deliberate upgrade and the fixture should be updated in the same
          commit. The value is in being told, rather than finding out from
          production traffic weeks later.
        </p>
      </div>

      <h2 className="h2 mb-4 mt-12">Related</h2>
      <p className="lede">
        <a
          href="/guides/curl-impersonate/"
          className="text-canopy underline-offset-2 hover:underline"
        >
          Verifying an impersonation library
        </a>{" "}
        covers getting the target fingerprint in the first place, and{" "}
        <a href="/docs/" className="text-canopy underline-offset-2 hover:underline">
          the API reference
        </a>{" "}
        lists every endpoint.
      </p>

      <JsonLd
        data={techArticle({ title: TITLE, description: DESCRIPTION, path: PATH })}
      />
    </Article>
  );
}
