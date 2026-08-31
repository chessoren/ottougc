# The fleet, as one container.
#
# Cloud Run runs this as a service and Cloud Scheduler wakes it on the fleet's
# clock by calling its own `/api/cron/*` endpoints. That indirection is not
# decoration: it means the scheduled path and the path an operator triggers by
# hand are the same code, so a job that works when you click it works at 07:00.
#
# Two things make this image bigger than a normal Next build, and both are
# load-bearing:
#
#   - **Chromium.** Remotion renders by driving a real browser. There is no
#     headless-free path to a 1080x1920 60fps MP4 from a React timeline.
#   - **The Remotion project.** `apps/video` is not a build-time dependency of
#     the web app; the renderer bundles it at run time, from source.

FROM node:22-bookworm-slim

# Chromium's own runtime dependencies. Remotion downloads the browser itself —
# these are the shared libraries it needs to start once it has.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 wget \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/usr/local/bin
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/video/package.json apps/video/
RUN pnpm install --frozen-lockfile

COPY . .

# Fetch the browser at build time. Doing it lazily on the first render would put
# a 150 MB download inside a request that is already several minutes long.
RUN cd apps/video && pnpm exec remotion browser ensure

RUN pnpm --filter @ottougc/web build

# Cloud Run sends the port to listen on; it is not always 8080.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@ottougc/web", "start"]
