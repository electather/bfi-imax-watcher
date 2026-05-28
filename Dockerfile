# Pinned to the same version as the playwright npm package (CON-002). The image
# ships Node + a matching Chromium build, so no separate browser download is
# needed. This tag MUST track the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install dependencies first so this layer is cached unless the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

# Build the TypeScript sources to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies to slim the runtime image.
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
