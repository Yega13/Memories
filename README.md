# Hushare

Shared photo albums from one link. Guests can add photos or videos without an account; album owners can manage sharing, downloads, backgrounds, passwords, custom URLs, and Studio collections.

## Stack

- Next.js 15 app router
- React 19
- Supabase Auth, Postgres, and Storage
- Cloudflare Workers via OpenNext
- Cloudflare R2 for video files
- Polar for subscriptions

## Local Development

```bash
npm run dev
```

The app expects the environment values used by Supabase, R2, Polar, Resend, and optional cron/password secrets. Local `.env*` files are intentionally ignored.

## Useful Commands

```bash
npm run lint
npx tsc --noEmit
npm run cf:build
npm run preview
npm run deploy
```

If `npm` is unavailable in the current shell, the local package entrypoints can be run through `node node_modules/<package>/...`.

## Cron

Album retirement lives in `src/app/api/cron/retire-albums/route.ts`.

Cloudflare scheduled events are wired through `worker.ts`, which reuses the generated OpenNext fetch handler and forwards the daily cron to that route. The schedule is configured in `wrangler.toml`.

Set `ALBUM_RETIREMENT_SECRET` as a Worker secret in production. When present, the scheduled worker sends it as `Authorization: Bearer <secret>`.

## Deployment Notes

`wrangler.toml` is the Worker source of truth. Build output directories such as `.next`, `.open-next`, and `.wrangler` are generated artifacts and should stay untracked.

OpenNext warns that Windows support is imperfect; WSL is the safer build environment for Cloudflare production builds.
