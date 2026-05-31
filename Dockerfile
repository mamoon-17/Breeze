# -------------------------
# Build React frontend
# -------------------------
FROM node:22 as frontend-builder

WORKDIR /frontend

COPY ./frontend/package*.json ./

RUN npm ci

COPY ./frontend ./

# Same-origin API + WebSocket through nginx in the production image.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# -------------------------
# Build backend
# -------------------------
FROM node:22 as backend-builder

WORKDIR /backend

COPY ./backend/package*.json ./

RUN npm ci

COPY ./backend .

RUN npm run build

# -------------------------
# Runtime image
# -------------------------
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/*

# Drop the default nginx site so our config is the only one.
RUN rm -f /etc/nginx/sites-enabled/default

# Frontend build output
COPY --from=frontend-builder /frontend/dist /var/www/html

# Backend
WORKDIR /app

COPY --from=backend-builder /backend/dist ./dist
COPY --from=backend-builder /backend/package*.json ./

RUN npm ci --omit=dev

# nginx config (rendered at container start from start.sh)
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]