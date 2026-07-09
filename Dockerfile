# TrialBridge web app (Next.js 15 + Prisma/SQLite). Local-docker image.
FROM node:22-slim

WORKDIR /app

# openssl is required by Prisma's query engine at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (postinstall runs `prisma generate`, so the schema must be present).
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# App source + production build.
COPY . .
RUN ./node_modules/.bin/prisma generate \
  && ./node_modules/.bin/next build

EXPOSE 3000

# On boot: create/sync the SQLite schema on the mounted volume (prisma/data),
# then serve. `db push` is idempotent, so restarts are safe. The DB starts empty.
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && ./node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
