# Redis Configuration for Token Blacklist

This project uses Redis for access token blacklisting with **Hybrid AOF+RDB persistence** for optimal performance and durability.

## Persistence Strategy: Hybrid Mode (AOF + RDB)

### Configuration
Add the following to your `redis.conf` or use these settings when starting Redis:

```conf
# Enable AOF (Append-Only File)
appendonly yes
appendfilename "appendonly.aof"

# Use RDB preamble for faster restarts
aof-use-rdb-preamble yes

# AOF fsync policy (everysec is recommended for balance)
appendfsync everysec

# Auto-rewrite AOF when it grows by this percentage
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Enable RDB snapshots as backup
save 900 1      # Save after 900 seconds if at least 1 key changed
save 300 10     # Save after 300 seconds if at least 10 keys changed
save 60 10000   # Save after 60 seconds if at least 10000 keys changed

# RDB filename
dbfilename dump.rdb

# Directory for both RDB and AOF files
dir /var/lib/redis
```

## How It Works

1. **RDB Preamble**: Redis periodically rewrites the AOF file as an RDB snapshot
2. **AOF Append**: New operations are appended to the AOF file
3. **Fast Restart**: On restart, Redis loads the RDB snapshot first (fast), then replays the AOF operations (incremental)
4. **Auto-Rewrite**: Redis automatically rewrites the AOF file to keep it manageable

## Benefits

✅ **Fast Startup**: RDB snapshot loads quickly  
✅ **Strong Durability**: AOF ensures minimal data loss  
✅ **Automatic Management**: Redis handles file rewrites  
✅ **Storage Efficient**: Combined size is smaller than pure AOF

## Docker Setup

If using Docker, add this to your `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly yes
    --aof-use-rdb-preamble yes
    --appendfsync everysec
    --auto-aof-rewrite-percentage 100
    --auto-aof-rewrite-min-size 64mb
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data

volumes:
  redis-data:
```

## Local Development

For local development without Docker:

```bash
# Install Redis
# macOS: brew install redis
# Ubuntu: sudo apt install redis-server
# Windows: Use WSL or Redis Windows port

# Start with custom config
redis-server /path/to/redis.conf

# Or start with command-line flags
redis-server --appendonly yes --aof-use-rdb-preamble yes
```

## Token Blacklist Usage

When a user logs out with an access token:
1. The token's `jti` (unique ID) is added to Redis
2. TTL is set to the token's remaining lifetime
3. On subsequent requests, the JWT strategy checks the blacklist
4. Blacklisted tokens are rejected
5. Redis automatically removes expired entries

## Monitoring

Check Redis persistence status:

```bash
redis-cli INFO persistence
```

Key metrics:
- `aof_enabled`: Should be 1
- `aof_rewrite_in_progress`: Shows if rewrite is happening
- `aof_last_rewrite_time_sec`: Time taken for last rewrite
- `rdb_last_save_time`: Last RDB snapshot time
