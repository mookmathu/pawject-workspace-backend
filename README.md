# Crew Space — Backend (User + Auth)

Node.js + Express + Prisma, connected to a PostgreSQL database hosted on Supabase.

## 1. Create a Supabase project

1. Go to https://supabase.com → New project.
2. Set a database password (write it down — you'll need it below).
3. Once the project is ready, go to **Project Settings → Database → Connection string → URI**.
4. Copy that string.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and:
- Paste the Supabase connection string into `DATABASE_URL`, replacing `[YOUR-PASSWORD]` with your actual DB password.
- Set `JWT_SECRET` to any long random string (e.g. generate one at https://generate-secret.vercel.app/32).

## 3. Install dependencies

```bash
npm install
```

## 4. Create the database table

```bash
npm run prisma:migrate
```

This creates the `User` table in your Supabase database based on `prisma/schema.prisma`.

## 5. Run the server

```bash
npm run dev
```

Server runs at `http://localhost:4000`. Test it's alive:

```bash
curl http://localhost:4000/api/health
```

## Endpoints

- `POST /api/auth/register` — body: `{ name, email, password, orgType, orgName }`
- `POST /api/auth/login` — body: `{ email, password }`

Both return `{ token, user }` on success.

## Viewing your data

```bash
npm run prisma:studio
```

Opens a browser UI to view/edit rows in your Supabase database directly.

## Next steps

Add Workspace / Board / Task / Canvas / Messaging models to `prisma/schema.prisma`
once this auth flow is confirmed working, then run `npm run prisma:migrate` again.
