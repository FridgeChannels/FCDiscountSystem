# FCDiscountSystem Docker Deployment

## 1. Directory layout

This compose setup expects both repositories under the same parent:

```text
<parent>/
  FCDiscountSystem/
  fc-platform/
```

## 2. Configure environment

Copy example env and fill values:

```bash
cp .env.docker.example .env
```

Production minimum:

- `PUBLIC_BASE_URL` — public URL users hit, e.g. `https://tap.example.com`
- `FC_REPO=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`PUBLIC_BASE_URL` is used for:

- uploaded iframe game URLs (`/uploaded-games/...`)
- built-in runtime shells (`/runtime-shell/...`)
- FCDiscountSystem manifest iframe loading

Nginx must also proxy Next.js assets from `platform-web`:

- `/_next/` — JS/CSS chunks for `/runtime-shell/` and `/admin/`
- `/brand-assets/` — logos referenced by games and brand theme

## 3. Build and run

```bash
docker compose up -d --build
```

Services:

| Service | Internal | External |
|---------|----------|----------|
| `web` (nginx + FCDiscountSystem UI) | :80 | `http://localhost:8080` |
| `platform-web` (fc-platform admin + uploads) | :8789 | via nginx only |
| `bff` | :3001 | via nginx `/api/fc/` |
| `engine` | :8787 | internal only |

Health checks:

- `http://localhost:8080/`
- `http://localhost:8080/api/fc/health` (through nginx → bff)

## 4. Upload games in production (Docker)

Admin UI:

```text
http://localhost:8080/admin/game-library
```

Upload flow:

1. Upload zip in **0) Upload Game Package**
2. Preview iframe
3. Click **Activate**
4. Create template + instance

Uploaded files are stored in Docker volume:

```text
platform_uploaded_games -> /workspace/fc-platform/apps/web/public/uploaded-games
```

Public URL shape:

```text
{PUBLIC_BASE_URL}/uploaded-games/{RuntimeComponent}/{version}/index.html
```

Example:

```text
http://localhost:8080/uploaded-games/AsteroidsRuntime/1.0.0/index.html
```

The zip file itself is not kept; only extracted static assets persist in the volume.

## 5. Persistence notes

- `platform_uploaded_games` volume survives container restarts.
- Rebuilding images does not delete uploaded games.
- Removing the volume deletes uploaded games:

```bash
docker volume rm fc-discount-system_platform_uploaded_games
```

For long-term production, plan migration to object storage/CDN. Keep `runtime_registry.iframe_url` as the stable contract.

## 6. Supabase migrations

Before using `FC_REPO=supabase`, apply fc-platform migrations including:

- `supabase/migrations/0013_runtime_registry.sql`

## 7. Game package standard

See `fc-platform/docs/GAME-RUNTIME-ONBOARDING-STANDARD.md`.

Example package:

```text
fc-platform/examples/html5-asteroids-fc/
fc-platform/examples/AsteroidsRuntime.zip
```

## 8. Rollout controls

Manifest is served by engine via BFF (`/api/fc/games/manifest`).

Runtime availability is controlled in Supabase `runtime_registry.status` and admin **Activate** button.
