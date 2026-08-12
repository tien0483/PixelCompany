# Skill Testing & Iterative Improvement Guide

Methodology for validating the quality of harness-generated skills and improving them iteratively. A supplementary reference for Phase 6 of SKILL.md.

---

## Table of Contents

1. [Testing Framework Overview](#1-testing-framework-overview)
2. [Writing Test Prompts](#2-writing-test-prompts)
3. [Execution Testing: With-skill vs Baseline](#3-execution-testing-with-skill-vs-baseline)
4. [Quantitative Evaluation: Assertion-based Scoring](#4-quantitative-evaluation-assertion-based-scoring)
5. [Leveraging Specialized Agents](#5-leveraging-specialized-agents)
6. [Iterative Improvement Loop](#6-iterative-improvement-loop)
7. [Description Trigger Validation](#7-description-trigger-validation)
8. [Workspace Structure](#8-workspace-structure)

---

## 1. Testing Framework Overview

Skill quality validation is a combination of **qualitative evaluation** and **quantitative evaluation**.

| Evaluation Type | Method | Suitable Skills |
|----------|------|-----------|
| **Qualitative** | User directly reviews the output | Subjective quality such as writing style, design, creative work |
| **Quantitative** | Assertion-based automated scoring | Objectively verifiable cases such as file creation, data extraction, code generation |

Core loop: **write → run test → evaluate → improve → re-test**

---

## 2. Writing Test Prompts

### Principles

A test prompt should be a **specific, natural sentence that a real user would actually type**. Abstract or artificial prompts have low testing value.

### Bad Examples

```
"Process the PDF"
"Extract the data"
"Generate a chart"
```

### Good Examples

```
"In 'Q4_Revenue_Final_v2.xlsx' in my Downloads folder, use column C (revenue)
and column D (cost) to add a profit margin (%) column. Then sort in descending
order by profit margin."
```

```
"Extract the table on page 3 of this PDF and convert it to CSV. The table header
spans two rows, so the first row is the category and the second row is the actual
column names."
```

### Prompt Diversity

- Mix **formal / casual** tones
- Mix **explicit / implicit** intent (cases that state the file format directly vs. cases that must be inferred from context)
- Mix **simple / complex** tasks
- Include abbreviations, typos, and casual phrasing in some

### Coverage

Start with 2-3 prompts, but design them to cover:
- 1 core use case
- 1 edge case
- (optional) 1 compound task

---

## 3. Execution Testing: With-skill vs Baseline

### 3-1. Comparative Execution Structure

For each test prompt, spawn two subagents **simultaneously**:

**With-skill run:**
```
Prompt: "{test prompt}"
Skill path: {skill path}
Output path: _workspace/iteration-N/eval-{id}/with_skill/outputs/
```

**Baseline run:**
```
Prompt: "{test prompt}"  (identical)
Skill: none
Output path: _workspace/iteration-N/eval-{id}/without_skill/outputs/
```

### 3-2. Choosing the Baseline

| Situation | Baseline |
|------|----------|
| Creating a new skill | Run the same prompt without the skill |
| Improving an existing skill | The pre-modification skill version (preserve a snapshot) |

### 3-3. Capturing Timing Data

Save `total_tokens` and `duration_ms` from the subagent completion notification **immediately**. This data is only accessible at the moment of notification and cannot be recovered afterward.

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

---

## 4. Quantitative Evaluation: Assertion-based Scoring

### 4-1. Writing Assertions

When the output is objectively verifiable, define assertions for automated scoring.

**Good assertions:**
- Can be objectively judged true/false
- Have a descriptive name so it is clear what is being checked just from the result
- Verify the core value of the skill

**Bad assertions:**
- Ones that always pass regardless of whether the skill is present (e.g., "output exists")
- Ones that require subjective judgment (e.g., "well written")

### 4-2. Programmatic Verification

If an assertion can be verified by code, write it as a script. This is faster and more reliable than checking by eye, and reusable across iterations.

### 4-3. Beware of Non-discriminating Assertions

An assertion that "passes 100% in both configurations" cannot measure the skill's differential value. When you find such an assertion, remove it or replace it with a more challenging assertion.

### 4-4. Scoring Result Schema

```json
{
  "expectations": [
    {
      "text": "Profit margin column added",
      "passed": true,
      "evidence": "Confirmed 'profit_margin_pct' column in column E"
    },
    {
      "text": "Sorted in descending order by profit margin",
      "passed": false,
      "evidence": "No sorting; original order preserved"
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 1,
    "total": 2,
    "pass_rate": 0.50
  }
}
```

---

## 5. Leveraging Specialized Agents

Using agents with specialized roles during the testing/evaluation process improves quality.

### 5-1. Grader

Performs assertion-based scoring and cross-verifies by extracting verifiable claims from the output.

**Role:**
- Pass/fail judgment per assertion + supporting evidence
- Extract factual claims from the output and verify them
- Feedback on the quality of the eval itself (suggestions when an assertion is too easy or ambiguous)

### 5-2. Comparator (Blind Comparator)

Anonymizes the two outputs as A/B and judges quality without knowing which one used the skill.

**When to use:** When you want to rigorously confirm "is the new version really better?" Can be skipped in ordinary iterative improvement.

**Judgment criteria:**
- Content: accuracy, completeness
- Structure: organization, formatting, usability
- Overall score

### 5-3. Analyzer

Analyzes statistical patterns in the benchmark data:
- Non-discriminating assertions (both configurations pass → no discriminating power)
- High-variance evals (results vary greatly run to run → unstable)
- Time/token trade-offs (cases where the skill raises quality but also raises cost)

---

## 6. Iterative Improvement Loop

### 6-1. Collecting Feedback

Show the output to the user and gather feedback. Interpret empty feedback as "no issues."

### 6-2. Improvement Principles

1. **Generalize the feedback** — a narrow fix that only fits the test example is overfitting. Fix at the level of principle.
2. **Remove what doesn't earn its weight** — read the transcript, and if the skill is making the agent do unproductive work, delete that part.
3. **Explain the Why** — even if the user's feedback is terse, understand why it matters and reflect that understanding in the skill.
4. **Bundle repetitive work** — if the same helper script is generated in every test run, include it up front in `scripts/`.

### 6-3. Iteration Procedure

```
1. Modify the skill
2. Re-run all test cases in a new iteration-N+1/ directory
3. Present the results to the user (compared against the previous iteration)
4. Collect feedback
5. Modify again → repeat
```

**Termination conditions:**
- The user is satisfied
- All feedback is empty (no issues with any output)
- No more meaningful improvement remains

### 6-4. Draft → Review Pattern

When modifying a skill, write a draft and then **re-read it with fresh eyes** to improve it. Do not try to write it perfectly in one pass; go through a draft-review cycle.

---

## 7. Description Trigger Validation

### 7-1. Writing Trigger Eval Queries

Write 20 eval queries — 10 should-trigger + 10 should-NOT-trigger.

**Query quality criteria:**
- Specific, natural sentences that a real user would actually type
- Include concrete details such as file paths, personal context, column names, company names
- Mix a variety of lengths, tones, and formats
- Focus on **edge cases** rather than clear-cut correct answers

**Should-trigger queries (8-10):**
- The same intent phrased in various ways (formal/casual)
- Cases that don't explicitly mention the skill/file type but clearly need it
- Non-mainstream use cases
- Cases that compete with another skill but where this skill should win

**Should-NOT-trigger queries (8-10):**
- **Near-misses are key** — queries with similar keywords where a different tool/skill is appropriate
- Obviously unrelated queries ("write a Fibonacci function") have no testing value
- Adjacent domains, ambiguous phrasing, keyword overlap but different context

### 7-2. Validating Conflicts with Existing Skills

Check that the new skill's description does not overlap with the trigger areas of existing skills:

1. Collect the descriptions of the existing skill list
2. Check that the new skill's should-trigger queries don't wrongly trigger an existing skill
3. When a conflict is found, describe the boundary conditions in the description more clearly

### 7-3. Automated Optimization (Optional Advanced Feature)

When description optimization is needed:

1. Split the 20 eval queries into Train (60%) / Test (40%)
2. Measure trigger accuracy with the current description
3. Analyze failure cases and generate an improved description
4. Select the best description based on the Test set (not the Train set — to prevent overfitting)
5. Repeat up to 5 times

> This process is performed by an automation script using `claude -p`. Because the token cost is high, run it as a final step after the skill is sufficiently stable.

---

## 8. Workspace Structure

A directory structure for systematically managing test/evaluation results:

```
{skill-name}-workspace/
├── iteration-1/
│   ├── eval-descriptive-name-1/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/
│   │   │   ├── outputs/
│   │   │   ├── timing.json
│   │   │   └── grading.json
│   │   └── without_skill/
│   │       ├── outputs/
│   │       ├── timing.json
│   │       └── grading.json
│   ├── eval-descriptive-name-2/
│   │   └── ...
│   └── benchmark.json
├── iteration-2/
│   └── ...
└── evals/
    └── evals.json
```

**Rules:**
- eval directories use **descriptive names**, not numbers (e.g., `eval-multi-page-table-extraction`)
- Each iteration is preserved in an independent directory (do not overwrite previous iterations)
- Do not delete `_workspace/` — it is for post-hoc verification and audit trails
