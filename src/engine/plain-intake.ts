import type {
  ActionType,
  DataClass,
  DataZone,
  DecisionBindingness,
  DecisionType,
  Exposure,
  ModelType,
  PolicyFile,
  RegistryEntry,
  SystemAccessScope,
} from './types';
import type { StructuredFormValues } from './build-graph-from-form';
import { DATA_CLASS_RANK } from './envelope';
import { ACCESS_SCOPE_CANONICAL_ORDER, normaliseAccessScope } from './access-scope';
import type { NormaliseAccessScopeResult } from './access-scope';
// R16-F §5 (DR7-06). Ids and keys only — no words. `findQuestion` and
// `makeAssumption` (which return/consume WORDED text) stay component-side;
// this module now returns assumption REFERENCES instead (see
// `AssumptionRef` below), so it no longer needs them.
import type { AssumptionRef, PlainAnswers, QuestionId } from './plain-questions';

// R16-B (build/prompts/R16.md v2.1 §2.1, §2.2). Pure (cross-cutting.md §7
// Rule 1): engine types and stdlib only. No React, no idb, no SDK, no
// Date.now()/Math.random() anywhere in this module's call graph —
// buildGraphFromForm stays the sole place ids and the timestamp are minted.
//
// This is the single documented mapping table from the submitter's plain
// answers to the engine's StructuredFormValues (UC-8 fit criterion 2): the
// same answers always produce the same values object, and every "Not sure"
// maps to the stricter reading, listed back as an assumption reference
// (principle 3; the wording is resolved component-side — see
// `describeAssumptions()`, src/components/plain-copy.ts).

const DATA_ZONE_ORDER: DataZone[] = ['Zone A', 'Zone B', 'Zone C'];

function earliestZone(zones: DataZone[] | undefined): DataZone {
  if (!zones || zones.length === 0) return 'Zone B';
  return [...zones].sort((a, b) => DATA_ZONE_ORDER.indexOf(a) - DATA_ZONE_ORDER.indexOf(b))[0]!;
}

// W-9 (R16-W §1, D-79 — the UC-6b parity fix). Q3's platform option mapped
// EVERY multi-zone platform to "the earliest letter among its allowed
// zones" unconditionally: for PLAT-INTERNAL-ML (allowed Zone B and Zone C)
// that is always Zone B, so a deal-memo tool that runs entirely on the
// in-house platform got HL-002's "No" where the worked case (UC-6b) expects
// it to pass. The §2.2 follow-up's three options are each fixed to one
// zone; only WHICH of the three is offered depends on the platform's own
// allowed set.
const PLATFORM_ZONE_OPTION_ZONE: Record<string, DataZone> = {
  'firm-systems': 'Zone C',
  'outside-supplier': 'Zone B',
  'outside-service': 'Zone A',
};

/** The §2.2 order (Zone C option, then Zone B, then Zone A) restricted to
 *  the zones this platform actually allows, plus "Not sure" — always
 *  offered, always last. Exported so StructuredForm.tsx renders exactly
 *  the option set this mapping reads back, rather than re-deriving the
 *  C/B/A ordering rule a second time (one implementation, same reason
 *  `earliestZone` is exported below). */
export function platformZoneOptionKeys(platform: RegistryEntry): string[] {
  const allowed = new Set(platform.approved_envelope.data_zones ?? []);
  const keys = (['firm-systems', 'outside-supplier', 'outside-service'] as const).filter((k) =>
    allowed.has(PLATFORM_ZONE_OPTION_ZONE[k]!),
  );
  return [...keys, 'not-sure'];
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// F-8 (DR7-08). The one place Q13's form-option ticks (none / credentialed /
// deployment / shared / not-sure) become engine `SystemAccessScope` values
// AND are validated, through `normaliseAccessScope` — the SAME checker
// the questionnaire's multi-select uses,
// so the four legal values, their canonical order and the `none`-exclusivity
// rule can never drift between call sites. Exported so `StructuredForm.tsx`'s
// required-field check calls this exact function rather than re-deriving
// "is Q13 answered" from the raw tick count — the DR7-08 bug was precisely
// that a mismatched tick list could satisfy a hand-rolled "ticks.length > 0"
// check while mapping to nothing real.
export function resolveAccessScopeAnswer(ticks: string[]): NormaliseAccessScopeResult {
  if (ticks.includes('not-sure')) {
    return normaliseAccessScope(ACCESS_SCOPE_CANONICAL_ORDER.filter((v) => v !== 'none'));
  }
  const mapped: string[] = [];
  if (ticks.includes('none')) mapped.push('none');
  if (ticks.includes('shared')) mapped.push('shared_infrastructure');
  if (ticks.includes('credentialed')) mapped.push('credentialed_systems');
  if (ticks.includes('deployment')) mapped.push('deployment_authority');
  return normaliseAccessScope(mapped);
}

function companyAssistantVendors(policy: PolicyFile): RegistryEntry[] {
  return (policy.vendors ?? []).filter((v) => v.kind === 'company_assistant');
}

function supplierVendors(policy: PolicyFile): RegistryEntry[] {
  return (policy.vendors ?? []).filter((v) => (v.kind ?? 'supplier') === 'supplier');
}

/** CR7-04. True when the form asks the optional "which model" question: Q3 is
 *  an outside assistant or a supplier option (the same rule as StructuredForm's
 *  showQ3Model, verified: src/components/StructuredForm.tsx:326). */
export function q3ShowsModelQuestion(answers: PlainAnswers): boolean {
  const q3 = answers['3'];
  return q3 === 'outside-assistant' || q3 === 'supplier-feature' || q3 === 'specialist-product';
}

export function plainAnswersToFormValues(
  answers: PlainAnswers,
  policy: PolicyFile,
): { values: StructuredFormValues; assumptions: AssumptionRef[] } {
  const assumptions: AssumptionRef[] = [];
  // R16-D2 §1 (D-95): `fields` names the GRAPH fields THIS branch sets —
  // passed by every call site below, never re-derived here. See
  // AssumptionRef's own comment (plain-questions.ts) for why.
  function assume(id: QuestionId, optionKey: string, fields: string[]): void {
    assumptions.push({ questionId: id, optionKey, fields });
  }

  const str = (id: QuestionId): string | undefined => {
    const v = answers[id];
    return typeof v === 'string' ? v : undefined;
  };

  // ---- Q3: where the AI comes from -> destination zone + vendor + platform ----
  let destinationZone: DataZone = 'Zone B';
  let vendor: string | undefined;
  let platform: string | undefined;

  const q3 = str('3');
  switch (q3) {
    case 'outside-assistant': {
      const q3a = str('3a');
      switch (q3a) {
        case 'firm-account': {
          const assistants = companyAssistantVendors(policy);
          destinationZone = 'Zone B';
          if (assistants.length === 1) {
            vendor = assistants[0]!.id;
          } else if (assistants.length > 1) {
            const which = str('3aWhich');
            const match = which === 'not-sure' ? undefined : assistants.find((v) => v.id === which);
            if (match) {
              vendor = match.id;
            } else {
              // CR6-06: "not-sure" AND a stale/unrecognised id (a company
              // assistant removed from the registry since this was answered)
              // take the exact same path — the strict reading, always
              // listed as an assumption. Before this fix the stale-id case
              // silently reused the "not confirmed" wording with NO
              // assumption recorded, so a reviewer had no way to know the
              // answer had been reinterpreted at all.
              vendor = 'your firm’s AI assistant (not confirmed which one)';
              assume('3aWhich', 'not-sure', ['vendor']);
            }
          } else {
            // D-64 literal fallback: none registered at all.
            vendor = 'company AI assistant (not on your firm’s list)';
          }
          break;
        }
        case 'personal-account':
          destinationZone = 'Zone A';
          // D-72: was 'unregistered (personal account, no firm contract)'
          // — "unregistered" is engine vocabulary that reached the
          // summary, the reviewer section and the audit trail verbatim.
          vendor = 'a personal account (no contract with your firm)';
          break;
        case 'not-sure':
        default:
          destinationZone = 'Zone A';
          // D-72: was 'unregistered (not sure which account)'.
          vendor = 'an AI assistant account you weren’t sure about';
          assume('3a', 'not-sure', ['data_zone', 'vendor']);
          break;
      }
      break;
    }
    case 'supplier-feature':
    case 'specialist-product': {
      destinationZone = 'Zone B';
      const q3supplier = str('3supplier');
      switch (q3supplier) {
        case 'not-on-list': {
          const typed = str('3supplierName')?.trim();
          vendor = typed
            ? `${typed} (not on your firm’s list)`
            : 'An unlisted supplier (not on your firm’s list)';
          break;
        }
        case 'dont-know':
          // D-72: was 'unregistered (supplier not confirmed)'.
          vendor = 'a supplier you weren’t sure of';
          assume('3supplier', 'dont-know', ['vendor']);
          break;
        default: {
          // A supplier vendor id, picked from the dynamic list.
          const match = supplierVendors(policy).find((v) => v.id === q3supplier);
          if (match) {
            vendor = match.id;
          } else {
            // CR6-06: a stale/unrecognised supplier id (removed from the
            // registry since this was answered) takes the SAME path as
            // "I don't know" — same wording, same assumption. Before this
            // fix it silently reused "I don't know"'s fallback text with no
            // assumption recorded.
            vendor = 'a supplier you weren’t sure of';
            assume('3supplier', 'dont-know', ['vendor']);
          }
        }
      }
      break;
    }
    case 'firm-built':
      destinationZone = 'Zone C';
      vendor = 'internal';
      break;
    case 'not-sure':
    case undefined:
      destinationZone = 'Zone A';
      // D-72: was 'unregistered (where this AI comes from was not sure)'.
      vendor = 'an AI service you weren’t sure about';
      if (q3 === 'not-sure') assume('3', 'not-sure', ['data_zone', 'vendor']);
      break;
    default: {
      // A platform id, picked from the dynamic list (d).
      const matchedPlatform = (policy.platforms ?? []).find((p) => p.id === q3);
      if (matchedPlatform) {
        const allowedZones = matchedPlatform.approved_envelope.data_zones;
        const earliest = earliestZone(allowedZones);
        // W-9 (D-79): a platform allowed in only one zone keeps today's
        // mapping with no follow-up — there is only one honest answer to
        // "which zone does it actually run in" already.
        if ((allowedZones?.length ?? 0) > 1) {
          switch (str('3platformZone')) {
            case 'firm-systems':
              destinationZone = 'Zone C';
              break;
            case 'outside-supplier':
              destinationZone = 'Zone B';
              break;
            case 'outside-service':
              destinationZone = 'Zone A';
              break;
            case 'not-sure':
            default:
              destinationZone = earliest;
              // R16-F §5 (DR7-06): a REFERENCE, not the worded sentence —
              // the wording still depends on which zone is earliest for
              // THIS platform's allowed set, a runtime computation over
              // the platform's envelope, never a fixed per-option string
              // plain-copy.ts's code-free module (§2.4) could hold on its
              // own. `describeAssumptions()` (plain-copy.ts) resolves this
              // exact case to the same two sentences as before.
              assumptions.push({
                questionId: '3platformZone',
                optionKey: 'not-sure',
                earliestZone: earliest,
                fields: ['data_zone'],
              });
          }
        } else {
          destinationZone = earliest;
        }
        vendor = matchedPlatform.vendor_id ?? 'internal';
        platform = matchedPlatform.id;
      } else {
        // CR6-06: q3 is neither a static option key nor a CURRENT platform
        // id — a stale/removed platform id, or any other unrecognised
        // value — and takes the exact same path as the top-level "Not
        // sure" case below, including its assumption. Before this fix it
        // silently reused that case's values with no assumption recorded.
        destinationZone = 'Zone A';
        vendor = 'an AI service you weren’t sure about';
        assume('3', 'not-sure', ['data_zone', 'vendor']);
      }
    }
  }

  // ---- Q3model: optional named model ----
  let declaredModelId: string | undefined;
  let declaredModelIdOther: string | undefined;
  // CR7-04: the form asks this only when q3ShowsModelQuestion — an answer left
  // over from an earlier Q3 choice must not name a model.
  const modelText = q3ShowsModelQuestion(answers) ? str('3model')?.trim() : undefined;
  if (modelText) {
    const match = (policy.approved_models ?? []).find((m) => m.model_id === modelText);
    if (match) declaredModelId = match.model_id;
    else declaredModelIdOther = modelText;
  }

  // ---- Q4 / Q4a: kind of AI -> modelType ----
  let modelType: ModelType;
  const q4 = str('4');
  switch (q4) {
    case 'score': {
      const q4a = str('4a');
      if (q4a === 'rules') modelType = 'statistical';
      else if (q4a === 'explainable') modelType = 'traditional-ml';
      else modelType = 'ml'; // 'unexplainable' or unanswered
      break;
    }
    case 'perception':
      modelType = 'deep-learning';
      break;
    case 'language':
      modelType = 'llm';
      break;
    case 'generative':
      modelType = 'generative-ai';
      break;
    case 'agentic':
      modelType = 'agentic';
      break;
    case 'not-sure':
    default:
      // CR6-06: "not-sure" and any unrecognised/stale value (an old option
      // key a draft or an older build still has on file) take the same
      // path — the strict reading, always listed as an assumption. Before
      // this fix an unrecognised value silently fell through to 'llm' with
      // no assumption recorded.
      modelType = 'agentic';
      assume('4', 'not-sure', ['model_type']);
  }

  // ---- Q5: information it uses (tick-all) -> inputDataClasses ----
  const classSet = new Set<DataClass>();
  let q5Assumed = false;
  for (const key of toArray(answers['5'])) {
    switch (key) {
      case 'people':
        classSet.add('Client PII');
        break;
      case 'price-sensitive':
        classSet.add('MNPI');
        break;
      case 'confidential':
        classSet.add('Confidential');
        break;
      case 'everyday':
      case 'typed-only':
        classSet.add('Internal');
        break;
      case 'public':
        classSet.add('Public');
        break;
      case 'not-sure':
      default:
        // CR6-06e: "not-sure" and any unrecognised/stale tick (alone or
        // mixed with real ones) take the same path — strictest reading,
        // listed back once. Before this fix a stale key was ignored and
        // the class silently fell back to 'Internal' with no assumption.
        classSet.add('Confidential');
        if (!q5Assumed) {
          q5Assumed = true;
          assume('5', 'not-sure', ['data_class']);
        }
        break;
    }
  }
  if (classSet.size === 0) classSet.add('Internal');
  // Most sensitive first — the same ranking the summary and the verdict
  // view-model use (§1.5, D-03), so the order a reviewer sees here is never
  // a second, silently-disagreeing ranking.
  const inputDataClasses = [...classSet].sort(
    (a, b) => DATA_CLASS_RANK[b] - DATA_CLASS_RANK[a],
  );

  // ---- Q6 / Q6a / Q6b: what happens with the output ----
  let outputActionType: ActionType;
  let autonomyLevel: 0 | 1 | 2 | 3 | 4;
  let hitl: boolean | undefined;
  let decisionBindingness: DecisionBindingness;

  function resolve6a(): DecisionBindingness {
    const q6a = str('6a');
    switch (q6a) {
      case 'little':
        return 'non-binding';
      case 'one-input':
        return 'advisory';
      case 'usually-basis':
      case undefined:
        return 'material';
      case 'not-sure':
      default:
        // CR6-06f: "not-sure" and any unrecognised/stale value take the
        // same path — listed back as an assumption.
        assume('6a', 'not-sure', ['decision_bindingness']);
        return 'material';
    }
  }
  function resolve6b(): ActionType {
    const q6b = str('6b');
    switch (q6b) {
      case 'trades':
        return 'trade';
      case 'yes-no-decision':
        return 'approve';
      case 'something-else':
      default:
        return 'execute';
    }
  }

  const q6 = str('6');
  switch (q6) {
    case 'read':
      outputActionType = 'read';
      autonomyLevel = 0;
      decisionBindingness = 'non-binding';
      break;
    case 'answers':
      outputActionType = 'inform';
      autonomyLevel = 0;
      decisionBindingness = resolve6a();
      break;
    case 'drafts':
      outputActionType = 'draft';
      autonomyLevel = 1;
      hitl = true;
      decisionBindingness = resolve6a();
      break;
    case 'suggests':
      outputActionType = 'recommend';
      autonomyLevel = 1;
      hitl = true;
      decisionBindingness = resolve6a();
      break;
    case 'prepares':
      outputActionType = 'execute';
      autonomyLevel = 1;
      hitl = true;
      decisionBindingness = 'material';
      break;
    case 'acts-reviewed':
      autonomyLevel = 2;
      hitl = false;
      decisionBindingness = 'binding';
      outputActionType = resolve6b();
      break;
    case 'acts-bounded':
      autonomyLevel = 3;
      hitl = false;
      decisionBindingness = 'binding';
      outputActionType = resolve6b();
      break;
    case 'acts-alone':
      autonomyLevel = 4;
      hitl = false;
      decisionBindingness = 'binding';
      outputActionType = resolve6b();
      break;
    case 'not-sure':
    default:
      // CR6-06: "not-sure" and any unrecognised/stale value take the same
      // path — the strict reading, always listed as an assumption. Before
      // this fix an unrecognised value silently fell through to the LEAST
      // strict reading (read/level 0/non-binding) with no assumption
      // recorded.
      outputActionType = 'execute';
      autonomyLevel = 4;
      hitl = false;
      decisionBindingness = 'binding';
      assume('6', 'not-sure', ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl']);
  }

  // ---- Q7: who sees it -> exposure ----
  let outputExposure: Exposure;
  switch (str('7')) {
    case 'me-or-team':
      outputExposure = 'internal-only';
      break;
    case 'other-teams':
      outputExposure = 'internal-shared';
      break;
    case 'clients':
      outputExposure = 'client-facing';
      break;
    case 'public-market':
      // A real, current, definite answer — maps to the same value as
      // "not-sure" below, but is a stated fact, not a guess, so no
      // assumption is recorded.
      outputExposure = 'market-facing';
      break;
    case 'not-sure':
    default:
      // CR6-06: "not-sure" and any unrecognised/stale value take the same
      // path — the strict reading, always listed as an assumption. Before
      // this fix an unrecognised value silently fell through to the LEAST
      // strict reading (internal-only) with no assumption recorded.
      outputExposure = 'market-facing';
      assume('7', 'not-sure', ['exposure']);
  }

  // ---- Q8 / Q8other: decision type ----
  let decisionType: DecisionType | undefined;
  let decisionTypeOther: string | undefined;
  switch (str('8')) {
    case 'credit':
      decisionType = 'credit-decision';
      break;
    case 'hiring':
      decisionType = 'hiring';
      break;
    case 'pricing':
      decisionType = 'pricing';
      break;
    case 'trading':
      decisionType = 'trading';
      break;
    case 'fraud':
      decisionType = 'fraud-detection';
      break;
    case 'regulatory':
      decisionType = 'regulatory-reporting';
      break;
    case 'operational':
      decisionType = 'operational';
      break;
    case 'other':
      decisionTypeOther = str('8other')?.trim() || 'unspecified';
      break;
  }

  // ---- Q9: can it be undone -> reversibility ----
  let outputReversibility: 'reversible' | 'irreversible' | 'unknown';
  switch (str('9')) {
    case 'yes':
      outputReversibility = 'reversible';
      break;
    case 'no':
      outputReversibility = 'irreversible';
      break;
    case undefined:
      outputReversibility = 'unknown';
      break;
    case 'not-sure':
    default:
      // CR6-06f: "not-sure" and any unrecognised/stale value take the same
      // path — the strict reading, listed back as an assumption.
      outputReversibility = 'irreversible';
      assume('9', 'not-sure', ['output_reversibility']);
  }

  // ---- Q10: how widely used -> scale ----
  const outputScale: 'limited' | 'at_scale' = str('10') === 'small' ? 'limited' : 'at_scale';

  // ---- Q11: jurisdictions (tick-all) ----
  const q11 = toArray(answers['11']);
  const knownCodes = new Set((policy.jurisdictions ?? []).map((j) => j.code));
  // CR7-23 (owner decisions): a listed country stays when "Somewhere else, or
  // not sure" is also ticked, and the unknown country is listed back as an
  // assumption. "Somewhere else" alone still gives [] and no assumption.
  const jurisdictions = q11.filter((code) => knownCodes.has(code));
  if (q11.includes('elsewhere-not-sure') && jurisdictions.length > 0) {
    assume('11', 'elsewhere-not-sure', ['jurisdictions']);
  }

  // ---- Q12: replaces something ----
  let replacesPriorModel: boolean;
  switch (str('12')) {
    case 'yes':
      replacesPriorModel = true;
      break;
    case 'no':
      replacesPriorModel = false;
      break;
    case 'not-sure':
    default:
      // CR6-06: "not-sure" and any unrecognised/stale value take the same
      // path — the strict reading, always listed as an assumption. Before
      // this fix an unrecognised value silently fell through to the LESS
      // strict reading (false — does not trigger TRACK-II-REPLACE) with no
      // assumption recorded.
      replacesPriorModel = true;
      assume('12', 'not-sure', ['replaces_prior_model']);
  }

  // ---- Q13: agent access (tick-all) ----
  // F-8 (DR7-08): routed through the single checker (`normaliseAccessScope`,
  // via `resolveAccessScopeAnswer` below) instead of pushing engine values
  // by hand. A refusal (ticks that map to nothing the engine recognises —
  // e.g. a stale key left over from an older app version) leaves
  // `systemAccessScope` unset here, same as "not answered"; it must never
  // read to the SUBMITTER as the honest "not stated" case. That is enforced
  // one layer up, at the form: `StructuredForm.tsx`'s own required-field
  // check calls this SAME function and shows the refusal reason instead of
  // letting the question read as satisfied, so a submitter can never reach
  // Continue with ticks this mapping would silently drop.
  let systemAccessScope: SystemAccessScope[] | undefined;
  if (answers['13'] !== undefined) {
    const ticks = toArray(answers['13']);
    const resolved = resolveAccessScopeAnswer(ticks);
    if (resolved.ok) {
      systemAccessScope = (Array.isArray(resolved.value) ? resolved.value : [resolved.value]) as SystemAccessScope[];
      if (ticks.includes('not-sure')) assume('13', 'not-sure', ['system_access_scope']);
    }
  }

  // ---- Q14: instance coordination ----
  let multiInstanceCoordination: 'yes' | 'no' | 'unknown' | undefined;
  switch (str('14')) {
    case 'no':
      multiInstanceCoordination = 'no';
      break;
    case 'yes':
      multiInstanceCoordination = 'yes';
      break;
    case undefined:
    case '':
      multiInstanceCoordination = undefined;
      break;
    case 'not-sure':
    default:
      // CR6-06f: unanswered stays unset; "not-sure" and any unrecognised
      // stored value take the same path, listed back as an assumption.
      multiInstanceCoordination = 'unknown';
      assume('14', 'not-sure', ['multi_instance_coordination']);
  }

  const values: StructuredFormValues = {
    useCaseName: str('1') ?? '',
    description: str('2') ?? '',
    inputDataClass: inputDataClasses[0]!,
    inputDataZone: destinationZone,
    inputDataClasses,
    modelType,
    autonomyLevel,
    processingDataZone: destinationZone,
    outputActionType,
    outputExposure,
    decisionBindingness,
    outputReversibility,
    outputScale,
    replacesPriorModel,
    ...(platform ? { platform } : {}),
    ...(vendor !== undefined ? { vendor } : {}),
    ...(declaredModelId ? { declaredModelId } : {}),
    ...(declaredModelIdOther ? { declaredModelIdOther } : {}),
    ...(decisionType !== undefined ? { decisionType } : {}),
    ...(decisionTypeOther !== undefined ? { decisionTypeOther } : {}),
    ...(hitl !== undefined ? { hitl } : {}),
    ...(systemAccessScope !== undefined ? { systemAccessScope } : {}),
    ...(multiInstanceCoordination !== undefined ? { multiInstanceCoordination } : {}),
    jurisdictions,
  };

  return { values, assumptions };
}

// Exported for StructuredForm.tsx and the parity test, which both need the
// same "earliest letter" rule for the platform option's zone without
// re-deriving it — one implementation (D-16).
export { earliestZone };
