# Fan-out mode — parallel backend + frontend implementers

Read this only when the user chose fan-out. Backend and frontend live in disjoint
trees, so implementer subagents don't conflict. Strict order:

1. **Everything user-facing happens BEFORE spawning** — subagents cannot talk to the
   user. Batch-ask the clarifying questions, resolve the DB gate (anything gated stays
   with you, never delegated), and get agreement on the plan.
2. **Fix the contract first, yourself:** endpoint path(s), response schema
   (`schemas/{resource}.py`) and the mirrored frontend types (`types/{feature}.ts`) —
   written and committed to the plan before fan-out, so both subagents build against
   the same shape.
3. **Spawn both implementers in parallel (one message, two Agent calls).** Each brief
   contains: the recipe steps it owns (R1 backend half / R1 frontend half + R2/R3), the
   contract as written, the absolute path of the relevant shared standards file
   (`.claude/skills/_shared/papp-standards/{backend|frontend}-standards.md`) with the
   instruction to read it first, the exact files it may create/edit (disjoint scopes —
   the backend agent never touches `frontends/`, and vice versa), no DB mutations of
   any kind, and the return format: changed-file list + verify commands run + results +
   anything deferred.
4. **Integrate yourself:** re-check the seams (schema ↔ TS types field-for-field,
   path ↔ service call, query key includes all args, staleTime tier), run the full
   verify commands for both domains, and write the single plain-language report.
