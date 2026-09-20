# syntax=docker/dockerfile:1
# Runtime: Deno + dosbox-staging + JWasm (headless offscreen, no xorg)
FROM fedora:41
RUN dnf install -y dosbox-staging make gcc git unzip curl \
    && dnf clean all \
    && curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno \
    && deno --version \
    && dosbox-staging --version || dosbox --version

WORKDIR /app
COPY deno.json deno.lock main.ts ./
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

CMD ["deno","run","--allow-net","--allow-read","--allow-write","--allow-run","--allow-env","main.ts"]