# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/kiosk/package.json packages/kiosk/
COPY packages/kazimod/package.json packages/kazimod/
COPY packages/ring/package.json packages/ring/
COPY packages/family/package.json packages/family/
RUN bun install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/ring packages/ring
RUN bun build --compile --target=bun-linux-x64 packages/ring/src/index.ts --outfile /ring

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /ring /usr/local/bin/ring
USER nobody
EXPOSE 8089
ENTRYPOINT ["ring"]
