import './talkMode.css';
import { formatUsd, formatClock, monthlyProjections } from '../voice/pricing';

// Stays up after a talk mode conversation until dismissed: what it cost, on which model, and
// what that cost would add up to per month at a few check-in frequencies.
export default function TalkCostCard({ stats, onDismiss }) {
  return (
    <div className="tm-cost" role="status">
      <button className="tm-cost-x" aria-label="Dismiss" onClick={onDismiss}>×</button>
      <h6>Talk mode cost <span>estimate</span></h6>
      <div className="tm-cost-main">
        <b>{formatUsd(stats.usd)}</b>
        <span>{formatClock(stats.seconds)} · {stats.turns} turn{stats.turns === 1 ? '' : 's'}</span>
      </div>
      <p className="tm-cost-model">{stats.engine} · <code>{stats.model}</code></p>
      {stats.parts && <p className="tm-cost-model">Her voice {formatUsd(stats.parts.output)} · listening and context {formatUsd(stats.parts.input)}</p>}
      <dl>
        {monthlyProjections(stats.usd).map(({ label, math, usd }) => (
          <div key={label}>
            <dt>{label}<small>{math}</small></dt>
            <dd>{formatUsd(usd)}<small>/mo</small></dd>
          </div>
        ))}
      </dl>
      <p className="tm-cost-note">If every conversation cost what this one did, over a 30-day month.</p>
    </div>
  );
}
