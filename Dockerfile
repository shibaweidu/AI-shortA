FROM node:22-bookworm-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS frontend-deps
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=development
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY --from=frontend-deps /app/frontend/node_modules ./frontend/node_modules
COPY backend ./backend
COPY frontend ./frontend
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 5173 8787
CMD ["./docker-entrypoint.sh"]
