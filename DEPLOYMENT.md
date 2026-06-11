# FCDiscountSystem Docker Deployment

## 1. Directory layout

This compose setup expects both repositories under the same parent:

```text
<parent>/
  FCDiscountSystem/
  fc-platform/
```

## 2. Configure environment

Copy example env and fill values when needed:

```bash
cp .env.docker.example .env
```

`MANIFEST_PRIVATE_KEY_PEM` and `VITE_MANIFEST_PUBLIC_KEY_PEM` are optional.  
If you keep signature optional, leave both empty.

## 3. Build and run

```bash
docker compose up -d --build
```

Services:

- `web` at `http://localhost:8080`
- `bff` health: `http://localhost:3001/api/fc/health`
- `engine` health: `http://localhost:8787/health`

## 4. Rollout controls

Canary rollout is controlled in `docker-compose.yml` via:

- `MANIFEST_CANARY_RUNTIMES`
- `MANIFEST_CANARY_DEFAULT_PERCENT`
- `MANIFEST_CANARY_ROLLOUTS`
- `MANIFEST_STABLE_VERSION`
- `MANIFEST_CANARY_VERSION`

To rollback quickly, set canary percent to `0` and redeploy `bff`:

```bash
docker compose up -d --build bff web
```
