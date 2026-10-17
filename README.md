# Pawject — Backend

Node.js + Express + Prisma + Socket.io, connected to a PostgreSQL database hosted on Supabase.
This is the API behind the Pawject team-collaboration web app (workspaces, task boards, chat, calendar, friends, daily mood check-ins).

## 1. Create a Supabase project

1. Go to https://supabase.com → New project.
2. Set a database password (write it down — you'll need it below).
3. Once the project is ready, go to **Project Settings → Database → Connection string → URI**.
4. Copy that string.

> Free Supabase projects pause after a period of inactivity. If the API suddenly fails to connect, open the Supabase dashboard and restore the project.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and:
- Paste the Supabase connection string into `DATABASE_URL`, replacing `[YOUR-PASSWORD]` with your actual DB password.
- Set `JWT_SECRET` to any long random string.
- Fill in the other values listed in `.env.example` (email / OAuth / client URL).

Never commit `.env` — it is listed in `.gitignore`.

## 3. Install dependencies

```bash
npm install
```

## 4. Create / update the database tables

```bash
npm run prisma:migrate
```

(or `npx prisma db push` while developing). This creates every table in `prisma/schema.prisma` in your Supabase database: users, workspaces, boards/tasks, chat, friends, events, notifications, activity days and mood entries.

## 5. Run the server

```bash
npm run dev
```

Server runs at `http://localhost:4000`. Test it's alive:

```bash
curl http://localhost:4000/api/health
```

## API overview

All routes are under `/api` and, except sign-in / register / password reset, require `Authorization: Bearer <token>`.

| Prefix | What it covers |
|---|---|
| `/api/auth` | register, login, OTP verification, OAuth, profile, password reset |
| `/api/users` | user lookup / search |
| `/api/friends` | friends and friend requests |
| `/api/workspaces` | workspaces and members |
| `/api/board`, `/api/columns`, `/api/categories` | Kanban board, columns, categories |
| `/api/tasks`, `/api/subtasks`, `/api/comments` | tasks, subtasks, task comments |
| `/api/events` | calendar events and attendees |
| `/api/chat` | workspace and direct-message chat (real-time via Socket.io) |
| `/api/notifications` | in-app notifications |
| `/api/mood` | private daily mood check-ins (visible only to their owner) |

Sign-in endpoints return `{ token, user }` on success.

## Viewing your data

```bash
npm run prisma:studio
```

Opens a browser UI to view/edit rows in your Supabase database directly.

## Deploying

- Keep secrets in environment variables on the server, not in the repository.
- User uploads are stored in `uploads/` (ignored by git) — make sure that folder exists and is kept across deployments.
- Socket.io needs WebSocket support from the host (a VPS or a Node-capable platform).