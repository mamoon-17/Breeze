# -------------------------
# Build React frontend
# -------------------------
FROM node:22 as frontend-builder

WORKDIR /frontend

COPY ./frontend/package*.json ./

RUN npm ci

COPY ./frontend ./

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

# nginx config
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]