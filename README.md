# notetaker-app

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **Effect** - Effect 4 RC workflow and typed expected failures for transcription
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Biome** - Linting and formatting
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
pnpm run db:push
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@notetaker-app/ui/components/button";
```

### Incremental Coss UI adoption

The shared Button at `packages/ui/src/components/button.tsx` uses the official Coss registry implementation, merged with the existing Base UI-compatible public API. Its loading indicator is the official Coss Spinner at `packages/ui/src/components/spinner.tsx`, and the required Coss destructive foreground tokens live in `packages/ui/src/styles/globals.css`.

Preview or update the component from the repository root with the project pnpm runner:

```bash
pnpm dlx shadcn@latest add @coss/button --dry-run -c packages/ui
pnpm dlx shadcn@latest add @coss/button --diff src/components/button.tsx -c packages/ui
pnpm dlx shadcn@latest add @coss/button -c packages/ui
```

Review the dry-run and diff before merging updates. Do not use `--overwrite`, because the existing shared Button has callers outside the Coss registry's generated file.

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Meetings golden path

The meetings flow is the local golden path: upload audio at `/meetings/new`, then review transcript, summary, takeaways, and action items at `/meetings/$meetingId`.

1. Configure `apps/server/.env` with Neon pooled `DATABASE_URL` plus `DATABASE_MIGRATION_URL`, R2 bucket settings, `DEEPGRAM_API_KEY`, and optional `GROQ_API_KEY` for the summary fallback (uses `openai/gpt-oss-120b`; summaries still work without it when Workers AI is available). Configure `apps/web/.env` with `VITE_SERVER_URL=http://localhost:3000`.
2. Apply migrations from the repo root:

```bash
pnpm run db:migrate
```

3. Start both apps from the repo root:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) for the web app. The API serves `/api/meetings` at [http://localhost:3000](http://localhost:3000).

4. Upload a non-empty `audio/*` file up to 25 MB from `/meetings/new`. The client creates a draft, uploads audio with `PUT /api/meetings/:id/audio`, then triggers `POST /api/meetings/:id/transcription` and `POST /api/meetings/:id/summary`. On success it redirects to the meeting detail page.
5. If processing fails, the detail page shows the failed stage with `Retry transcription` (when audio is stored) or `Retry summary` (when a transcript exists), plus `Reload` and `Back Home`. Errors use the stable shape `{ "error": { "code": "...", "message": "..." } }` and never expose provider details or keys. Audio stays private in R2.

## Deployment

### Alchemy

- Target: web on Cloudflare + server on Cloudflare
- Configure provider login: `cd packages/infra && pnpm exec alchemy login --configure`
- Dev: pnpm run dev
- Deploy: pnpm run deploy
- Destroy: pnpm run destroy

`alchemy login --configure` stores the selected Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. The canonical production stage is `prod` (the older `production` name is retired, do not use it):

```bash
cd packages/infra && pnpm exec alchemy deploy --stage prod
```

### Production deploy script

Use `pnpm run deploy:prod` (or `./scripts/deploy-prod.sh`) for prod deploys. It takes no arguments: it runs migrations, deploys stage `prod`, and prints verify commands against the static prod domains.

```bash
pnpm run deploy:prod
```

### Production origins

Prod domains and CORS are static (exact origins, no wildcards):

- Web: `https://notetaker-app.sznm.dev`
- API: `https://notetaker-api.sznm.dev`
- Prod `CORS_ORIGIN` is the web custom domain above, set as a literal in `packages/infra/alchemy.run.ts`, so local `localhost` values in `apps/server/.env` stay dev-only. Dev keeps `CORS_ORIGIN=http://localhost:3001` from env.
- `CORS_EXTRA_ORIGINS` remains an optional env override (default empty) for transition, e.g. a workers.dev web URL during cutover; it is never required in prod.

Notes:

- The script never writes to local `.env` files.
- The existing `fft` R2 bucket is adopted by name and retained on stack removal, so prod deploys are a noop for stored audio.
- Provider auth comes from `~/.alchemy` (`pnpm run infra:login`); the script reads no secrets, so a missing login is the only expected setup failure.

Verify after deploy:

```bash
curl -sS "https://notetaker-api.sznm.dev/"
curl -sS -o /dev/null -w "%{http_code}\n" "https://notetaker-app.sznm.dev/"
curl -sS -D - -o /dev/null -H "Origin: https://notetaker-app.sznm.dev" "https://notetaker-api.sznm.dev/" | grep -i access-control-allow-origin
curl -sS -D - -o /dev/null -H "Origin: https://evil.example.com" "https://notetaker-api.sznm.dev/" | grep -i access-control-allow-origin && echo "CORS CHECK FAILED" || echo "CORS OK"
```

## Git Hooks and Formatting

- Optional native Vite+ hooks: `pnpm run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `pnpm run check`

## Project Structure

```
notetaker-app/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   └── db/          # Database schema & queries
```

The server keeps the Hono adapter in `apps/server/src/index.ts` and mounts focused
route modules from `apps/server/src/routes/health.ts` and
`apps/server/src/routes/meetings.ts`. The web app exposes the home page, the
accessible `/meetings/new` upload flow, and the `/meetings/$meetingId` detail
page, which call the `/api/meetings` endpoints.

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `pnpm run check`: Run Ultracite format and lint checks
- `pnpm run lint`: Run Vite+ lint checks
- `pnpm run format`: Run Vite+ formatting
- `pnpm run staged`: Run Vite+ checks against staged files
- `pnpm run hooks:setup`: Install Vite+ native Git hooks with `vp config`
