import { graphSummaryRows, dataClassesBySeverity } from './graph-summary';
import {
  GRAPH_REVIEW_CARD_TITLES,
  SUMMARY_LABELS,
  SUMMARY_DATA_CLASS,
  SUMMARY_MODEL_TYPE,
  SUMMARY_BINDINGNESS,
  SUMMARY_EXPOSURE,
  SUMMARY_REVERSIBILITY,
  SUMMARY_SCALE,
  SUMMARY_NO_COUNTRIES,
  SUMMARY_ACCESS_SCOPE,
  SUMMARY_MULTI_INSTANCE,
  summaryBehaviourLine,
  summaryShowsWeight,
  summaryDecisionLine,
  summaryDestinationLine,
  plausibilityMessageForForm,
  plausibilityMessageForDescription,
  questionnaireCopyForField,
  supplierDisplayName,
  countryNameList,
} from './plain-copy';
import type { Assumption, PlainAnswers } from './plain-copy';
import { Fold } from './Fold';
import { plausibilityWarnings } from '../engine/plausibility';
import type { PlausibilityWarning } from '../engine/plausibility';
import type { DataFlowGraph, PolicyFile, SystemAccessScope } from '../engine/types';

// R16-C (UC-9, UC-12; build/prompts/R16.md v2.1 §3), rewritten for R16-W §2
// (D-71). Rule 4 (cross-cutting.md §7): presentation-only — every value is
// read off the graph via graph-summary.ts's pure helpers, plain-copy.ts's
// SUMMARY_* lookups, or passed in as a prop; nothing here decides a verdict
// or writes anything.
//
// Principle 1 (§0) applies here exactly as it does to the questions: no
// data class, zone letter, model-type name, autonomy level or bindingness
// code reaches this screen. D-71 found this screen reading the graph
// through the REVIEWER cards' own labels (field-copy.ts) instead — a
// different vocabulary, written for a 2LoD reader ("Personal details of
// clients" for "Information about people…", "via unregistered…" for the
// supplier, no line at all for the kind of AI or whether a mistake can be
// put right). Every value below now reads from plain-copy.ts's SUMMARY_*
// maps — the newcomer-tested QUESTION wording (§2.2) — never field-copy.ts.
// The collapsed "Show the details the rules use" grid below keeps
// field-copy.ts's labels unchanged: that is the reviewer's own vocabulary,
// on purpose (§3: "reviewer vocabulary stays there").

/** §2 "Through: {name}." / the unregistered-vendor second line (D-71). A
 *  registry match (platform or vendor) renders its plain_name, or the
 *  neutral fallback if it has none — never the raw `name`, which may carry
 *  the bare [FIRM] placeholder. An unmatched vendor string is already the
 *  plain, human-written text plain-intake.ts constructed for every
 *  unregistered case (D-72) — safe to show as-is, and flagged unassessed. */
function throughSupplierLine(
  vendor: string | undefined,
  policy: PolicyFile | undefined,
): { through?: string; unregistered: boolean } {
  if (!vendor || vendor === 'internal') return { unregistered: false };
  const { name, registered } = supplierDisplayName(vendor, policy);
  return { through: `Through: ${name}.`, unregistered: !registered };
}

/** §2 "Runs on: {platform plain_name}." (D-71). Falls back to a neutral
 *  phrase, never the bare registry id, if the recorded platform id no
 *  longer resolves against today's policy (principle 1, D-20). */
function runsOnLine(platformId: string | undefined, policy: PolicyFile | undefined): string | undefined {
  if (!platformId) return undefined;
  const match = policy?.platforms?.find((p) => p.id === platformId);
  return `Runs on: ${match?.plain_name ?? 'your firm’s platform'}.`;
}

// R16-E §4 (v2.1, F1B-1). The double-check wording names the card a
// warning's node belongs to; this resolves WHICH card, since this screen has
// no per-column loop to read it off directly. The titles come from the ONE
// shared table (GRAPH_REVIEW_CARD_TITLES), so they cannot drift apart.
function cardTitleForNode(graph: DataFlowGraph, nodeId: string): string {
  if (graph.input_nodes.some((n) => n.id === nodeId)) return GRAPH_REVIEW_CARD_TITLES.input;
  if (graph.processing_nodes.some((n) => n.id === nodeId)) return GRAPH_REVIEW_CARD_TITLES.processing;
  return GRAPH_REVIEW_CARD_TITLES.output;
}

/** F-9 (DR7-09), reworded for R16-E §4 (v2.1): each path speaks its own
 *  wording for the same plausibility reference — the form path still
 *  names its own question; the description path names this screen's own
 *  card/row vocabulary, never a form question it never showed. */
function plausibilityMessage(w: PlausibilityWarning, graph: DataFlowGraph): string {
  if (graph.intake_method === 'structured_form') return plausibilityMessageForForm(w.signal);
  return plausibilityMessageForDescription(
    w.signal,
    cardTitleForNode(graph, w.node_id),
    questionnaireCopyForField(w.field).shortLabel,
  );
}

interface UnderstoodSummaryProps {
  graph: DataFlowGraph;
  policy?: PolicyFile;
  /** Form path (UC-9): every "Not sure" answer, listed back. */
  assumptions?: Assumption[];
  /** Description path (UC-12): node ids the extractor could not verify. */
  uncertainNodeIds?: string[];
  /** F-9 (DR7-09): the description being confirmed — read here, purely at
   *  render, for the plausibility cross-check against the graph. Present
   *  on both real paths (the form's own question 2 final text, or the
   *  typed description); optional only so existing callers/tests that
   *  predate this prop keep compiling — an absent description simply
   *  never matches a plausibility signal. */
  description?: string;
  /** F-9 (DR7-09): the form's own answers, undefined on the description
   *  path — used only to attribute the destination zone to an explicit
   *  3platformZone answer ("you told us…"). */
  plainAnswers?: PlainAnswers;
  /** Navigates only — back to the question (form path) or into the
   *  existing correction flow (description path, UC-7). No write of its
   *  own; the one write stays the Confirm button and its in-flight guard. */
  onChangeAnswer: () => void;
  /** R16-F review pass 4: true while a confirm is under way. */
  changeAnswerDisabled?: boolean;
}

export default function UnderstoodSummary({
  graph,
  policy,
  assumptions = [],
  uncertainNodeIds = [],
  description = '',
  plainAnswers,
  onChangeAnswer,
  changeAnswerDisabled = false,
}: UnderstoodSummaryProps) {
  const processing = graph.processing_nodes[0];
  const output = graph.output_nodes[0];
  const dataClasses = dataClassesBySeverity(graph);
  const through = throughSupplierLine(processing?.vendor, policy);
  const runsOn = runsOnLine(processing?.platform, policy);
  // CR6-23: never a bare code — the policy's own name, or a neutral phrase.
  const countryNames = countryNameList(graph.jurisdictions, policy);
  // F-9 (DR7-09). Pure, computed at render from the description and the
  // graph already in hand — no new state. Runs for BOTH paths: this
  // component is where this check is shown. The check flags each affected
  // part of the case separately (one per card), so the same sentence can
  // come back several times — the summary shows each once.
  const doubleCheckWarnings = [
    ...new Set(plausibilityWarnings(description, graph).map((w) => plausibilityMessage(w, graph))),
  ];

  const uncertainLabels = uncertainNodeIds
    .map(
      (id) =>
        [...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes].find((n) => n.id === id)?.label,
    )
    .filter((label): label is string => Boolean(label));

  return (
    <section aria-label="Here's what we understood" className="understood-summary">
      <h2>Here&rsquo;s what we understood</h2>

      {doubleCheckWarnings.length > 0 && (
        <section className="understood-summary__section understood-summary__double-check" role="note">
          <h3>Please double-check</h3>
          <ul>
            {doubleCheckWarnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </section>
      )}

      {processing && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.destination}</h3>
          <p>{summaryDestinationLine(processing.data_zone, plainAnswers)}</p>
          {through.through && <p>{through.through}</p>}
          {through.unregistered && <p>Your firm hasn’t assessed this supplier yet.</p>}
          {runsOn && <p>{runsOn}</p>}
        </section>
      )}

      {dataClasses.length > 0 && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.dataClasses}</h3>
          <ul>
            {dataClasses.map((c) => (
              <li key={c}>{SUMMARY_DATA_CLASS[c]}</li>
            ))}
          </ul>
        </section>
      )}

      {output && processing && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.behaviour}</h3>
          <ul>
            <li>{SUMMARY_MODEL_TYPE[processing.model_type]}</li>
            <li>{summaryBehaviourLine(processing.autonomy_level, output.action_type, output.hitl)}</li>
            {summaryShowsWeight(output.action_type, processing.autonomy_level) && (
              <li>{SUMMARY_BINDINGNESS[output.decision_bindingness]}</li>
            )}
            <li>{SUMMARY_EXPOSURE[output.exposure]}</li>
          </ul>
        </section>
      )}

      {output && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.reversibility}</h3>
          <p>{SUMMARY_REVERSIBILITY[output.output_reversibility]}</p>
        </section>
      )}

      {output && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.decisions}</h3>
          <p>{summaryDecisionLine(output.decision_type, output.decision_type_other)}</p>
        </section>
      )}

      {output && processing && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.scaleAndCountries}</h3>
          <ul>
            <li>{SUMMARY_SCALE[output.scale]}</li>
            <li>{countryNames.length > 0 ? countryNames.join(', ') : SUMMARY_NO_COUNTRIES}</li>
            <li>
              {processing.replaces_prior_model
                ? 'It replaces something you already use.'
                : 'It doesn’t replace anything you already use.'}
            </li>
          </ul>
        </section>
      )}

      {processing?.system_access_scope !== undefined && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.agentReach}</h3>
          <ul>
            {(Array.isArray(processing.system_access_scope)
              ? processing.system_access_scope
              : [processing.system_access_scope]
            ).map((v: SystemAccessScope) => (
              <li key={v}>{SUMMARY_ACCESS_SCOPE[v]}</li>
            ))}
          </ul>
        </section>
      )}

      {processing?.multi_instance_coordination !== undefined && (
        <section className="understood-summary__section">
          <h3>{SUMMARY_LABELS.agentCoordination}</h3>
          <p>{SUMMARY_MULTI_INSTANCE[processing.multi_instance_coordination]}</p>
        </section>
      )}

      {/* §7 (D-106, DR7-24/BB-1): chosen by `graph.intake_method`, never by
          which list happens to be empty — the form path keeps its own,
          unchanged section; the description path merges BOTH the
          extractor's own uncertain nodes and the questionnaire's "Not
          sure" assumptions (R16-E's own addition) into one list, since
          both are genuinely "things we couldn't tell from your
          description". */}
      {graph.intake_method === 'structured_form' ? (
        assumptions.length > 0 && (
          <section className="understood-summary__section understood-summary__assumptions">
            <h3>{SUMMARY_LABELS.assumptionsFormPath}</h3>
            <ul>
              {assumptions.map((a) => (
                <li key={a.questionId}>
                  <strong>{a.question}</strong> &mdash; we assumed {a.assumption.replace(/\.+$/, '')}.
                </li>
              ))}
            </ul>
          </section>
        )
      ) : (
        (uncertainLabels.length > 0 || assumptions.length > 0) && (
          <section className="understood-summary__section understood-summary__assumptions">
            <h3>{SUMMARY_LABELS.assumptionsDescriptionPath}</h3>
            <ul>
              {uncertainLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
              {assumptions.map((a) => (
                <li key={a.questionId}>
                  <strong>{a.question}</strong> &mdash; we assumed {a.assumption.replace(/\.+$/, '')}.
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <button type="button" className="understood-summary__change" onClick={onChangeAnswer} disabled={changeAnswerDisabled}>
        {SUMMARY_LABELS.changeAnswer}
      </button>

      <Fold title={SUMMARY_LABELS.detailsDisclosure} summary="The field-by-field record the rules evaluate">
        <div className="confirmation__grid">
          {graphSummaryRows(graph).map((row, i) => (
            <div key={`${row.label}-${i}`} className="confirmation__grid-cell">
              <span className="confirmation__grid-label">{row.label}</span>
              <span className="confirmation__grid-value">{row.value}</span>
            </div>
          ))}
        </div>
      </Fold>
    </section>
  );
}
