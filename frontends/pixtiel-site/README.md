# PIXTiel site — Vercel / v0

Next.js App Router site. Production: https://pixtiel.vercel.app

## GitHub auto-rebuild

1. In Vercel (or v0 project settings), import the GitHub repo.
2. Set **Root Directory** to `frontends/pixtiel-site`.
3. Framework: Next.js. Install/build use package scripts (`pnpm install` / `pnpm build`).
4. Production domain: `pixtiel.vercel.app`.
5. `vercel.json` `ignoreCommand` skips deploys when this directory did not change.

Pushes to `main` that touch `frontends/pixtiel-site/**` rebuild the live site. No GitHub Pages workflow.

## Local

```bash
pnpm --filter pixtiel-site dev
pnpm --filter pixtiel-site build
pnpm --filter pixtiel-site start
```

Frame a local build from PixelOffice Docs with `PIXTIEL_WEBSITE_URL=http://127.0.0.1:3030`.
