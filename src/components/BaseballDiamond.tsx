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

// Proper baseball-diamond layout: 2nd top-center, 3rd middle-left, 1st
// middle-right, home bottom-center. Each base is a 45°-rotated square; occupied
// bases are filled red, empty are muted. The grid never shifts when score text
// changes because every base is absolutely positioned in a fixed-size box.
export function MiniBaseballDiamond({ baseState }: MiniBaseballDiamondProps) {
  const occupied = getOccupiedBases(baseState)
  const label = baseState && baseState !== 'Bases empty' ? baseState : undefined

  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className="base-diamond"
      role={label ? 'img' : undefined}
      title={label}
    >
      <span className={`base base--second${occupied.second ? ' base--occupied' : ''}`} />
      <span className={`base base--third${occupied.third ? ' base--occupied' : ''}`} />
      <span className={`base base--first${occupied.first ? ' base--occupied' : ''}`} />
      <span className="base base--home" />
    </span>
  )
}
