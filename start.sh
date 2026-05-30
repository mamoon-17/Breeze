#!/bin/sh

exec node /app/dist/main.js &
exec nginx -g "daemon off;"