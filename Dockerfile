# syntax=docker/dockerfile:1
# Runtime: Node.js + dosbox-staging + JWasm (headless offscreen, no xorg)
ARG NODE_VERSION=v24.21.0
ARG NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6

FROM fedora:41
ARG NODE_VERSION
ARG NODE_SHA256
RUN dnf install -y dosbox-staging make gcc git unzip curl xz \
    && dnf clean all \
    && curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
    && echo "${NODE_SHA256}  node-${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c - \
    && tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-${NODE_VERSION}-linux-x64.tar.xz" \
    && node --version \
    && npm --version \
    && dosbox-staging --version || dosbox --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY main.ts ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY sandbox/ ./sandbox/
COPY tools/ ./tools/
COPY scripts/ ./scripts/

# Build JWasm native (built Linux binary tools/jwasm/jwasm stays gitignored)
RUN bash scripts/setup-fedora.sh || (echo "fallback jwasm build" && make -f GccUnix.mak CC="gcc -std=gnu17" -j$(nproc) -C /tmp 2>/dev/null || true)

ENV PORT=3001
ENV DOSBOX_PATH=/usr/bin/dosbox-staging
ENV JWASM_PATH=/app/tools/jwasm/jwasm
ENV SDL_VIDEODRIVER=offscreen
ENV SDL_AUDIODRIVER=dummy
ENV SDL_RENDER_DRIVER=software
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node","main.ts"]
