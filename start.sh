#!/bin/sh
set -e

# Render (and similar platforms) route public traffic to $PORT. Nginx must bind there.
# Nest runs on a fixed internal port so it does not compete with nginx for $PORT.
BACKEND_PORT="${BACKEND_PORT:-3000}"
NGINX_PORT="${PORT:-80}"

sed -e "s/__NGINX_PORT__/${NGINX_PORT}/g" \
    -e "s/__BACKEND_PORT__/${BACKEND_PORT}/g" \
    /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

PORT="${BACKEND_PORT}" node /app/dist/main.js &

exec nginx -g "daemon off;"
