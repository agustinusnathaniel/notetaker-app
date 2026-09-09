# Notetaker

A meeting notes app that records or accepts audio, transcribes it, generates notes and action items, and keeps the result available for later review.

- [Live app](https://notetaker-app.sznm.dev)
- [Production API](https://notetaker-api.sznm.dev)

## What it does

- Records microphone audio or accepts an audio upload with a configured 25 MB cap.
- Stores meeting audio in a private Cloudflare R2 bucket.
- Transcribes prerecorded audio with Deepgram Nova-3.
- Shows timestamped transcript sections with numeric speaker labels.
- Generates a title, description, summary, key takeaways, and action items.
- Persists meetings and action-item completion in Neon Postgres.
- Supports meeting editing, deletion, staged retry, and responsive layouts.

## Stack

- React, Vite, TanStack Router, React Query, and Tailwind CSS
- Coss/Base UI components and AI Elements
- Hono, Effect 4 RC, and Zod
- Neon Postgres with Drizzle ORM
- Cloudflare Workers, R2, Workers AI, and Alchemy
- Deepgram Nova-3, with an optional Groq fallback for notes generation
- pnpm, Vite+, TypeScript, and Ultracite/Biome

## Run locally

### Prerequisites

- Node.js and pnpm
- A Cloudflare account with Workers AI and R2 access
- A Neon Postgres database
- A Deepgram API key
- An optional Groq API key for notes-generation fallback

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the server

Create `apps/server/.env`:

```dotenv
DATABASE_URL=your_neon_pooled_connection
DATABASE_MIGRATION_URL=your_neon_direct_connection
DEEPGRAM_API_KEY=your_deepgram_api_key
CORS_ORIGIN=http://localhost:3001

# Optional notes-generation fallback:
# GROQ_API_KEY=your_groq_api_key
```

The Alchemy stack declares the R2 and Workers AI bindings. It references the existing private `fft` bucket for every stage, so local and production storage are not isolated. Use non-sensitive test audio during local development.

### 3. Configure the web app

Create `apps/web/.env`:

```dotenv
VITE_SERVER_URL=http://localhost:3000
```

### 4. Configure Cloudflare access

```bash
pnpm run infra:login
```

### 5. Apply the database migration

```bash
pnpm run db:migrate
```

### 6. Start the app

```bash
pnpm run dev
```

Open:

- Web app: [http://localhost:3001](http://localhost:3001)
- API: [http://localhost:3000](http://localhost:3000)

## Assumptions and limitations

- The app represents one workspace and does not include authentication.
- Transcription starts after an upload or recording has finished; it is not live streaming.
- Audio is transferred as one complete object. Resumable upload and HTTP byte-range playback are not implemented.
- Deepgram returns numeric speaker labels rather than participant names.
- The app has no application-level rate limiting.
- AI-generated notes should be checked against the original audio.
- There is no automated test suite yet.
- `pnpm run check` currently reports known Ultracite issues.

## Deployment note

`pnpm run db:migrate` and `pnpm run deploy:prod` read database values from `apps/server/.env`. Before running either command, verify that `DATABASE_URL` and `DATABASE_MIGRATION_URL` point to the intended Neon database. The production script also uses the shared `fft` R2 bucket configured in `packages/infra/alchemy.run.ts`.

## Useful commands

```bash
pnpm run dev          # Start web, API, and local infrastructure
pnpm run check-types  # Run TypeScript checks
pnpm run build        # Build the web and server apps
pnpm run check        # Run Ultracite/Biome checks
pnpm run db:migrate   # Apply database migrations
pnpm run deploy:prod  # Deploy the configured production stage
```
