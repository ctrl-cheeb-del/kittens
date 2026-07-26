# One image, one host: the Rust binary serves both the API and the exported
# site, so the page and the fingerprint share a TLS connection.

# --- 1. Export the static site -------------------------------------------
FROM node:22-slim AS web

WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# `output: "export"` in next.config.ts writes plain files to out/.
RUN npm run build


# --- 2. Build the server --------------------------------------------------
FROM rust:1.87-slim-bookworm AS server

WORKDIR /build

# Dependencies are built against a stub main so that editing src/ doesn't
# invalidate the whole dependency layer.
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY server/src ./src
# cargo keys off mtime; the stub build above leaves it looking unchanged.
RUN touch src/main.rs && cargo build --release


# --- 3. Runtime -----------------------------------------------------------
FROM debian:bookworm-slim

# ca-certificates: validates Let's Encrypt's ACME directory.
# util-linux: provides setpriv, used by the entrypoint to drop privileges.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home kittens

COPY --from=server /build/target/release/kittens /usr/local/bin/kittens
COPY --from=web /web/out /srv/site
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV KITTENS_STATIC_DIR=/srv/site

EXPOSE 443

# Starts as root only long enough to take ownership of the mounted volume,
# then execs the server as an unprivileged user.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
