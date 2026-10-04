# Counterpoise — Policy Schema Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Covers:** YAML policy file schema, jurisdiction override pack schema, validation rules, versioning, starter config structure, translation attestation, control library schema, OQ-PV-1 envelope semantics

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Martin Kleppmann | *Designing Data-Intensive Applications* (O'Reilly 2017) | Schema evolution, forward/backward compatibility, data model fit |
| Michael Keeling | *Design It!* (Pragmatic Bookshelf 2017) | ADR-style decision capture for schema choices |
| Dan Vanderkam | *Effective TypeScript* (2nd ed., O'Reilly 2024) | TypeScript interface definitions matching the YAML schema |
| NIST | *AI Risk Management Framework (AI RMF 1.0)* | AI governance schema grounding |
| SS1/23 | PRA *Model Risk Management Principles* (2023) | Pack rule structure, confidence scoring |
| EU AI Act | *Regulation (EU) 2024/1689* | Annex III hard-line classification |
| SR 26-2 | Fed/OCC/FDIC *Model Risk Management* (2026) | Track III assignment, GenAI governance |

---

## 1. Purpose

This spec defines the exact schema for:
1. `policy/appetite.yaml` — the main policy file the bank customises
2. `policy/packs/*.yaml` — jurisdiction override pack files
3. The TypeScript interfaces that correspond to each schema
4. Validation rules enforced by `src/store/policy.ts` (CF-5)
5. The starter config pre-population strategy (PE-8, CF-2)

The policy file is the bank's Risk Appetite Framework expressed in machine-readable form. Every verdict traces back to a rule in this file.

---

## 2. Architecturally Significant Requirements

| ASR | Requirement | Impact |
|---|---|---|
| Policy file human-readable | CF-1, NF-6 | YAML with inline comments; no minification |
| Policy versioned | CF-3 | `version` field incremented on each change; recorded in every verdict |
| Pack independence | CF-4 | Packs are separate files; updating one pack doesn't change the main file version |
| Validation at load time | CF-5 | Invalid policy = evaluation disabled; exact field named in error |
| Primary source citation per rule | RA-7 | Every pack rule has a `source` block — no source = invalid |
| Interpretive basis per rule | RA-8 | Every pack rule has `basis: verbatim \| derived \| judgement` (V2-E; replaces `confidence`) |
| Human sign-off per pack | NF-7 | Pack header needs `reviewer_name`, `reviewer_role`, `sign_off_date`; rules inherit it (V2-E) |
| Translation attestation | NF-10 | Main policy file has `translation_attestation` block |
| Control library resolves invariants | CS-1, CS-2 | Each control declares which invariants it resolves + burden score |
| Envelope semantics | OQ-PV-1, PV-1–3 | Ordinal (≤ ceiling) and set (⊆ subset) dimensions (V2+ schema, declare now) |
| Schema evolution | Kleppmann Ch. 4 | Forward compatibility: unknown fields are ignored; required fields are enforced |

---

## 3. Main Policy File Schema

### 3.0 Canonical attribute vocabulary

All condition values in hard lines, track rules, tier rules, invariants, and pack rule effects **must** use the closed enums below. CF-5 validation rejects any condition value outside this vocabulary. The LLM extractor's JSON schema uses these as `enum` constraints; structured form selects come from the same source.

```typescript
// Canonical enums — src/engine/types.ts

export type DataClass =
  | 'Public'
  | 'Internal'
  | 'Confidential'
  | 'Client PII'
  | 'MNPI';

export type DataZone =
  | 'Zone A'        // External / public internet
  | 'Zone B'        // Cloud / managed third-party
  | 'Zone C';       // Internal only (MNPI boundary)

export type ModelType =
  | 'statistical'
  | 'traditional-ml'
  | 'ml'
  | 'deep-learning'
  | 'llm'
  | 'generative-ai'
  | 'agentic';

export type Exposure =
  | 'internal-only'
  | 'internal-shared'
  | 'client-facing'
  | 'market-facing';

export type DecisionBindingness =
  | 'non-binding'
  | 'advisory'
  | 'material'
  | 'binding';

// Derived from grounding/raf-extraction.md §A and §E
export type ActionType =
  | 'read'
  | 'inform'   // added 2026-08-17 (sweep-001): answers/presents directly; matches no strict action list
  | 'draft'
  | 'recommend'
  | 'execute'
  | 'trade'
  | 'approve';

export type DecisionType =
  | 'credit-decision'
  | 'lending-decision'
  | 'fraud-detection'
  | 'trading'
  | 'pricing'
  | 'hiring'
  | 'regulatory-reporting'
  | 'operational';

// v1.4 (2026-08-31) — agentic infrastructure-access vocabulary, grounded in
// grounding/proposed-rules/agentic-infrastructure-access.md. Optional on the
// graph: absent means "not stated" and no condition fires on it.
export type SystemAccessScope =
  | 'none'
  | 'shared_infrastructure'
  | 'credentialed_systems'
  | 'deployment_authority';

// multi_instance_coordination: 'yes' | 'no' | 'unknown' — a string enum, not
// boolean, because 'unknown' is a real answer distinct from unanswered and
// deliberately fires INV-AGENT-COORD-01.
```

### 3.1 Top-level structure

```yaml
# policy/appetite.yaml
# Counterpoise Risk Appetite Framework — [FIRM] Bank
# Edit this file to configure your organisation's AI risk appetite.
# Fields marked [FIRM] must be replaced before use in production.

version: "1.0"                    # Increment on every change
policy_id: "RAF-001"              # Stable identifier across versions
firm_name: "[FIRM]"               # Your organisation name

translation_attestation:
  attested_by: "[FIRM] — 2LoD Lead"
  role: "Head of AI Governance"
  date: "2026-05-01"
  raf_version_checked: "Board-approved AI RAF v2.1 (dated 2026-04-15)"

hard_lines: [...]                 # Use cases always Rejected — no controls apply
tracks: [...]                     # Ordered track classification rules
tiers: [...]                      # Impact-dominant materiality tiering
invariants: [...]                 # RAF rules evaluated against the graph
controls: [...]                   # Control library
kri_thresholds: {...}             # Six KRI dimension thresholds
jurisdictions: [...]              # Maps jurisdiction codes to pack files
roles:
  "1LoD": { access: "own" }
  "2LoD": { access: "all" }
tier_workflow:
  Critical: "2LoD-approve"
  High: "2LoD-approve"
  Medium: "2LoD-notify"
  Low: "self-service"
safety_margin: 0.10               # 10% safety margin for control solver (CS-1)
```

### 3.2 Hard lines schema

```yaml
hard_lines:
  - id: "HL-001"
    description: "Level 4 autonomy on irreversible client-facing actions"
    condition:
      autonomy_level: { gte: 4 }
      output_reversibility: "irreversible"
      exposure: { in: ["client-facing", "market-facing"] }
    reason: "No control set can bring fully autonomous, irreversible, client-facing AI within appetite."
    regulatory_basis: "SS1/23 §3.8; SR 26-2 §IV"
  
  - id: "HL-002"
    description: "MNPI flowing to any external Zone A system"
    condition:
      data_class: { in: ["MNPI"] }
      data_zone: { in: ["Zone A external"] }
    reason: "MNPI outside Zone C violates market abuse prevention requirements."
    regulatory_basis: "MAR Article 8; MiFID II"

  - id: "HL-003"
    description: "Fully autonomous lending or credit decisions (no HITL)"
    condition:
      autonomy_level: { gte: 4 }
      decision_type: { in: ["lending", "credit"] }
      hitl: false
    reason: "EU AI Act Annex III §5(b) + Consumer Credit Directive require human oversight on credit decisions."
    regulatory_basis: "EU AI Act Annex III §5(b); Consumer Credit Directive 2023/2225"

  - id: "HL-004"
    description: "Fully autonomous trading decisions"
    condition:
      autonomy_level: { gte: 4 }
      decision_type: { in: ["trading"] }
    reason: "Fully autonomous trading decisions with no human oversight are outside appetite at any tier."
    regulatory_basis: "RAF §5 rule; MiFID II Article 17"

  - id: "HL-005"
    description: "Irreversible action above autonomy L1"
    condition:
      output_reversibility: "irreversible"
      autonomy_level: { gte: 2 }
    reason: "Irreversible actions require Level 1 or below regardless of tier."
    regulatory_basis: "HTML §7 — Irreversible actions require Level 1 or below regardless of tier"
```

**Hard line condition operators:**
- `{ gte: N }` — greater than or equal (numeric)
- `{ lte: N }` — less than or equal (numeric)
- `{ in: [...] }` — value is member of set
- `{ not_in: [...] }` — value is not member of set
- Bare value (e.g., `hitl: false`) — exact match

All conditions in a hard line are ANDed. A hard line trips when ALL conditions match.

### 3.3 Track classification rules

```yaml
tracks:
  - id: "TRACK-I"
    name: "Track I — Traditional MRM"
    description: "Traditional statistical/mathematical models producing quantitative outputs for material decisions"
    conditions:
      - field: "model_type"
        value: { in: ["statistical", "mathematical", "econometric", "traditional-ml"] }
      - field: "output_type"
        value: { in: ["quantitative", "score", "rating", "forecast"] }
      - field: "decision_bindingness"
        value: { in: ["material", "binding"] }
    short_circuit: true           # Stop evaluating further tracks if this matches
    regulatory_basis: "SS1/23 §3.4; SR 26-2 §II.A"
  
  - id: "TRACK-II"
    name: "Track II — AI on MRM"
    description: "ML/AI models within MRM scope under the applicable jurisdiction ceiling"
    conditions:
      - field: "model_type"
        value: { in: ["ml", "deep-learning", "llm", "generative-ai"] }
      - field: "output_type"
        value: { in: ["quantitative", "score", "recommendation"] }
      - field: "decision_bindingness"
        value: { in: ["material", "binding", "advisory"] }
    short_circuit: true
    regulatory_basis: "SS1/23 §3.4 (technology-agnostic); OSFI E-23 §2.1"
  
  - id: "TRACK-II-REPLACE"
    name: "Track II — Replaces prior model"
    description: "Any use case that replaces a prior model is subject to Track II regardless of model type"
    conditions:
      - field: "replaces_prior_model"
        value: true
    short_circuit: true
    regulatory_basis: "RAF §5 rule 3"

  - id: "TRACK-II-AUTONOMY"
    name: "Track II — High autonomy"
    description: "Use cases with autonomy level ≥ 3 are subject to Track II"
    conditions:
      - field: "autonomy_level"
        value: { gte: 3 }
    short_circuit: true
    regulatory_basis: "RAF §5 rule 4"
    note: "Override-rate-at-registration clause of rule 4 is deferred to V2 monitoring."

  - id: "TRACK-III"
    name: "Track III — AI Governance"
    description: "Generative and agentic AI outside MRM scope (SR 26-2 exclusion); governed by AI Governance Track"
    conditions:
      - field: "model_type"
        value: { in: ["llm", "generative-ai", "agentic"] }
      - field: "decision_bindingness"
        value: { in: ["non-binding", "draft", "assist"] }
    short_circuit: true
    regulatory_basis: "SR 26-2 §III.C (GenAI excluded from MRM pending RFI)"
```

Track rules are evaluated in order. **First match wins** (short-circuit). A use case that matches no rule is flagged as an evaluation error requiring manual classification.

### 3.4 Tier rules (impact-dominant)

```yaml
tiers:
  - id: "TIER-CRITICAL"
    name: "Critical"
    description: "Highest materiality — requires 2LoD approval + full model validation pipeline"
    triggers:                     # ANY trigger fires → Critical (impact-dominant, not multiplicative)
      - field: "decision_type"
        value: { in: ["credit-decision", "lending-decision", "fraud-detection"] }
        regulatory_basis: "EU AI Act Annex III §5(b); OSFI E-23 §4.2"
      - field: "exposure"
        value: { in: ["market-facing", "systemic"] }
      - field: "data_class"
        value: "MNPI"
        and:
          field: "autonomy_level"
          value: { gte: 3 }
      - description: "Client- or market-facing at scale"
        conditions:
          - field: "exposure"
            value: { in: ["client-facing", "market-facing"] }
          - field: "scale"
            value: "at_scale"
        regulatory_basis: "grounding/raf-extraction.md §D"
      - field: "decision_type"
        value: { in: ["capital", "client financial outcome"] }
        regulatory_basis: "grounding/raf-extraction.md §D"
  
  - id: "TIER-HIGH"
    name: "High"
    triggers:
      - field: "exposure"
        value: { in: ["client-facing", "regulatory-reporting"] }
      - field: "autonomy_level"
        value: { gte: 3 }
      - field: "data_class"
        value: { in: ["Client PII", "MNPI"] }
  
  - id: "TIER-MEDIUM"
    name: "Medium"
    triggers:
      - field: "exposure"
        value: { in: ["internal-shared", "cross-team"] }
      - field: "autonomy_level"
        value: { in: [2] }
  
  - id: "TIER-LOW"
    name: "Low"
    triggers:
      - field: "exposure"
        value: "internal-only"
        and:
          field: "data_class"
          value: { in: ["Public", "Internal"] }
          and:
            field: "autonomy_level"
            value: { lte: 1 }
```

Tier evaluation: **highest-tier-wins, order-independent**. All tier triggers are evaluated; the highest matching tier is assigned. Permuting the `tiers` array never changes any verdict. A use case matching a Critical trigger is Critical regardless of other factors.

### 3.5 Invariants schema

```yaml
invariants:
  - id: "INV-DATA-01"
    description: "Client PII must not flow to an external model endpoint without encryption in transit"
    condition:
      data_class: { in: ["Client PII"] }
      data_zone: { in: ["Zone A external", "Zone B cloud"] }
    required_controls: ["CTRL-ENC-01"]
    severity: "High"
  
  - id: "INV-ZONE-01"
    description: "MNPI must remain within Zone C"
    condition:
      data_class: "MNPI"
      data_zone: { not_in: ["Zone C internal"] }
    required_controls: []         # No control resolves this — hard line HL-002 catches it first
    severity: "Critical"
    regulatory_basis: "MAR Article 8; MiFID II"   # optional (V1.1-C01) — citation surfaced in the verdict explanation
```

### 3.6 Control library schema

```yaml
controls:
  - id: "CTRL-ENC-01"
    name: "Encryption in transit (TLS 1.3+)"
    description: "All data in transit to external endpoints must use TLS 1.3 or higher"
    resolves: ["INV-DATA-01", "INV-ZONE-03"]   # Which invariants this control satisfies
    burden: 1                     # 1=low, 5=high — used by solver for tie-breaking (CS-1)
    verification: "Deployment manifest shows TLS 1.3 endpoint; no HTTP fallback"
      - "azure-openai-internal"
      - "azure-openai-eu"
  
  - id: "CTRL-HITL-02"
    name: "Human review before action execution (HITL L2)"
    description: "Every action proposed by the AI must be reviewed and approved by a human before execution"
    resolves: ["INV-AUTO-01", "INV-AUTO-02"]
    burden: 3
    verification: "UI shows human approval step; audit trail records approval identity and timestamp"
  
  - id: "CTRL-LOG-01"
    name: "Full tool-call logging with kill switch"
    description: "All tool invocations logged to append-only store; kill switch disables execution within 1 hour"
    resolves: ["INV-AGENT-01", "INV-AGENT-02"]
    burden: 2
    verification: "Log store is append-only; kill-switch procedure documented and tested"
```

### 3.7 KRI thresholds

```yaml
kri_thresholds:
  performance:
    drift_pct:        { green: { lte: 3.0 }, amber: { lte: 7.0 }, red: { gt: 7.0 } }
    override_rate_pct:
      low_risk:       { green: { gte: 5.0, lte: 40.0 }, amber: { lte: 80.0 }, red: { gt: 80.0 } }
      high_risk:      { green: { gte: 5.0, lte: 20.0 }, amber: { lte: 50.0 }, red: { gt: 50.0 } }
  data_privacy:
    pii_incident_count: { green: 0, amber: { lte: 2 }, red: { gt: 2 } }
  technology:
    model_version_staleness_days: { green: { lte: 60 }, amber: { lte: 120 }, red: { gt: 120 } }
  conduct:
    bias_disparity_pct: { green: { lte: 1.5 }, amber: { lte: 3.0 }, red: { gt: 3.0 } }
  third_party_concentration:
    single_vendor_share_pct: { green: { lte: 40.0 }, amber: { lte: 60.0 }, red: { gt: 60.0 } }
  autonomy:
    level_4_approval_required: true
```

### 3.8 Jurisdiction registry

```yaml
jurisdictions:
  - code: "UK"
    name: "United Kingdom"
    pack_files: ["packs/ss1-23.yaml"]
  - code: "US"
    name: "United States"
    pack_files: ["packs/sr-26-2.yaml"]
  - code: "EU"
    name: "European Union"
    pack_files: ["packs/eu-ai-act.yaml", "packs/dora.yaml"]   # Selecting EU activates both; DORA is not a separate jurisdiction
  - code: "CA"
    name: "Canada"
    pack_files: []   # declared, no assessed pack (v1.3)
  - code: "SG"
    name: "Singapore"
    pack_files: []   # declared, no assessed pack (v1.3)
  - code: "JP"
    name: "Japan"
    pack_files: []   # declared, no assessed pack (v1.3)
```

**DORA modeling note:** DORA is not a separately selectable jurisdiction code. Selecting `EU` activates both `eu-ai-act.yaml` and `dora.yaml`. The `pack_files` field is an array to support this pattern; RA-1 fit criterion updated accordingly.

---

## 4. Jurisdiction Pack Schema

Each pack file follows a strict schema. A pack that deviates from this schema is **invalid and rejected on load** (CF-5, RA-7).

```yaml
# policy/packs/ss1-23.yaml
pack_id: "SS1-23"
version: "2.0"
jurisdiction: "UK"
regulator: "PRA"
document: "Supervisory Statement SS1/23 — Model Risk Management Principles for Banks"
effective_date: "2023-05-17"
reviewer_name: "[FIRM] — Regulatory Affairs Lead"
reviewer_role: "Head of Model Risk"
sign_off_date: "2026-05-01"

rules:
  - id: "SS1-UK-TRACK-01"
    title: "Technology-agnostic MRM inclusion — independent validation required"
    source:
      document: "SS1/23"
      section: "§3.4"
      text: "[ILLUSTRATIVE — NOT VERBATIM — replace during P2-C03] Models that produce quantitative outputs used in material decisions require independent validation, regardless of the underlying technique (statistical, machine learning, or otherwise)."
    effect:
      type: "required_review"
      review: "Independent model validation (2LoD)"
      condition:
        output_type: { in: ["quantitative", "score", "recommendation"] }
        decision_bindingness: { in: ["material", "binding", "advisory"] }
    basis: "verbatim"
  
  - id: "SS1-UK-TIER-01"
    title: "Model risk appetite quantification"
    source:
      document: "SS1/23"
      section: "§2.1"
      text: "[ILLUSTRATIVE — NOT VERBATIM — replace during P2-C03] Firms must define and quantify their appetite for model risk, including for AI and ML models."
    effect:
      type: "required_control"
      control_id: "CTRL-RAF-01"
      condition:
        track: { in: ["II", "III"] }
    basis: "verbatim"
```

### V2-E — pack-level adoption, and `basis` instead of `confidence`

User feedback on the original design: *"who signed off on that
interpretation, and how confident they were — I don't know how this will
work, don't think it's practically implementable."* Two parts of that were
right, and both are fixed here.

**1. `confidence: High | Medium | Low` → `basis: verbatim | derived | judgement`.**
The confidence grade was subjective and uncalibrated. Two reviewers would
score the same rule differently, and nothing told a reader what "Medium"
obliged them to do — fabricated precision, which this product must not
produce. `basis` asks an objectively checkable question instead: does the
rule restate the quoted text, infer from it, or rest on legal judgement? A
reviewer verifies that by reading the rule against its own `source.text`,
with no number to invent.

| `basis` | Meaning | Caveat produced |
|---|---|---|
| `verbatim` | Restates the quoted passage; nothing read into it | none |
| `derived` | A direct inference from the quoted passage | medium — check the inference holds |
| `judgement` | Rests on a reading the passage does not settle | low — verdict is provisional |

**2. Sign-off moves from per-rule to per-pack.** Legal issues a position on
a regulation; they do not countersign each line of a YAML file. Requiring a
signature per rule made adoption a task no firm would finish, which left
every deployment permanently provisional — the exact failure the field was
meant to prevent. The **pack header** now carries `reviewer_name`,
`reviewer_role` and `sign_off_date`, and rules inherit it. Rule-level
sign-off fields remain valid but **optional**, for the rare rule a firm
signs off separately (a local deviation from the central interpretation).

NF-7 is unchanged in effect: a `[..]` placeholder in the governing
sign-off — pack-level, or rule-level where present — means unadopted, and
any verdict relying on that rule renders provisional.


> **V2-F (code review 001, C-1/C-2):** `controls[].platform_satisfies` was removed. It expressed the same fact as `platforms[].satisfies_controls` in the opposite direction — two representations of one piece of knowledge (Hunt & Thomas, DRY). Nothing ever read the control-keyed form, so its platform ids drifted to values that existed nowhere (`azure-openai-internal`) and could never fail at runtime. PV-1 words the relationship platform-first, so the registry direction is the requirement-sanctioned one.

### Pack rule effects

| Effect type | What it does |
|---|---|
| `tier_floor` | Sets a minimum tier (e.g., EU AI Act Annex III forces Critical) |
| `required_control` | Adds a specific control to the required set |
| `hard_line` | Treats matching use cases as hard-line rejected (pack-level hard lines) |
| `required_review` | Adds a downstream review requirement |

### Pack validation rules (enforced by `src/store/policy.ts`)

Every rule in a pack **must** have:
- `id` — unique within the pack, format `{PACK-CODE}-{CATEGORY}-{NN}`
- `source.document` — the regulation name
- `source.section` — the article/section number
- `source.text` — verbatim regulatory text (not paraphrased)
- `basis` — `verbatim | derived | judgement` (V2-E; replaced `confidence`)
- `reviewer_name` — name of the human reviewer
- `reviewer_role` — role of the reviewer
- `sign_off_date` — ISO 8601 date

A rule missing any of these fields causes the entire pack to be **rejected on load**. The error message identifies the pack ID and the missing field.

**Amended (GT7, 2026-10-04).** When the first problem is inside a rule, the error message names that rule's id as well: `pack <pack-id> rule <rule-id> rejected: missing/invalid field "<path>" — <schema message>` (e.g. field path `rules.0.source.text`; `PackLoadError` gains an optional `ruleId`). The rule id is read defensively from the raw document and omitted when it cannot be read (the message then names the pack only, as before). The app shows this text verbatim in the start-up banner and the Appetite framework screen (`cross-cutting.md` §5, CF-5; TC-CF-5-02, TC-RA-7-01).

---

## 5. TypeScript Interfaces

These interfaces live in `src/engine/types.ts` and are the canonical type definitions. Zod schemas (in `src/store/policy.ts`) are generated from these interfaces and used for runtime validation.

```typescript
// src/engine/types.ts

export type Track = 'I' | 'II' | 'III';
export type Tier = 'Critical' | 'High' | 'Medium' | 'Low';
export type Confidence = 'High' | 'Medium' | 'Low';
export type EffectType = 'tier_floor' | 'required_control' | 'hard_line' | 'required_review';
export type Scale = 'limited' | 'at_scale';  // Added to OutputNode (intake-flow.md §4.2) and UC-3a form
// Note: replaces_prior_model: boolean is added to ProcessingNode (intake-flow.md §4.2) and UC-3a form

export interface PolicyFile {
  version: string;
  policy_id: string;
  firm_name: string;
  translation_attestation: TranslationAttestation;
  hard_lines: HardLine[];
  tracks: TrackRule[];
  tiers: TierRule[];
  invariants: Invariant[];
  controls: Control[];
  kri_thresholds: KriThresholds;
  jurisdictions: JurisdictionEntry[];
  roles: Record<string, RoleConfig>;
  tier_workflow: Record<Tier, WorkflowType>;
  safety_margin: number;
  // Which tripped invariant a verdict reports as BINDING when several fire.
  // Comparators applied in order until one separates the candidates. Optional;
  // evaluate() falls back to ["severity", "control_burden", "id"].
  binding_constraint_order?: Array<'severity' | 'control_burden' | 'id'>;
  // explore-007 D-002 (2026-08-31): Track (I/II/III) is Counterpoise's own
  // oversight-regime category — this maps it to the firm's actual committee
  // names. Optional; absent means no mapping is claimed and only the generic
  // Track description renders. (Added to this spec block per code-review-004
  // F7 — the field shipped in src/engine/types.ts without the spec edit.)
  governance_mapping?: Partial<Record<Track, GovernanceMappingEntry>>;
}

export interface GovernanceMappingEntry {
  committee: string;   // the firm's own name for the owning committee/process
  note?: string;       // optional one-line rationale for the routing
}

export interface TranslationAttestation {
  attested_by: string;
  role: string;
  date: string;          // ISO 8601
  raf_version_checked: string;
}

export interface HardLine {
  id: string;
  description: string;
  condition: Condition;
  reason: string;
  regulatory_basis: string;
}

export interface Control {
  id: string;
  name: string;
  description: string;
  resolves: string[];           // Invariant IDs
  burden: 1 | 2 | 3 | 4 | 5;
  verification_evidence?: {            // V1.3 proof-carrying controls — absent = UNVERIFIED
    status: 'verified' | 'unverified';
    detail?: string;
    attested_by?: string;
    attested_at?: string;
    // R10-CE: optional COSO-style axes. Absent = legacy single-status
    // evidence, rendered unchanged. Never affects the verdict.
    design?:    { status: 'effective' | 'deficient' | 'not_assessed'; detail?: string };
    operating?: { status: 'effective' | 'deficient' | 'not_assessed'; detail?: string };
    // R16-W (W-7, D-77): scopes "verified" to the platforms/vendors it
    // actually covers. Absent = applies everywhere (pre-W-7 behaviour,
    // unchanged). At least one list must be non-empty when present (the
    // Zod schema's `.refine`, src/store/policy.ts). View-model concern
    // only (src/components/verdict-view-model.ts) — never changes which
    // controls the engine requires, only how "verified" is DISPLAYED:
    // when the processing node's platform/vendor is outside this scope,
    // or the graph is unavailable to check, the safeguard shows as
    // `outstanding`, not `verified` (never claimed, never silently
    // dropped — counted in the first screen's headline N).
    applies_to?: { platforms?: string[]; vendors?: string[] };
  };
  verification: string;
}

export interface JurisdictionPack {
  pack_id: string;
  version: string;
  jurisdiction: string;
  regulator: string;
  document: string;
  effective_date: string;
  reviewer_name: string;
  reviewer_role: string;
  sign_off_date: string;
  rules: PackRule[];
}

export interface PackRule {
  id: string;
  title: string;
  source: {
    document: string;
    section: string;
    text: string;
    source_url: string;      // URL to the primary source document
    retrieved_date: string;  // ISO 8601 date the document was retrieved
  };
  effect: PackRuleEffect;
  basis: PackBasis;                 // V2-E — replaces `confidence`
  // V2-E: optional. The pack header's sign-off governs unless a rule
  // carries its own (a firm's local deviation).
  reviewer_name?: string;
  reviewer_role?: string;
  sign_off_date?: string;
}

export type PackBasis = 'verbatim' | 'derived' | 'judgement';

export type PackRuleEffect =
  | { type: 'tier_floor'; minimum_tier: Tier; condition: Condition }
  | { type: 'required_control'; control_id: string; condition: Condition }
  | { type: 'hard_line'; condition: Condition; reason: string }
  | { type: 'required_review'; review_type: string; condition: Condition };
```

---

## 6. Validation Rules (src/store/policy.ts)

The loader performs these checks on every load. All checks must pass before the policy is marked valid.

### Main policy file checks
| Check | Error if failed |
|---|---|
| `version` field present and non-empty | `policy-invalid: version field missing` |
| `firm_name` not `[FIRM]` (warn but don't block) | Warning only: `firm_name is still [FIRM] placeholder` |
| `translation_attestation` block present | `policy-invalid: translation_attestation block missing` |
| `hard_lines` array present (may be empty) | `policy-invalid: hard_lines section missing` |
| `controls` array non-empty | `policy-invalid: controls section is empty — at least one control required` |
| `tracks` array has at least one rule | `policy-invalid: tracks section has no rules` |
| `tiers` array has at least one rule | `policy-invalid: tiers section has no rules` |
| `tier_workflow` maps all four tiers | `policy-invalid: tier_workflow missing entry for [tier]` |
| `safety_margin` between 0.0 and 1.0 | `policy-invalid: safety_margin must be 0.0–1.0` |

### Pack file checks (per pack)
| Check | Error if failed |
|---|---|
| Each rule has `source.document` | `pack-invalid: [pack-id] rule [rule-id] missing source.document` |
| Each rule has `source.section` | `pack-invalid: [pack-id] rule [rule-id] missing source.section` |
| Each rule has `source.text` | `pack-invalid: [pack-id] rule [rule-id] missing source.text` |
| Each rule has `basis` of `verbatim | derived | judgement` | `pack-invalid: [pack-id] rule [rule-id] invalid basis value` |
| Each rule has `reviewer_name` | `pack-invalid: [pack-id] rule [rule-id] missing reviewer_name` |
| Each rule has `sign_off_date` | `pack-invalid: [pack-id] rule [rule-id] missing sign_off_date` |
| Each rule has `source.source_url` | `pack-invalid: [pack-id] rule [rule-id] missing source.source_url` |
| Each rule has `source.retrieved_date` | `pack-invalid: [pack-id] rule [rule-id] missing source.retrieved_date` |
| `reviewer_name` does not contain `[FIRM]` or match a placeholder pattern | Rule treated as UNSIGNED → verdicts relying on it flagged provisional per NF-7 |
| All condition values conform to §3.0 canonical vocabulary | `pack-invalid: [pack-id] rule [rule-id] condition value [value] is not in canonical vocabulary for [field]` |

**Amended (GT7, 2026-10-04).** The `pack-invalid: …` strings in the table above are the intended wording, not the literal text. What the loader (`src/store/packs.ts`) produces is one message of the form `pack <pack-id> rule <rule-id> rejected: missing/invalid field "<path>" — <schema message>`, for the FIRST problem found in the pack (the path says which field; the rule id appears when the path starts `rules.<n>` and that rule's id is readable). A condition-vocabulary or condition-field problem is reported by a separate branch that already names the pack and the rule. A pack that fails is rejected whole (CF-5, RA-7).

### Validation output (TypeScript)

```typescript
export type PolicyValidationResult =
  | { valid: true; policy: PolicyFile; packs: Map<string, JurisdictionPack>; warnings: string[] }
  | { valid: false; errors: PolicyValidationError[]; warnings: string[] };

export interface PolicyValidationError {
  kind: 'policy-invalid' | 'pack-invalid';
  field: string;
  reason: string;
  packId?: string;   // Set for pack errors
}
```

---

## 7. Versioning Strategy (Kleppmann — Schema Evolution)

### Policy file versioning
- `version` field is a semver string (`"1.0"`, `"1.1"`, `"2.0"`)
- **Banks increment manually** — Counterpoise does not auto-increment on save (MVP)
- Every verdict stores the `version` at time of evaluation; historical verdicts are immutable

### Pack file versioning
- Each pack has its own `version` field independent of the main policy
- Pack updates do not change the main policy `version`
- Verdicts store `pack_versions: { "SS1-23": "2.0", "EU-AI-ACT": "1.1", ... }`

### Forward compatibility (Kleppmann Ch. 4)
- **Unknown fields are ignored** on load — a newer schema field added by the product team does not break an older policy file
- **Required fields are enforced** — if a new required field is added in a future schema version, old policy files without it produce a validation error with a clear upgrade instruction
- Schema version is tracked in the `PolicyFile` interface via a `schema_version` field (added at V1.5 when the schema stabilises)

---

## 8. ADR-002: Condition Language Design

**Decision:** Conditions in hard lines, track rules, tier rules, and pack rule effects use a minimal embedded condition language with four operators: `gte`, `lte`, `in`, `not_in`, and bare equality. No scripting, no arbitrary expressions.

**Status:** Accepted

**Context:** Conditions need to express things like "autonomy ≥ 4 AND exposure is client-facing." The alternatives are: (a) a rich expression language (Rego/OPA, CEL, JSONLogic); (b) a minimal operator set; (c) code-evaluated conditions (JavaScript functions in YAML).

**Options considered:**
1. **OPA/Rego** — powerful, auditable, but requires a Rego runtime in the browser. Significant bundle size. Overkill for the bounded condition set Counterpoise needs.
2. **JSONLogic** — compact JSON-encoded logic; browser-native; operator set is richer than needed. Less human-readable in YAML context.
3. **Minimal operator set** (`gte`, `lte`, `in`, `not_in`, bare equality, `and`) — sufficient for all current requirements. Human-readable. Easy to validate. No external runtime.

**Decision:** Minimal operator set (Option 3). The condition language covers all cases in the current requirements. If a future requirement needs richer logic, this decision can be revisited with an ADR superseding this one.

**Consequences:** `src/store/policy.ts` implements a simple condition evaluator (~100 lines). All conditions are statically analyzable (no eval, no dynamic code). Security: no injection risk from policy file contents.

---

## 9. ADR-003: OQ-PV-1 — Envelope Dimension Semantics (V2 schema, declared now)

**Decision:** Platform and vendor envelope dimensions use two semantic models: ordinal dimensions use `≤ ceiling` semantics; set dimensions use `⊆ subset` semantics. Both are expressed in the YAML schema now, even though envelope inheritance (PV-1 through PV-7) ships in V2+.

**Status:** Accepted

**Context:** OQ-PV-1 asks how to express that a platform is approved for "data class ≤ Internal" (an ordinal ceiling) vs "jurisdictions ⊆ {UK, EU}" (a set subset). Getting this wrong at the schema level means a retrofit when PV features ship.

**Decision:**
```yaml
# Platform envelope — declared in main policy file under platforms[] (V2+)
platforms:
  - id: "azure-openai-internal"
    name: "Azure OpenAI (Internal Zone)"
    envelope:
      data_class:
        type: "ordinal_ceiling"
        max_value: "Internal"             # data_class ≤ Internal
        order: ["Public", "Internal", "Confidential", "Client PII", "MNPI"]
      autonomy_level:
        type: "ordinal_ceiling"
        max_value: 2                      # autonomy_level ≤ L2
      jurisdictions:
        type: "set_subset"
        allowed: ["UK", "EU"]            # jurisdiction ⊆ {UK, EU}
      data_zone:
        type: "exact"
        value: "Zone B private"          # exact match
    satisfies_controls: ["CTRL-ENC-01", "CTRL-ACC-02", "CTRL-LOG-01", "CTRL-RES-03"]
```

**Consequences:** The `platforms[]` section is present in the schema from V1 but the engine does not process it (it's parsed and stored but the envelope-matching logic ships in V2+). This avoids a schema migration when V2+ ships.

---

## 10. Starter Config Pre-Population (PE-8, CF-2)

The starter `policy/appetite.yaml` ships pre-populated with:

| Section | Pre-populated content |
|---|---|
| `hard_lines` | 3 starter hard lines (HL-001 through HL-003 above) covering the most common absolute rejects |
| `tracks` | 3 track rules (Track I, II, III) using the RAF extraction (A–H rulebook) |
| `tiers` | 4 tier rules with the impact-dominant triggers from the RAF |
| `invariants` | 8 starter invariants covering data zone, MNPI, autonomy, agentic tool-calling, conduct/fairness, explainability |
| `controls` | 12 starter controls (encryption, HITL, logging, grounding, fingerprinting, drift monitoring, red-teaming, tool-call logging + kill switch, conduct testing, sampling, output validation, zone enforcement) |
| `kri_thresholds` | Default thresholds for all 6 KRI dimensions |
| `jurisdictions` | 6 jurisdictions declared; 4 pack files referenced across 3 of them (UK, US, EU). CA/SG/JP are declared with `pack_files: []` — see v1.3 |
| `tier_workflow` | Default mappings |
| `translation_attestation` | Placeholder with `[FIRM]` markers |

The starter config is derived directly from `grounding/raf-extraction.md` (sections A through H). A bank installing Counterpoise can evaluate its first use case without modifying the file — the `[FIRM]` markers produce verdicts labelled "Translation fidelity unattested" until they are filled in (NF-10).

---

## 10a. Round 11 — Approved-Model Registry (R11-MG-1)

Spec for `requirements/requirements-011.md`, grounded in
`grounding/ai-raf-template.html` §9 "Model approval and provenance" and
`grounding/raf-extraction.md` §I.

**ADR-PS-R11-1 — the registry is a top-level array on the policy file,
schema-validated like every other policy collection.** `PolicyFile` gains
`approved_models: ApprovedModel[]`, sorted by `model_id` before iteration
(NF-1 discipline — same determinism rule every other policy collection
already follows).

```typescript
export interface ApprovedModel {
  model_id: string;               // stable key, e.g. "qwen3:4b"
  vendor: string;
  provenance_class: 'vendor_hosted' | 'open_weights_self_hosted' | 'fine_tuned_in_house';
  is_approved: boolean;
  license_note?: string;
  benchmark_evidence?: {
    suite: string;                // named benchmark suite
    date: string;                 // ISO 8601
    finance_domain: boolean;      // §I: required for Track I/II or client-facing Track III
    detail?: string;
  };
  // R11-MG-1a (mid-build amendment): mutually exclusive with an entry
  // keyed purely by model_id — a FAMILY entry approves a version pattern
  // rather than one pinned string. model_id on a family entry is the
  // family's own label (e.g. "gpt-4o-*"), not a real model string.
  is_family?: boolean;
  version_pattern?: string;       // prefix match, e.g. "gpt-4o-" — no regex, no dynamic code (ADR-002 discipline)
}
```

**Amended 2026-10-03 (CR6-19).** `ApprovedModel` gains an optional `plain_name?: string`, the model's name in plain words. Labels and the questionnaire's "Recorded:" line show it, so a raw id such as `VENDOR-LLM-v1` never reaches a button the submitter clicks; a model without one shows a neutral "Model n" (CR7-35, below). It is accepted and kept by the policy schema (TC-CR6-19b). MODEL-NAMES (2026-10-03, policy v1.9): the owner supplied the two shipped names — `VENDOR-LLM-v1` is "A licensed AI model from an outside company (example)" (a demo placeholder, hence "(example)") and `qwen3:4b` is "A small open model running on your own computer" (TC-MN-01..04).

**UNSIGNED-MODEL and CR7-35 (2026-10-03).** Labels are built by one shared helper (`approvedModelOptionList`, `plain-copy.ts`) so the button, the "Recorded:" line and the review-screen row agree. A non-family entry with `is_approved: false` reads `{plain_name} — not yet accepted by your firm, so it gets an extra check`; an entry with no `plain_name` reads a neutral `Model n` (numbered among the unnamed, in list order, as suppliers are) instead of its raw id, and `checkPolicyReferences` warns (never errors) naming each such model. A declared id the policy does not list is shown as written (TC-UM-01, 02; TC-CR7-35a..c). A blank `plain_name` counts as none (TC-CR7-35d). On the result, the owed model review reads "your AI risk team accepting this model" whenever the policy lists the model — an exact entry or a matching family, whatever its accepted state now (a family lapsed by `reattest_by`, or a model accepted after the case was checked) — and "adding the model to your firm's list of known models" only when it does not (TC-UM-03, 04, 06, 07).

**ADR-PS-R11-1a — matching is exact-id-first, family-fallback; never
weakens Track II pinning.** `resolveApprovedModel(declaredModelId, registry)`
checks for an exact `model_id` match first; only if none exists does it
check family entries (`is_family: true`) by prefix match against
`version_pattern`, in the same sorted-by-`model_id` order as everything
else (NF-1). A family match returns the family entry's approval/provenance
— it never fabricates a specific version. Track II's existing
version-pinning control (evaluation-engine.md, silent-substitution
handling) is unaffected: family approval answers "may this model run at
all", pinning answers "which exact build was validated", and Track II
still requires the latter as its own piece of evidence regardless of
family approval status.

`is_approved: false` entries are valid and expected — the starter file
ships the demo's own local model exactly as approved/unapproved as its
authority state allows (unadopted policy ⇒ provisional, as everywhere
else in this schema). An unlisted `model_id` (absent from the array
entirely) and an `is_approved: false` entry both trip the same invariant
in the evaluation engine (`evaluation-engine.md` — engine-side, not
schema-side); the schema's only job is to validate the shape.

## 10b. Round 11 — Risk-Knowledge File Schema (R11-KL-1)

Deliberately **not** part of `PolicyFile` and **not** called a pack — a
separate file, separate loader, separate TypeScript type, so the
"knowledge never decides" boundary is structural rather than a naming
convention someone could quietly erode.

```typescript
// src/engine/knowledge-lens.ts — own module, own schema
export interface KnowledgeLensEntry {
  id: string;
  condition: Condition;            // src/engine/types.ts — the SAME condition language as §8 ADR-002 (matchesCondition in condition.ts), reused, not reinvented
  risk_domain: string;            // MIT taxonomy domain
  risk_subdomain: string;
  description: string;            // one line, plain English
  source_attribution: string;     // e.g. "MIT AI Risk Repository, CC BY 4.0"
}
```

No field on `KnowledgeLensEntry` can express a tier, control, hard line,
or verdict effect — the type itself has no such field, so a rule author
cannot smuggle a deciding effect in even by accident. `parseKnowledgeLens`
(zod) rejects any unrecognised key, closing the door on an ad-hoc
`effect:` field being added later without a spec change.

---

## 10c. Round 12 — Staleness, Re-attestation, Sampling Fields (R12-ST, R12-MG-1, R12-AB-1)

Spec for `requirements/requirements-012.md`.

**ADR-PS-R12-1 — time limits are authored data; the engine never reads a
clock.** New optional fields, all backward compatible (absent = no window,
legacy behaviour):

- Jurisdiction pack header: `max_staleness_days: number` — alongside the
  existing `retrieved_date`. Owned by the pack author.
- `ApprovedModel` family entries: `reattest_by: string` (ISO date) — a
  family entry past this date confers no approval; the declared model
  routes to the model-governance review exactly as if unlisted.
- `PolicyFile`: `sampling_rate: number` (1-in-K; default documented in the
  starter file) — drives the deterministic Low-tier sampling queue.
- `grounding/risk-knowledge.yaml` header block: `curated_by`,
  `curated_date`, `taxonomy_version_reviewed`, `review_owner`,
  `max_staleness_days` — attribution + the named coverage-gap triage
  owner (A-3/A-6), validated by `parseKnowledgeLens`'s loader.

All date comparisons happen against an `evaluated_at`/`now` value the
CALLER passes in — determinism (NF-1) is preserved because the date is an
explicit input, never `Date.now()` inside `src/engine/*`.

---

## 10d. Round 16 — Plain-language schema additions, list-valued attributes,
loader checks (PE-9, CF-6, chunk A1)

Spec for `requirements/requirements.md` round 16 (UC-8..UC-12, PE-9, CF-6,
VD-9, VD-10). This chunk ships the schema, the engine helper and the loader
check only — the plain-language TEXT itself (chunk A2) and the rendering
that turns it into the verdict's first screen (chunk D1) are separate.

**PE-9 — list-valued node attributes.** `ProcessingNode.system_access_scope`
widens from `SystemAccessScope` to `SystemAccessScope | SystemAccessScope[]`
— a submitter can tick several kinds of infrastructure access at once (e.g.
an agent that both runs on shared infrastructure AND holds live
credentials), and every rule that used to match a single value still
matches when any one of several ticked values satisfies it.

```typescript
// src/engine/access-scope.ts
export function normaliseAccessScope(input: unknown):
  | { ok: true; value: SystemAccessScope | SystemAccessScope[] }
  | { ok: false; reason: string };
```

`normaliseAccessScope` is the single implementation of the validation rule
— non-empty, every element one of the four canonical values, no duplicates,
`none` never combined with another value, canonical order (`none`,
`shared_infrastructure`, `credentialed_systems`, `deployment_authority`)
applied whenever more than one value survives. It preserves the shape it is
given: a bare value in, a bare value out; a list in, a canonically-ordered
deduplicated list out. Every caller that accepts a tick-all answer for this
field — the extraction tool schema, the guided form, `GraphView`'s
correction control, the questionnaire's multi-select, `coerceAnswerValue`,
and `buildGraphFromForm` — calls this rather than re-deriving the rule.

`condition.ts#collectFieldValues` treats an array value on a node the same
way it already treats several nodes carrying the same field: each element
becomes its own candidate, so `{ in: [...] }` matches on any one of them.
**List-valued fields support the `in` operator only** — `gte`, `lte`,
`not_in` and bare equality are not well-defined over a set of ticked values.
`src/store/policy.ts` exports `LIST_VALUED_FIELDS` (today: just
`system_access_scope`) and rejects any other operator on one with a CF-5
error, for both the main policy (hard lines, tracks, tiers, invariants) and
every loaded pack (the same `validateConditionFieldValue` function both
call). `condition.ts#describeGraphPath` now names **every** input node,
joined with " + ", not just the first — `"A + B → model → output"` — so the
reviewer section's graph path never drops a ticked kind of information.

**CF-6 — optional plain-language fields.** All new fields below are
optional; an existing policy file with none of them loads completely
unchanged, and a reader who removes one falls back to the formal wording
(VD-9/VD-10 own that fallback; this schema only makes the fields exist and
validates their references).

```typescript
// Added to src/engine/types.ts
interface Control {
  // ...existing fields unchanged...
  plain_action?: string;       // what must be in place
  plain_owner?: string;        // free text, or the namespaced tokens
                                // @submitter / @model_owner
  plain_owner_with?: string;   // optional named partner
  covers_reviews?: string[];   // review BASE ids this control's action
                                // also satisfies — see DownstreamReviewSource
}

interface Invariant {
  // ...existing fields unchanged...
  plain_reason?: string;       // why it applies; may use {audience}/{destination}
}

interface HardLine {
  // ...existing fields unchanged...
  plain_reason?: string;       // why the answer is no
  plain_change?: string;       // what would change the answer
}

interface DownstreamReviewRule {
  // ...existing fields unchanged...
  plain_name?: string;         // the check, in plain words
  plain_owner?: string;        // the team that runs it
}

// The required_review variant of PackRuleEffect gains the same pair:
type PackRuleEffect =
  | ...
  | { type: 'required_review'; review: string; plain_name?: string; plain_owner?: string }
  | ...;

// Amended 2026-10-03 (R16-D2 §2, DR7-20). The hard_line variant gains the
// identical pair HardLine already has above — why the answer is no, and
// what would change it. Both optional; absent falls back to `reason` +
// the §4.4 pointer line (verdict-audit.md §5.9 renders the fallback).
type PackRuleEffectHardLine =
  { type: 'hard_line'; reason: string; plain_reason?: string; plain_change?: string };

// RegistryEntry backs BOTH platforms[] and vendors[]:
interface RegistryEntry {
  // ...existing fields unchanged...
  plain_name?: string;
  vendor_id?: string;          // platform only: the supplier behind the
                                // service; absent = built in-house
  kind?: 'company_assistant' | 'supplier'; // vendor only; default 'supplier'
}
```

Token rendering (`@submitter`, `@model_owner`) and placeholder resolution
(`{audience}`, `{destination}`) are chunk D1's view-model, not this schema —
this round only defines which tokens and placeholders are *legal*, so the
loader check below can tell a real one from a typo.

**The loader check — `checkPolicyReferences`.** A new pure, store-side
function (`src/store/policy-references.ts`), called at every site that
loads policy and packs together or evaluates:

```typescript
// src/store/policy-references.ts
export function checkPolicyReferences(
  policy: PolicyFile,
  packs: JurisdictionPack[],
): { errors: string[]; warnings: string[] };
```

This is deliberately **not** a re-run of what `loadPolicy`/`loadPacks`
already check at parse time — those are per-file checks that run before a
`PolicyFile` object exists. `checkPolicyReferences` is **referential**: it
only makes sense once the whole policy and the packs loaded beside it both
exist, because a `covers_reviews` entry has to resolve against the UNION of
the firm's own `downstream_reviews` ids and every loaded pack's
`required_review` rule ids (plus the two sentinels below) — knowledge no
single file's own validation can have.

Errors (CF-5-style, refuse evaluation): a `covers_reviews` id that is not a
firm review id, a pack `required_review` rule id, or one of the sentinels
`PV-UNREGISTERED` / `MODEL-REGISTRY`; or a condition using a non-`in`
operator on a list-valued field (a defense-in-depth re-check of the PE-9
rule above, reusing the same field set and predicate, so it is correct
standing alone and also covers `policy.downstream_reviews[]` conditions,
which `loadPolicy`'s own structural check does not walk).

**Amended 2026-10-02 (R16-A2).** When **no rule packs are loaded at all**, an unresolved `covers_reviews` id is reported as a **warning**, not an error: it may name a pack rule that simply isn't present, and "can't check" is the honest state. With packs loaded — every production load site — an id that matches nothing is a verified error. A `covers_reviews` id that matches nothing can only fail to fold a review into a safeguard, never hide one, so the softer zero-packs rule cannot hide an obligation.

**Amended 2026-10-02 (R16-W, W-7, D-77).** Errors also include: a
`verification_evidence.applies_to` id that is not a platform or vendor id
registered on the SAME policy — always checkable (unlike `covers_reviews`,
this never depends on whether packs are loaded, since platforms and
vendors are both part of the policy file itself). This is what stops a
firm from scoping evidence to a platform/vendor id that does not exist.

Warnings (shown to the reviewer, never blocking; CR7, 2026-10-04: where a placeholder is filled in, see the paragraph on placeholders below): an unknown placeholder —
anything in `{…}` other than `{audience}`/`{destination}`; an unknown `@`
token in a `plain_owner` field other than `@submitter`/`@model_owner`; a
platform or vendor registry entry with no `plain_name`.

**Amended 2026-10-03 (R16-D2 §2, DR7-20).** A pack `hard_line` effect's
`plain_reason`/`plain_change` are scanned for unknown placeholders too —
the EXACT same check a firm `HardLine`'s own pair already gets
(`hardLineWarnings`), since both use the identical `{audience}`/
`{destination}` vocabulary. Warning, not error, like every other
plain-language placeholder check on this page.

**Amended 2026-10-03 (CR6, A-5, C-5).** Errors also include a `platforms[].vendor_id` that is not a registered vendor id on the SAME policy: `vendor_id` names the supplier behind a platform, and an unregistered one is a referential error, always checkable like the `applies_to` check above, since platforms and vendors are both part of the policy file (TC-CR6-A5). Warnings also include two loaded packs that declare a rule with the same id, naming every pack that uses it (TC-CR6-C5b), and a firm `downstream_reviews` id equal to a loaded pack rule id, naming the pack (TC-CR6-C5d). These are the load-time signal for the condition `evaluation-engine.md` §15a now handles downstream (sources collapse only when identical in both `rule_id` and `review`).

**Amended 2026-10-04 (CR7-26, CR7-27).** Placeholders: `{audience}` and `{destination}` are filled only in `plain_reason` and `plain_change` (the view-model, `verdict-view-model.ts`, fills nothing else). In any other plain-language field a placeholder prints literally, so the checker warns that it will, and never calls even a known one "recognised" there (TC-CR7-26). In `plain_reason` and `plain_change` the message still names the recognised placeholders, and a known one does not warn (TC-CR7-26b). New error-level references, all checkable against the policy itself: a `controls[].resolves` entry naming an id that is neither an invariant nor a hard line; a platform or vendor `satisfies_controls` or `coupled_clusters` entry naming a control id the policy does not have; and, only when packs are loaded, a pack `required_control` rule whose `control_id` is not a policy control (the message ends "— add a control with this id to your policy, or remove the pack.") (TC-CR7-27a..27d). Because `checkPolicyReferences` is a hard gate, a saved policy with a dangling reference stops evaluating until it is fixed; the shipped policy and packs have none.

**The policy screen (CR7-06, CR7-38, 2026-10-04).** Save is single-flight: the button is disabled while a save is running, so two quick clicks queue each active case once (TC-CR7-06a). If the browser cannot store the policy, the screen says "The policy could not be saved to this browser." and queues nothing (TC-CR7-06e). If the policy is stored but the queuing then fails, it says the policy was saved, that queuing did not finish, and that saving again is safe because it queues only the cases not queued yet (TC-CR7-06b). (CR9, 2026-10-04) In that case the rules ARE stored, so the screen now also tells the app (`onSaved`), exactly as on a full success: the header and new pre-checks use the new rules at once instead of the old ones until a reload (CR9-03; TC-CR9-03; TC-CR7-06b amended). When the browser cannot store the policy, `onSaved` is still not called (TC-CR7-06e). The saved message reads "Policy saved — N active use cases queued for re-evaluation (M already waiting)", the bracket appearing only when M is more than zero (TC-CR7-06d). Each jurisdiction line reads "none signed off", "N of M signed off" or "all signed off", counted per rule with the engine's own `isUnsigned(rule, pack)`, so it never says "not yet signed off" about a pack that has some signed rules (TC-CR7-38a..38c; TC-V2-A D2 amended).

The check is referential only — a `covers_reviews` id that resolves to a
real review is not itself proof the control's action satisfies that
review; that is a rule-review judgement a human makes
(`grounding/PACK-AUTHORING.md`'s reviewer checklist gains a line for it).

---

## 11. Integration Points

| Integrated with | What this spec provides |
|---|---|
| `evaluation-engine.md` | `PolicyFile`, `JurisdictionPack`, condition evaluation logic, hard line definitions |
| `verdict-audit.md` | `version` + `pack_versions` fields for audit trail (VD-5, RA-3) |
| `intake-flow.md` | Permitted field values for structured form (UC-3a) drawn from policy enums |
| `register-lifecycle.md` | `tier_workflow` mapping drives LC-2 governance process routing |

---

## 12. Requirement Traceability

| Requirement | Coverage |
|---|---|
| PE-7 | §3.1 top-level schema + §6 validation |
| PE-8 | §10 starter config |
| CF-1 | §3.1 YAML with inline comments |
| CF-2 | §10 starter config |
| CF-3 | §7 versioning strategy |
| CF-4 | §4 + §7 pack independence |
| CF-5 | §6 validation rules + `PolicyValidationResult` type |
| RA-7 | §4 pack rule source citation requirement |
| RA-8 | §4 confidence field requirement |
| NF-6 | §3.1 human-readable YAML with comments |
| NF-7 | §4 reviewer sign-off fields |
| NF-10 | §3.1 translation_attestation block |
| OQ-PV-1 | §9 ADR-003 envelope semantics |
| PE-9 | §10d list-valued attributes |
| CF-6 | §10d optional plain-language fields |

## 13. Test Case References

| Test cases | Spec section |
|---|---|
| TC-CF-5-01, TC-CF-5-02, TC-CF-5-03 | §6 validation rules |
| TC-CF-3-01 | §7 versioning |
| TC-CF-4-01 | §7 pack independence |
| TC-PE-8-01, TC-PE-8-02 | §10 starter config |
| TC-RA-7-01, TC-RA-7-02 | §4 pack rule source citation |
| TC-RA-8-01 | §4 confidence field |
| TC-NF-7-01 | §4 reviewer sign-off |
| TC-NF-10-01 | §3.1 translation_attestation |
| TC-R16-A1-01..10, TC-R16-A1-28..41 | §10d list-valued attributes, CF-6 fields (`test-cases/test-cases-018.md`) |
| TC-R16-A1-50..71 | §10d loader check (`test-cases/test-cases-018.md`) |

---

## 14. Changelog

| Date | Change |
|---|---|
| 2026-10-04 | GT7 — §4 and §6 amended: a rejected pack's error message names the rule id as well as the pack and field path (`pack <pack-id> rule <rule-id> rejected: missing/invalid field "<path>" — …`), and the §6 table is marked as intended wording rather than literal text (TC-CF-5-02, TC-RA-7-01, `test-cases-032.md`). |
| 2026-10-04 | CR9 — code review 009 fixes (TC-CR9-*, `test-cases-031.md`). The policy screen paragraph (§10d): a save whose queuing fails part-way now refreshes the app's live policy, since the YAML is stored (CR9-03; TC-CR7-06b amended). |
| 2026-10-04 | CR7 — code review 007 fixes, wave 1 (TC-CR7-*, `test-cases-029.md`). §10d loader check amended: placeholders are filled only in `plain_reason` and `plain_change` and warn elsewhere; error-level references added for `controls[].resolves`, `satisfies_controls`, `coupled_clusters` and pack `required_control`. §10d gains the policy-screen rules (single-flight Save, the three save outcomes, the per-country sign-off line). |

---

*Developed using the Grounded Vibe Methodology*
