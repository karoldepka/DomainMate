# DomainMate

Domain-name generation and research application built with Nuxt 4. The Nuxt app and Nitro API live together at the repository root.

## Development

```bash
pnpm install
pnpm dev
```

The app runs at `http://localhost:3000`. Without hosted database variables it uses a local SQLite database under `data/`.

## Hosted persistence

Production writes are fanned out to equal Supabase and Neon Postgres peers. Reads race both peers and return the first successful response, so a slow or unavailable provider does not delay the client. Favorite writes use `updated_at` conflict checks to prevent an older update from replacing a newer record.

Set both server-only environment variables:

```text
SUPABASE_DATABASE_URL=postgresql://...
NEON_DATABASE_URL=postgresql://...
```

Use each provider's pooled connection string. Never expose either value through a `NUXT_PUBLIC_` variable. The backend creates its tables in the private `domainmate` schema.

## Verification

```bash
pnpm build
pnpm test
pnpm test:e2e
```

## Deployment

Vercel can detect and deploy the root Nuxt project, including its Nitro API routes. Add the two database URLs and any provider credentials from `.env.example` to the Vercel project's environment variables.
