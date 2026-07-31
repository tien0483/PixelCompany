---
name: checkbox_design
description: "Audits user interface mockups, wireframes, code snippets, or product descriptions to ensure checkbox components adhere to modern UX best practices, maximize accessibility, and avoid common usability blunders."
---

# UI/UX Checkbox Design Optimizer

**Core Function**: Analyzes a given UI scenario, identifies violations of design standards, and provides actionable, step-by-step correction instructions.

## 1. Behavioral Assessment (Single vs. Multi-select)
**Rule 1: Visual Identity & Intent**
- Guideline: Checkboxes MUST be visually distinct from radio buttons. Checkboxes must be squares (indicating multiple selections allowed); radio buttons must be circles (indicating mutually exclusive single selection).
- Pitfall to avoid: Using similar shapes or ambiguous tokens for both controls, which confuses the user's mental model.

## 2. Spatial Layout Analysis (Alignment and Orientation)
**Rule 2: Alignment and Formatting**
- Guideline: Single checkboxes must align precisely with their text labels to maintain visual balance and prevent the label from looking disconnected.
- Layout Direction: Always arrange multiple checkboxes vertically (stacked). This facilitates fast scanning and keeps forms compact.
- Pitfall to avoid: Horizontal alignment, which impairs readability and breaks visual parsing on varying screen widths.

## 3. Quantitative Check (Number of options and duplication)
**Rule 3: Quantity Management**
- Guideline: Limit checkbox lists to 5–7 options. If a list exceeds 5–7 choices, replace the checkboxes with a multi-select dropdown field containing selected tags to prevent visual clutter.
- Pitfall to avoid: Listing dozens of checkboxes sequentially, creating unnecessary cognitive friction.

## 4. Hitbox & Interaction Scrutiny
**Rule 4: Hitbox Optimization**
- Guideline: Enlarge the target interaction area. The entire label text must be clickable, not just the tiny square box.
- Advanced Enhancement: For high-priority desktop or mobile selections, convert checkboxes into larger, visually distinct "Check Tokens" (styled clickable buttons with checkmarks) to facilitate easier selection.

## 5. Copywriting & Microcopy Audit
**Rule 5: Wording & Microcopy Rules**
- Positive Framing: Never use negative wording in labels (e.g., Avoid "No", "Not Interested"). Checkboxes imply affirmation. To offer an opt-out experience, pre-check positive labels by default and allow unchecking (consider adding a strikethrough for visual clarity when unchecked).
- No Redundancy/Duplication: Do not use multiple checkboxes to specify different quantities of the exact same item (e.g., "[ ] 1 License", "[ ] 2 Licenses"). Use a number picker/stepper component instead.
- Label Formatting: Use plural labels when users can select more than one option to inherently signal inclusivity. Clearly explain the immediate impact of checking/unchecking the box.
- Contextual Help: Provide text links for deeper information rather than burying critical information entirely inside hover-triggered tooltips.

## 6. Mutual Exclusion Logic without Confusing Radio Buttons
**Rule 6: Mutual Exclusion Logic**
- Guideline: If options are mutually exclusive but radio buttons look visually unappealing, use Tokens WITHOUT checkmarks/dots. Removing the symbols prevents user confusion over selection rules while making selection states clear.

## 7. System Performance & States
**Rule 7: System Performance & States**
Pitfalls to avoid:
- Triggering auto-submit functions on checkbox state changes without giving the user a clear warning.
- Hiding critical options behind collapsed accordion/component groups.
- Having poor visual contrast between the default, hover, focused, disabled, and indeterminate states.
- Missing keyboard navigation support (Tab + Spacebar interaction).
