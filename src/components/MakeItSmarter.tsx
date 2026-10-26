import { R18_COPY, OLLAMA_DOCS_CHECKED, OLLAMA_DOCS_URL, originsCommand } from './plain-copy';
import { useModelSetting } from './useModelSetting';

// R18-G (specs/intake-flow.md §27.12, R18-PS-2). The "Optional: connect an AI helper" panel on the
// description screen. Shown when no model is set; when one is set the one-line model
// status (ModelStatus) says where the description goes, and this renders nothing.
// Presentation only. It names exactly two commands (`ollama signin` and the
// allowed-origins setting for THIS page's address) and links Ollama's own documentation
// for everything else, with the date the link was last checked. It names no model,
// version or price. Rendered after the first read of the stored setting, so a panel is
// never flashed at someone who already has a model. Newcomer test round 1 (2026-10-26): the panel leads with
// one plain sentence; the commands, link and date sit under a native <details>, closed by default.

export default function MakeItSmarter() {
  const { ready, state } = useModelSetting();
  if (!ready || !(state.kind === 'none' || state.kind === 'no-model')) return null;
  return (
    <section className="make-it-smarter" aria-labelledby="make-it-smarter-heading">
      <h2 id="make-it-smarter-heading" className="make-it-smarter__heading">
        {R18_COPY.PANEL_HEADING}
      </h2>
      <p>{R18_COPY.PANEL_EXPLANATION}</p>
      <details className="make-it-smarter__setup">
        <summary>{R18_COPY.PANEL_SUMMARY}</summary>
        <p>{R18_COPY.PANEL_SIGNIN_LEAD}</p>
        <p>
          <code className="make-it-smarter__command">{R18_COPY.PANEL_COMMAND_SIGNIN}</code>
        </p>
        <p>{R18_COPY.PANEL_ORIGINS_LEAD}</p>
        <p>
          <code className="make-it-smarter__command">{originsCommand(window.location.origin)}</code>
        </p>
        <p>{R18_COPY.PANEL_AFTER}</p>
        <p>
          <a href={OLLAMA_DOCS_URL} target="_blank" rel="noopener noreferrer">
            {R18_COPY.PANEL_LINK_TEXT}
          </a>{' '}
          <span className="field-help">{R18_COPY.PANEL_LINK_CHECKED.replace('{date}', OLLAMA_DOCS_CHECKED)}</span>
        </p>
      </details>
    </section>
  );
}
