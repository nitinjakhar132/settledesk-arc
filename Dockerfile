FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV SETTLEDESK_DB=/app/data/settledesk.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
