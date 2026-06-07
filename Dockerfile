# Portable container image for the Feral Myth: Realms game server.
# Works on Fly.io, Railway, a VPS, or any container host.
# Build context must be the MONOREPO ROOT (so npm workspaces can resolve
# @fmr/shared, which esbuild inlines into the server bundle).
#
#   docker build -t fmr-server .
#   docker run -p 2567:2567 --env-file apps/server/.env fmr-server

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Install all workspace deps (cached unless a package.json changes)
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/
RUN npm install

# Copy sources and bundle the server (esbuild → apps/server/dist/index.js)
COPY . .
RUN npm run build:server && npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Bring only what the runtime needs: pruned node_modules + the server bundle.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

EXPOSE 2567
CMD ["node", "apps/server/dist/index.js"]
