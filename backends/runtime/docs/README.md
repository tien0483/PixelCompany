# Engineering Docs

This folder is the starting point for engineers working on Kanban itself.

This follows the usual split a small engineering team would want:

- `README.md` explains the product, local setup, and everyday usage.
- `docs/` holds stable onboarding and architecture references for humans.
- `.plan/docs/` holds active plans, handoffs, and deeper change-history context for larger refactors.




If you are new to the codebase, read these in order:

1. [`../README.md`](../README.md) for the product overview and local setup.
2. [`architecture.md`](./architecture.md) for the system map, runtime model, and key file guide.
3. [`multi-agent-orchestration.md`](./multi-agent-orchestration.md) for Flowise + Cursor + Antigravity + dsh orchestrator.
4. [`flowise-tool-backend.md`](./flowise-tool-backend.md) for AgentFlow + MCP wiring details.
5. [`antigravity-pretool-denial.md`](./antigravity-pretool-denial.md) for diagnosing and recovering from `tool call denied by pre-tool hook`.

This `docs/` folder should stand on its own for normal onboarding. Active plans and handoffs may still exist in `.plan/docs`, but a new engineer should not need those to understand the current architecture.

When adding new engineering docs, prefer putting stable explanations here and linking them from this index.
