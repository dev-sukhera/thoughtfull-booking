FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# All dependencies (dev included): used by the test stage and to build.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS test
COPY . .
RUN npx prisma generate

FROM test AS build
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
EXPOSE 4000
# Apply migrations, seed demo data if the DB is empty, then start API + reminder worker.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/index.js"]
