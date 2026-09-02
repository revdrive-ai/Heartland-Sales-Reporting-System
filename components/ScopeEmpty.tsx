import WorkflowStrip from "./WorkflowStrip";

/* Shown when the global customer scope resolves to no data for a view —
   e.g. a parent account whose NIQ trading areas aren't loaded yet. */
export default function ScopeEmpty({
  current, crumb, title, label, message,
}: {
  current: string; crumb: string; title: string; label: string; message: string;
}) {
  return (
    <div className="view active">
      <WorkflowStrip current={current} />
      <div className="pagehead">
        <div>
          <div className="crumb">{crumb}</div>
          <h1>{title}</h1>
          <p>Scoped to <b>{label}</b> by the customer selectors above.</p>
        </div>
      </div>
      <div className="card">
        <b>Nothing to show for this scope.</b>
        <div className="note" style={{ marginTop: 8 }}>◇ {message} Clear or widen the selectors in the top bar to bring data back.</div>
      </div>
    </div>
  );
}
