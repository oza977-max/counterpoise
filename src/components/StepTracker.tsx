import type { IntakeState } from './intake-state';

// Visual step tracker (Claude Design export "Counterpoise Demo.dc.html").
// Maps our real states onto the design's step labels. All 6 steps are
// real content — Describe, Duplicates, Your answers (the form), Questions,
// Resolve (contradiction_review — only shown when active, not a normal
// step in the happy path), Confirm, Verdict.
// design-review round 4 (Panel G — Intake: Confirmation + journey spine,
// Minor): labels named the tool's internal process stages ("Graph"), not
// the user's goal of "get a fast, fair answer." Renamed where the old
// label was jargon; left alone where it already read as a goal (Describe,
// Confirm, Verdict).
// R16-W §4 (D-74): "Check overlap" / "Review details" / "Verdict" ->
// "Similar checks" / "Your answers" / "Result" — the three labels the
// plain-language redesign had not yet reached.
const STEPS: Array<{ key: string; label: string; matches: (s: IntakeState['step']) => boolean }> = [
  { key: 'describe', label: 'Describe', matches: (s) => s === 'description_entry' },
  { key: 'duplicates', label: 'Similar checks', matches: (s) => s === 'duplicate_check' },
  { key: 'graph', label: 'Your answers', matches: (s) => s === 'prefill_reading' || s === 'graph_extraction' },
  {
    key: 'questions',
    label: 'Questions',
    matches: (s) => s === 'questionnaire' || s === 'contradiction_review',
  },
  { key: 'confirm', label: 'Confirm', matches: (s) => s === 'confirmation' },
  { key: 'verdict', label: 'Result', matches: (s) => s === 'evaluation_pending' || s === 'verdict' },
];

// §3 (DR7-10). The one source of the step numbering the live-region
// announcement in IntakeFlow.tsx reads — so the announcement
// ("Step 3 of 6: Your answers") can never disagree with what the visual
// tracker above it shows, the same anti-duplication reasoning as every
// other "one computation, several readers" rule in this codebase.
export function describeStep(current: IntakeState['step']): string {
  const activeStepIndex = STEPS.findIndex((s) => s.matches(current));
  if (activeStepIndex === -1) return '';
  return `Step ${activeStepIndex + 1} of ${STEPS.length}: ${STEPS[activeStepIndex]!.label}`;
}

const ORDER = [
  'description_entry',
  'duplicate_check',
  'prefill_reading',
  'graph_extraction',
  'questionnaire',
  'contradiction_review',
  'confirmation',
  'evaluation_pending',
  'verdict',
];

// FN-006. The ✓ on a completed step read as clickable progress navigation and
// was inert — a plain <li> with no handler. That false affordance was the
// sharper half of the report: the one control a user reaches for to go back
// looked interactive and was not.
//
// Only the step immediately behind the current one becomes a button, because
// STEP_BACK moves exactly one step. Making every completed step clickable
// would promise multi-step jumps the reducer cannot honour — trading one lie
// for a larger one.
export default function StepTracker({
  current,
  onBack,
  backDisabled = false,
}: {
  current: IntakeState['step'];
  onBack?: () => void;
  /** True while a write that cannot be recalled is in flight. */
  backDisabled?: boolean;
}) {
  const currentIndex = ORDER.indexOf(current);
  const activeStepIndex = STEPS.findIndex((s) => s.matches(current));

  return (
    <ol className="step-tracker">
      {STEPS.map((step, i) => {
        const stepMaxIndex = Math.max(...ORDER.map((s, idx) => (step.matches(s as IntakeState['step']) ? idx : -1)));
        const isDone = currentIndex > stepMaxIndex;
        const isActive = step.matches(current);
        const isBackTarget = Boolean(onBack) && isDone && i === activeStepIndex - 1;

        const className = `step-tracker__step${isDone ? ' step-tracker__step--done' : ''}${
          isActive ? ' step-tracker__step--active' : ''
        }${isBackTarget ? ' step-tracker__step--backable' : ''}`;

        return (
          <li key={step.key} className={className}>
            {isBackTarget ? (
              <button type="button" className="step-tracker__back" onClick={onBack} disabled={backDisabled}>
                <span className="step-tracker__marker">←</span>
                <span>{step.label}</span>
              </button>
            ) : (
              <>
                <span className="step-tracker__marker">{isDone ? '✓' : i + 1}</span>
                <span>{step.label}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
