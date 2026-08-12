# QA Agent Design Guide

A reference guide for including a QA agent in the build harness. Based on the bug patterns discovered in a real project (SatangSlide) and analysis of their root causes, it provides a verification methodology for systematically catching the defects that QA most easily misses.

---

## Table of Contents

1. Patterns of Defects That QA Agents Miss
2. Integration Coherence Verification
3. QA Agent Design Principles
4. Verification Checklist Template
5. QA Agent Definition Template

---

## 1. Patterns of Defects That QA Agents Miss

### 1-1. Boundary Mismatch

The most frequent kind of defect. Two components are each implemented "correctly," but their contracts diverge at the point where they connect.

| Boundary | Mismatch Example | Why It Gets Missed |
|--------|-----------|-----------|
| API response → frontend hook | API returns `{ projects: [...] }`, hook expects `SlideProject[]` | Each verifies fine on its own; no cross-comparison is done |
| API response field name → type definition | API uses `thumbnailUrl` (camelCase), type uses `thumbnail_url` (snake_case) | When cast with a TypeScript generic, the compiler cannot catch it |
| File path → link href | Page lives at `/dashboard/create` but link points to `/create` | The file structure and the href are not cross-compared |
| State transition map → actual status update | Map defines `generating_template → template_approved`, but the code omits the transition | Only the map's existence is confirmed; not every update in the code is traced |
| API endpoint → frontend hook | API exists but has no corresponding hook (never called) | The API list and hook list are not mapped 1:1 |
| Immediate response → asynchronous result | API returns `{ status }` immediately, frontend accesses `data.failedIndices` | Only the type is checked, without distinguishing synchronous vs. asynchronous responses |

### 1-2. Why Static Code Review Fails to Catch These

- **Limits of TypeScript generics**: `fetchJson<SlideProject[]>()` — compiles even when the runtime response is `{ projects: [...] }`
- **`npm run build` passing ≠ correct behavior**: When type casts, `any`, or generics are used, the build succeeds but fails at runtime
- **Existence verification vs. connection verification**: "Does the API exist?" and "Does the API's response match what the caller expects?" are entirely different verifications

---

## 2. Integration Coherence Verification

The **cross-comparison verification** areas that must be included in a QA agent.

### 2-1. API Response ↔ Frontend Hook Type Cross-Verification

**Method**: Compare each API route's `NextResponse.json()` call site with the type parameter of `fetchJson<T>` in the corresponding hook.

```
Verification steps:
1. Extract the shape of the object passed to NextResponse.json() in the API route
2. Check the T type in fetchJson<T> in the corresponding hook
3. Compare whether shape and T match
4. Check for wrapping (if the API returns { data: [...] }, does the hook unwrap .data?)
```

**Patterns to watch especially:**
- Pagination API: `{ items: [], total, page }` vs. frontend expecting an array
- Mismatch across snake_case DB fields → camelCase API response → frontend type definition
- Shape difference between an immediate response (202 Accepted) and the final result

### 2-2. File Path ↔ Link/Router Path Mapping

**Method**: Extract the URL paths of page files under `src/app/` and compare them against every `href`, `router.push()`, and `redirect()` value in the code.

```
Verification steps:
1. Extract URL patterns from page.tsx file paths under src/app/
   - (group) → removed from the URL
   - [param] → dynamic segment
2. Collect every href=, router.push(, redirect( value in the code
3. Confirm that each link matches an actually existing page path
4. Watch for the URL prefix of pages inside a route group (e.g., under dashboard/)
```

### 2-3. State Transition Completeness Tracking

**Method**: Extract every `status:` update in the code and compare against the state transition map.

```
Verification steps:
1. Extract the list of allowed transitions from the state transition map (STATE_TRANSITIONS)
2. Search for the .update({ status: "..." }) pattern across all API routes
3. Confirm that each transition is defined in the map
4. Identify transitions defined in the map that are never executed in the code (dead transitions)
5. In particular: check that the transition from an intermediate state (e.g., generating_template) to a final state (template_approved) is not omitted
```

### 2-4. API Endpoint ↔ Frontend Hook 1:1 Mapping

**Method**: List every API route and every frontend hook and confirm they pair up.

```
Verification steps:
1. Extract the endpoint list by HTTP method from route.ts files under src/app/api/
2. Extract the list of fetch call URLs from use*.ts files under src/hooks/
3. Identify API endpoints that no hook calls → flag as "unused"
4. Judge whether "unused" is intentional (e.g., admin APIs) or not (a missing call)
```

---

## 3. QA Agent Design Principles

### 3-1. Use the general-purpose Type, Not the Explore Type

If the QA agent is of the `Explore` type, it can only read. But effective QA requires:
- Pattern searching with Grep (extract every `NextResponse.json()`)
- Running scripts for automated comparison (API shape vs. hook type)
- Making edits when necessary

**Recommendation**: Set it to the `general-purpose` type, but specify a "verify → report → request fix" protocol in the agent definition.

### 3-2. Prioritize "Cross-Comparison" Over "Existence Confirmation" in Checklists

| Weak Checklist | Strong Checklist |
|---------------|---------------|
| Does the API endpoint exist? | Does the API endpoint's response shape match the corresponding hook's type? |
| Is the state transition map defined? | Does every status update in the code match a transition in the map? |
| Does the page file exist? | Does every link in the code point to an actually existing page? |
| Is TypeScript in strict mode? | Is there any type safety bypassed by generic casting? |

### 3-3. The "Read Both Sides at Once" Principle

To catch boundary bugs, QA must not read only one side. It must always:
- Read the API route **and** the corresponding hook **together**
- Read the state transition map **and** the actual update code **together**
- Read the file structure **and** the link paths **together**

State this principle explicitly in the agent definition.

### 3-4. Run QA Right After Each Module Is Complete, Not After the Build

If the orchestrator places QA only at "Phase 4: after everything is complete":
- Bugs accumulate, driving up the cost of fixing them
- Early boundary mismatches propagate into downstream modules

**Recommended pattern**: As each backend API is completed, immediately perform cross-verification of that API plus its corresponding hook (incremental QA).

---

## 4. Verification Checklist Template

An integration coherence checklist for web applications, to be included in the QA agent definition.

```markdown
### Integration Coherence Verification (Web App)

#### API ↔ Frontend Connection
- [ ] Every API route's response shape matches the corresponding hook's generic type
- [ ] Wrapped responses ({ items: [...] }) are unwrapped in the hook
- [ ] snake_case ↔ camelCase conversion is applied consistently
- [ ] Immediate responses (202) and final results are distinguished on the frontend
- [ ] Every API endpoint has a corresponding frontend hook that is actually called

#### Routing Coherence
- [ ] Every href/router.push value in the code matches an actual page file path
- [ ] Path verification accounts for route groups ((group)) being removed from the URL
- [ ] Dynamic segments ([id]) are filled with the correct parameters

#### State Machine Coherence
- [ ] Every defined state transition is executed in the code (no dead transitions)
- [ ] Every status update in the code is defined in the transition map (no unauthorized transitions)
- [ ] The transition from an intermediate state to a final state is not omitted
- [ ] The X in the frontend's state-based branching (if status === "X") is actually reachable

#### Data Flow Coherence
- [ ] The mapping between DB schema field names and API response field names is consistent
- [ ] Frontend type definitions and API response field names match
- [ ] null/undefined handling for optional fields is consistent on both sides
```

---

## 5. QA Agent Definition Template

The core section to include in the build harness's QA agent.

```markdown
---
name: qa-inspector
description: "QA verification specialist. Verifies spec compliance, integration coherence, and design quality."
---

# QA Inspector

## Core Role
Verify implementation quality against the spec and **integration coherence between modules**.

## Verification Priority

1. **Integration coherence** (highest) — boundary mismatches are the main cause of runtime errors
2. **Functional spec compliance** — API/state machine/data model
3. **Design quality** — color/typography/responsiveness
4. **Code quality** — unused code, naming conventions

## Verification Method: "Read Both Sides at Once"

Boundary verification must always **open both sides of the code simultaneously** and compare:

| Verification Target | Left (Producer) | Right (Consumer) |
|----------|-------------|---------------|
| API response shape | NextResponse.json() in route.ts | fetchJson<T> in hooks/ |
| Routing | page file path in src/app/ | href, router.push values |
| State transition | STATE_TRANSITIONS map | .update({ status }) code |
| DB → API → UI | table column name | API response field → type definition |

## Team Communication Protocol

- On discovery, immediately send a specific fix request to the responsible agent (file:line + fix method)
- Notify **both** agents on either side of a boundary issue
- To the leader: a verification report (distinguishing passed/failed/unverified items)
```

---

## Real Case Study: Bugs Found in SatangSlide

Everything in this guide is a lesson extracted from the following real bugs:

| Bug | Boundary | Cause |
|------|--------|------|
| `projects?.filter is not a function` | API→hook | API returns `{projects:[]}`, hook expects an array |
| All dashboard links 404 | file path→href | Missing `/dashboard/` prefix |
| Theme images not showing | API→component | `thumbnailUrl` vs. `thumbnail_url` |
| Theme selection not saved | API→hook | select-theme API exists, no hook |
| Generation page waits forever | state transition→code | Missing `template_approved` transition code |
| `data.failedIndices` crash | immediate response→frontend | Accessing the background result from the immediate response |
| 404 when viewing slides after completion | file path→href | `/projects/` → `/dashboard/projects/` |
