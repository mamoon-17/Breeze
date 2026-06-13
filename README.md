# Breeze

![version](https://img.shields.io/badge/version-1.0.0-blue)
![status](https://img.shields.io/badge/status-active-brightgreen)
![node](https://img.shields.io/badge/node-v20%2B-339933?logo=node.js&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-informational)
![LLM](https://img.shields.io/badge/LLM-OpenAI%20compatible-412991?logo=openai&logoColor=white)

**AI-powered messaging and calling platform with an agent that can act on your behalf.**

Breeze blends real-time chat, voice and video calls, and an agentic LLM assistant that can summarize conversations, enhance tone, schedule reminders, and send messages for you. It is built as a full-stack product with a NestJS backend, a modern React frontend, and security-first session management.

## Live Demo

Live URL: https://breeze-latest.onrender.com/

## Key Features

### Agentic AI Assistance

- Summarize conversations on demand
- Enhance messages with tone control and rewrites
- Schedule reminders with confirmation and delivery
- AI message writer jobs to draft and send messages on your behalf

### Messaging and Calling

- Real-time 1:1 and group chat
- Voice and video calls with live signaling
- Presence, typing indicators, and notifications
- Emoji support and rich message attachments

### Media and Storage

- S3-backed uploads for voice notes and media
- Presigned URL workflows for secure uploads
- Avatar and asset storage

### Security and Sessions

- JWT access and refresh token rotation
- Redis-backed access token blacklist for instant logout
- Anomaly detection with step-up authentication
- Session family management and revocation endpoints

### Infrastructure

- WebSocket transport via Socket.IO
- Redis integration for cache and security features
- Postgres persistence with migrations
- Scheduler-driven background processing

## Tech Stack

### Frontend

| Technology                  | Purpose                        |
| --------------------------- | ------------------------------ |
| **React 19 + TypeScript**   | UI framework                   |
| **TanStack Start + Router** | App routing and server tooling |
| **Vite**                    | Build tool and dev server      |
| **Tailwind CSS + Radix UI** | Styling and components         |
| **Socket.IO Client**        | Real-time messaging and calls  |

### Backend

| Technology                | Purpose                             |
| ------------------------- | ----------------------------------- |
| **NestJS + TypeScript**   | API and realtime server             |
| **TypeORM**               | Database ORM and migrations         |
| **PostgreSQL**            | Primary database                    |
| **Redis**                 | Token blacklist and cache           |
| **Socket.IO**             | WebSocket transport                 |
| **OpenAI-compatible SDK** | LLM integration                     |
| **AWS S3**                | Media storage and presigned uploads |

## Project Structure

```
Breeze/
├── backend/                 # NestJS API and realtime services
├── frontend/                # React UI (TanStack Start)
├── nginx/                   # Reverse proxy config
├── docker-compose.dev.yml   # Local dev services
├── Dockerfile
└── start.sh
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis (Docker recommended)
- An OpenAI-compatible API key (or GitHub Models access)
- AWS S3 credentials for media uploads

### Local Development

**1) Start Redis**

```bash
docker compose -f docker-compose.dev.yml up -d redis
```

**2) Backend**

```bash
cd backend
npm install
cp .env.example .env
npm run start:dev
```

**3) Frontend**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default ports:

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Environment Variables

Key backend variables live in [backend/.env.example](backend/.env.example). Highlights:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `REDIS_HOST`, `REDIS_PORT`
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `AI_MODEL`, `AI_BASE_URL`, `GITHUB_MODEL_KEY`

Frontend variables live in [frontend/.env.example](frontend/.env.example):

- `VITE_API_URL`
- `VITE_VAPID_PUBLIC_KEY`

## Documentation

- [Anomaly detection system](backend/documentation/ANOMALY_DETECTION.md)
- [Access token blacklist](backend/documentation/ACCESS_TOKEN_BLACKLIST.md)
- [Refresh event logging](backend/documentation/REFRESH_EVENT_LOGGING.md)
- [Auth flow diagrams](backend/documentation/FLOW_DIAGRAMS.md)

## License

This project is open source and available under the [MIT License](LICENSE).
