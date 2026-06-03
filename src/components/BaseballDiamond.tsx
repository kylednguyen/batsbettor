interface OccupiedBases {
  first: boolean
  second: boolean
  third: boolean
}

function getOccupiedBases(baseState: string | null | undefined): OccupiedBases {
  const normalized = (baseState || '').toLowerCase()
  return {
    first: normalized.includes('1st'),
    second: normalized.includes('2nd'),
    third: normalized.includes('3rd'),
  }
}

interface BaseballDiamondProps {
  baseState?: string | null
  caption?: string | null
}

export function BaseballDiamond({ baseState, caption }: BaseballDiamondProps) {
  const occupied = getOccupiedBases(baseState)
  const visibleCaption = caption ?? (baseState && baseState !== 'Bases empty' ? baseState : null)

  return (
    <div className="diamond-card">
      <div className="diamond">
        <div className="diamond-infield" />
        <div className={`base base--first${occupied.first ? ' base--occupied' : ''}`} />
        <div className={`base base--second${occupied.second ? ' base--occupied' : ''}`} />
        <div className={`base base--third${occupied.third ? ' base--occupied' : ''}`} />
        <div className="base base--home" />
      </div>
      {visibleCaption ? <p className="diamond-caption">{visibleCaption}</p> : null}
    </div>
  )
}

interface MiniBaseballDiamondProps {
  baseState?: string | null
}

export function MiniBaseballDiamond({ baseState }: MiniBaseballDiamondProps) {
  const occupied = getOccupiedBases(baseState)
  const label = baseState && baseState !== 'Bases empty' ? baseState : undefined

  return (
    <div
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className="mini-diamond"
      title={label}
    >
      <span className={`mini-base mini-base--first${occupied.first ? ' mini-base--occupied' : ''}`} />
      <span className={`mini-base mini-base--second${occupied.second ? ' mini-base--occupied' : ''}`} />
      <span className={`mini-base mini-base--third${occupied.third ? ' mini-base--occupied' : ''}`} />
    </div>
  )
}
