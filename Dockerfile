# ---- Build admin dashboard ----
FROM node:20-alpine AS admin-build
WORKDIR /app

RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev vips-dev

COPY package.json package-lock.json ./
COPY packages/admin/package.json ./packages/admin/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/api/package.json ./packages/api/
RUN npm install --workspaces
COPY packages/admin ./packages/admin
COPY packages/sdk ./packages/sdk
COPY tsconfig.base.json ./
RUN npm run build --workspace=packages/admin

# ---- Production API ----
FROM node:20-alpine AS production
WORKDIR /app

# Build deps for native modules (canvas, better-sqlite3, sharp)
RUN apk add --no-cache \
    python3 make g++ \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev \
    vips-dev

# Install only production deps
COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/sdk/package.json ./packages/sdk/
RUN npm install --workspaces --omit=dev

# Copy source
COPY packages/api ./packages/api
COPY packages/sdk ./packages/sdk
COPY tsconfig.base.json ./

# Copy built admin dashboard into API's public folder
COPY --from=admin-build /app/packages/api/public ./packages/api/public

# Build TypeScript
RUN npm run build --workspace=packages/api

# Create storage directory
RUN mkdir -p /data/storage /data/db

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
