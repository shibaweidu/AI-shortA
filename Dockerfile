FROM node:22-bookworm-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS frontend-deps
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY --from=frontend-deps /app/frontend/node_modules ./frontend/node_modules
COPY backend ./backend
COPY frontend ./frontend
RUN cd /app/backend && npm run build
RUN cd /app/frontend && npm run build
RUN cd /app/backend && npm prune --omit=dev

FROM node:22-bookworm-slim AS app
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV FRONTEND_DIST_DIR=/app/frontend/dist
COPY --from=build /app/backend/package*.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/migrations ./migrations
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 8787
CMD ["/app/docker-entrypoint.sh"]
