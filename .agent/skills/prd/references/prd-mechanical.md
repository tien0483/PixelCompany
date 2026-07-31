# Mechanical-Engineering PRD Reference

Load this when the requested work is a **hardware/mechanical component** (enclosure, structural part, mechanism, CAD/FEA-validated hardware) rather than software. It defines the clarifying questions and PRD structure for that domain. The developer/reader here is a **Junior Mechanical Engineer or CAD Designer** who will design, model (3D CAD), draft (2D drawings), and validate (basic FEA) the part.

## Clarifying Questions (ask 3–5, lettered A–D)

Ask only critical gaps not inferable from the prompt. Focus on mechanical, structural, manufacturing, and environmental boundaries.

Key areas:
- **Operating environment & IP rating:** indoor, outdoor, extreme temperatures, dust/water exposure.
- **Manufacturing process & volume:** CNC, injection molding, sheet metal, 3D printing (SLA/FDM/SLS); prototype vs high volume.
- **Loads & kinematics:** static/dynamic load, torque, vibration, duty cycles.
- **Envelope & mass constraints:** max physical size, max allowable weight.
- **Interface & mating parts:** fastener preferences, existing enclosures, cable pass-throughs, mounting patterns.

Example format:
```
1. What is the expected manufacturing volume and primary production process?
   A. Prototype / Low Volume (3D Printing / CNC Machining)
   B. Medium Volume (Sheet Metal Stamping / Urethane Casting)
   C. High Volume (Plastic Injection Molding / Die Casting)
   D. Undecided / Need DFM Recommendation

2. What are the primary environmental requirements?
   A. Indoor controlled environment (Office/Home, 0°C to 40°C)
   B. Harsh outdoor environment (Rain/Dust, IP65+, -20°C to 60°C)
   C. Industrial environment (High vibration, oil/chemical exposure)
   D. Thermal management critical (High heat output component)

3. What is the target material preference?
   A. Engineering Plastics (ABS, PC, Nylon)
   B. Light Metals (Aluminum 6061/7075)
   C. Structural Steel / Stainless Steel
   D. Flexible / Elastomers (TPU, Silicone)
```

## PRD Structure

Use `assets/prd-mechanical-template.md`. Sections:

1. **Executive Summary & System Overview** — the component/assembly, its function in the product, the problem it solves.
2. **Physical & Envelope Targets** — dimensions/space envelope (X×Y×Z), target weight/mass budget, target unit cost (BOM), if applicable.
3. **Functional & Mechanical Requirements** — numbered `REQ-ME-01`, …: structural/load-bearing (load limits, yield strength, safety factors), kinematics/motion (range, DOF, friction/torque), materials & finishes (surface treatment, VDI/SPI texture), tolerances (ISO classes, press-fit vs clearance).
4. **Interface & Assembly Requirements (DFM/DFA)** — mating components (datums, alignment features), fasteners & joining (screws, heat stakes, snap-fits, welding, adhesives), design-for-assembly (sequence, poka-yoke).
5. **Environmental & Regulatory Compliance** — thermal range, IP rating, shock & vibration (drop test, transport vibration), compliance (RoHS, REACH, UL94-V0, ISO).
6. **Non-Goals (Out of Scope)** — e.g. "PCB design handled by EE team," "cosmetic surfacing out of scope for early prototype."
7. **Verification & Testing Plan** — FEA/simulation (stress/strain, thermal, CFD), physical testing (drop height, cycle testing, thermal chamber).
8. **Open Questions & Engineering Risks** — unresolved design choices, tooling long-lead risks, material availability.

## Style Requirements

- Explicit, unambiguous, mathematically verifiable where possible.
- Metric units: mm, N, N·m, kg, IP ratings, °C.
- Detailed enough to guide 3D CAD modeling, 2D production drawings, and basic FEA.
- Do NOT start CAD or code — output the PRD document only.
