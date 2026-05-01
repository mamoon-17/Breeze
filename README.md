# Breeze

## Local dev dependencies (Docker)

Start Redis (auto-restarts via Docker):

```bash
docker compose up -d
```

Stop:

```bash
docker compose down
```

Redis is exposed on `localhost:6379` for the backend (`REDIS_HOST=localhost`, `REDIS_PORT=6379`).

