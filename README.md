# OpenValens

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, ORPC, and more.

## Self-hosting

Run your own instance with the supported Docker Compose install. The guides
apply to OpenValens 0.1.0 (pre-release; no release is tagged yet):

- [Overview](docs/self-hosting/README.md) — start here; lists what is not covered yet
- [Install](docs/self-hosting/install.md)
- [Configuration](docs/self-hosting/configuration.md) and the generated [environment reference](docs/reference/env.md)
- [Upgrading](docs/self-hosting/upgrading.md)
- [Backups](docs/self-hosting/backup.md) — **incomplete:** plain, unencrypted pre-migrate dumps only; encrypted backup and restore are pending (#64)
- [Email](docs/self-hosting/email.md) (Resend only)
- [Single sign-on (OIDC)](docs/self-hosting/oidc.md) — one optional provider, invite-only
- [Security model and reporting](docs/self-hosting/security.md)
- [Privacy and data rights](docs/self-hosting/privacy.md)
- [Licensing and trademark](docs/self-hosting/licensing.md)
- [Connecting the mobile app](docs/self-hosting/mobile-app.md)
- [AI providers](docs/ai-providers.md) — Anthropic or an OpenAI-compatible endpoint

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Start the local database (bound to localhost only) and apply migrations:

```bash
bun run db:start
bun run db:migrate
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
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
import { Button } from "@openvalens/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

The complete variable list, with types, defaults and `_FILE` support, is generated into [`docs/reference/env.md`](docs/reference/env.md). Regenerate it with `bun run docs:generate` after editing a schema; `bun run docs:check` verifies it in CI.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

### Docker Compose

> This is the **development** stack. To self-host OpenValens on a server, use
> the supported HTTPS install in [docs/self-hosting/](docs/self-hosting/README.md)
> (`deploy/setup.sh install`).

- Target: web + server
- Config: `docker-compose.yml` (app Dockerfiles live in `apps/*/Dockerfile`)
- Build images: bun run docker:build
- Start: bun run docker:up
- Logs: bun run docker:logs
- Stop: bun run docker:down

Environment variables are read from each app's `.env` file (baked into web builds for public variables) and overridden in `docker-compose.yml` for container networking.

For more details, see the guide on [Deploying with Docker Compose](https://www.better-t-stack.dev/docs/guides/docker).

## Git Hooks and Formatting

- Run checks: `bun run check`

## Project Structure

```
openvalens/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run dev:native`: Start the React Native/Expo development server
- `bun run db:migrate`: Apply database migrations (never use `db:push` on real data)
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Oxlint and Oxfmt
- `bun run docker:build`: Build the Docker Compose images
- `bun run docker:up`: Build and start the Docker Compose stack
- `bun run docker:logs`: Tail logs from the Docker Compose stack
- `bun run docker:down`: Stop the Docker Compose stack

## Better Auth Schema Generation

After changing auth plugins or schema options, run `bun run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.

## License

Copyright (C) 2026 The OpenValens contributors.

OpenValens is free software under the [GNU Affero General Public License v3.0 or later](LICENSE), with an [additional permission for app-store distribution](LICENSE-APP-STORE). Contributions are accepted under the same terms with a DCO sign-off; see [CONTRIBUTING.md](CONTRIBUTING.md). The OpenValens name and logo are covered by the [trademark policy](TRADEMARK.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).
