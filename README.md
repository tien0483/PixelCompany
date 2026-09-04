<div align="center">

# PIXTiel

**A local Kanban board where coding agents pick up cards, work in isolated git worktrees, and hand back reviewable branches.**

[Website](https://pixtiel.dev) · [Docs](https://pixtiel.dev/docs/getting-started) · [Blog](https://pixtiel.dev/blog)

</div>

---

## What it is

PIXTiel runs coding agents the way you would run a team. One board, one card per task, and a
dedicated git worktree per card so several agents work at once without overwriting each other.
It installs on your machine, binds to loopback, and never sends your code anywhere.

- **The board** — Backlog → Planning → In Progress → Review → Done. Moving a card into progress
  cuts a worktree on its own branch and launches the agent pinned to that card.
- **Your choice of agent, per card** — Claude Code, Cursor Agent, Cline, Antigravity CLI and a
  custom `dsh` harness. The card decides the harness, model, reasoning effort, base branch and
  which skills are mounted.
- **Plans before code** — versioned HTML plans with an agent refine pass you accept as a diff.
- **Review that is a real diff** — whole-branch diff against the card's locked base ref; line
  comments route back to the agent as scoped revision work.
- **Seats instead of stalls** — live 5-hour and 7-day usage windows per account, usage-aware
  parking and resume, and a separate seat that only a card's subagents bill.
- **A token stack that ships with it** — `rtk` for shell output, Caveman for prose,
  Understand-Anything for architecture questions, Headroom for context rewriting.

## Install

Ubuntu or WSL2, on the native Linux filesystem:

```bash
curl -fsSL https://raw.githubusercontent.com/tien0483/PixelCompany/main/install.sh | bash
```

The installer draws a checkbox picker, remembers what you chose, and offers to start PIXTiel when
it finishes. It works entirely in user space — Node via nvm, Python tools via `uv`, no sudo, no
system directories touched.

The picker nests the optional pieces under the required core, and ends with two standalone
packages — Plan editor and Review — that build into shippable folders of their own. Both are
off by default. A feature whose artifact already exists is skipped, so to rebuild one, delete
its output folder (`plan-editor-standalone/`, `review-standalone/`) and re-run `pnpm run setup`.

> **Not under `/mnt/`.** On WSL that is a 9p mount where dependency installs and parallel git
> operations stall or deadlock. The installer refuses, on purpose. Projects you *open* can live
> anywhere.

## Run

```bash
pnpm start          # one process, one URL: http://127.0.0.1:3484
pnpm dev            # Vite HMR on :5173 against the runtime on :3484
pnpm run restart    # dev, freeing stale ports first
pnpm run build      # build the web UI
pnpm run setup      # re-run the installer (add or repair features)
pnpm run upgrade    # pull the latest release, rebuild installed features
```

Useful flags: `pnpm start -- --restart`, `-- --build`, `-- --skip-build`, `-- --no-proxy-env`.
Full reference: [Commands & Scripts](https://pixtiel.dev/docs/cli).

## Repository layout

| Path | What lives there |
|---|---|
| `backends/runtime/` | Node runtime — board state, PTY sessions, tRPC API, sidecar supervisors |
| `backends/manager/` | Python service for accounts, seats and OAuth (`:8321`) |
| `backends/agent_stack/` | The seven-tool token stack, installed in-tree |
| `backends/doc_skill/`, `backends/html_anything/` | Docs and template sidecars |
| `backends/flowise/`, `backends/openmaic/`, `backends/OmniRoute/` | Submodules: agent studio, learning room, LLM router |
| `frontends/pixel_office/` | React + Vite UI |
| `frontends/pixtiel-site/` | Marketing and documentation site (Astro) — also framed by the in-app Docs tab |
| `scripts/` | Launchers, the installer, and the shared helpers they use |

## Ports

Everything binds to `127.0.0.1`.

`3484` app · `8321` Manager · `8322` HTML sidecar · `8323` docs sidecar · `8400` OmniRoute ·
`3010` agent studio · `3020` learning room · `3030` documentation site (what the in-app **Docs**
tab frames) · `8000` agent-stack switchboard · `5173` Vite (dev only).

## Requirements

- Ubuntu or WSL2 on ext4 (not `/mnt/<drive>`)
- Node ≥ 22 — the installer provisions it via nvm if missing
- `uv` for the Python sidecars, `git`, and pnpm (provisioned via corepack)

## Development

```bash
pnpm install
pnpm dev
pnpm run test:web        # frontend suite
pnpm run test:runtime    # runtime suite
```

Contributor and agent conventions live in [`CLAUDE.md`](CLAUDE.md); the architecture map is in
[`TECH_STACK.md`](TECH_STACK.md).

## License

MIT.
