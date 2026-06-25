import type { Prediction, PitcherProfile, TeamFormSummary } from '../types'

// Rich pregame overview for a selected game's "Overview" tab. Everything here is
// real data from /api/predict (MLB StatsAPI form + probable starters), arranged
// as a scouting view: the model line, the pitching matchup, and recent form.

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
const num = (v: number | null | undefined, digits = 2): string =>
  v == null ? '—' : v.toFixed(digits)

function PitcherColumn({ label, p }: { label: string | null; p: PitcherProfile | null }) {
  return (
    <div className="sp-col-card">
      <div className="sp-col-card__head">
        <span className="sp-col-card__team">{label}</span>
        <span className="sp-col-card__name">{p?.name ?? 'TBD'}</span>
      </div>
      <div className="sp-col-card__stats">
        <div><span>ERA</span><strong>{num(p?.era)}</strong></div>
        <div><span>FIP</span><strong>{num(p?.fip)}</strong></div>
        <div><span>K/9</span><strong>{num(p?.k9, 1)}</strong></div>
        <div><span>xRA9</span><strong>{num(p?.expectedRA9)}</strong></div>
      </div>
    </div>
  )
}

function FormColumn({ label, form }: { label: string | null; form: TeamFormSummary | null }) {
  const diff = form?.runDiffPerGame
  return (
    <div className="form-col-card">
      <span className="form-col-card__team">{label}</span>
      <strong className="form-col-card__record">{form?.record ?? '—'}</strong>
      <div className="form-col-card__meta">
        <span>{form ? `${(form.winPct * 100).toFixed(0)}% win` : '—'}</span>
        <span className={diff != null && diff > 0 ? 'pos' : diff != null && diff < 0 ? 'neg' : ''}>
          {diff != null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)} run diff/g` : '—'}
        </span>
      </div>
    </div>
  )
}

export function PregameOverview({ prediction }: { prediction: Prediction | null }) {
  if (!prediction) return null
  const p = prediction
  const homeProb = p.model.homeWinProbability
  const awayProb = p.model.awayWinProbability
  const homeFav = homeProb >= awayProb
  const sp = p.startingPitchers
  const hasStarters = Boolean(sp && (sp.home || sp.away))
  const hasForm = Boolean(p.homeForm || p.awayForm)

  return (
    <section className="detail-section pregame-overview">
      {/* Model line: win-prob split + projected score */}
      <div className="detail-card pregame-line">
        <p className="section-label">Model line</p>
        <div className="pregame-line__teams">
          <div className={`pregame-line__team${!homeFav ? ' pregame-line__team--fav' : ''}`}>
            <span className="pregame-line__abbr">{p.awayAbbreviation}</span>
            <span className="pregame-line__prob">{pct(awayProb)}</span>
          </div>
          <div className={`pregame-line__team pregame-line__team--right${homeFav ? ' pregame-line__team--fav' : ''}`}>
            <span className="pregame-line__prob">{pct(homeProb)}</span>
            <span className="pregame-line__abbr">{p.homeAbbreviation}</span>
          </div>
        </div>
        <div className="winprob-split">
          <span className="winprob-split__away" style={{ width: `${awayProb * 100}%` }} />
          <span className="winprob-split__home" style={{ width: `${homeProb * 100}%` }} />
        </div>
        <div className="pregame-line__meta">
          <span>Proj <strong>{p.awayAbbreviation} {p.model.projectedAwayRuns}–{p.model.projectedHomeRuns} {p.homeAbbreviation}</strong></span>
          <span>Total <strong>{p.model.projectedTotalRuns}</strong></span>
        </div>
      </div>

      {/* Pitching matchup */}
      {hasStarters && (
        <div className="detail-card">
          <p className="section-label">Pitching matchup</p>
          <div className="sp-matchup">
            <PitcherColumn label={p.awayAbbreviation} p={sp?.away ?? null} />
            <span className="sp-matchup__vs">vs</span>
            <PitcherColumn label={p.homeAbbreviation} p={sp?.home ?? null} />
          </div>
        </div>
      )}

      {/* Recent form */}
      {hasForm && (
        <div className="detail-card">
          <p className="section-label">Recent form (last 30)</p>
          <div className="form-grid">
            <FormColumn label={p.awayAbbreviation} form={p.awayForm} />
            <FormColumn label={p.homeAbbreviation} form={p.homeForm} />
          </div>
        </div>
      )}
    </section>
  )
}
