FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS dev
WORKDIR /app
RUN apk add --no-cache ffmpeg \
  && corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "start:dev"]

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nodejs -u 1001 \
  && mkdir -p /var/lib/lesson-imports \
  && chown -R nodejs:nodejs /var/lib/lesson-imports
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json ./
USER nodejs
EXPOSE 3000
CMD ["node", "dist/main"]
