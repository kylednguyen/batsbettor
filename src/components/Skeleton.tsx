interface SkeletonProps {
  width?: string
  height?: string
  className?: string
  rounded?: boolean
}

export function Skeleton({ width = '100%', height = '14px', className = '', rounded = false }: SkeletonProps) {
  return (
    <span
      className={`skeleton${rounded ? ' skeleton--rounded' : ''}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

export function SidebarGameItemSkeleton() {
  return (
    <div className="sidebar-game-item sidebar-game-item--skeleton" aria-hidden="true">
      <span className="sidebar-game-item__matchup">
        <Skeleton width="80px" height="13px" />
        <Skeleton width="56px" height="10px" />
      </span>
      <Skeleton width="32px" height="13px" />
    </div>
  )
}

// Live Games dashboard — a grid of placeholder game cards.
export function LiveCardSkeleton() {
  return (
    <div className="live-card lgc" aria-hidden="true">
      <div className="lgc-head">
        <Skeleton width="96px" height="18px" />
        <Skeleton width="46px" height="14px" />
      </div>
      <div className="lgc-sub">
        <Skeleton width="150px" height="13px" />
      </div>
    </div>
  )
}

export function LiveGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="live-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <LiveCardSkeleton key={i} />
      ))}
    </div>
  )
}

// Top Edges / Odds dashboards — placeholder table rows.
export function DashTableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="dash-table-wrap" aria-hidden="true">
      <div className="dash-skeleton">
        {Array.from({ length: rows }).map((_, r) => (
          <div className="dash-skeleton__row" key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} width={c === 0 ? '130px' : '52px'} height="14px" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Model tab — placeholder insight cards.
export function ModelInsightsSkeleton() {
  return (
    <div className="model-insights" aria-hidden="true">
      <div className="model-insights__grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div className="insight-card" key={i}>
            <Skeleton width="90px" height="11px" />
            <Skeleton width="70%" height="18px" className="skel-mt" />
            <Skeleton width="100%" height="13px" className="skel-mt" />
            <Skeleton width="100%" height="13px" className="skel-mt" />
            <Skeleton width="60%" height="13px" className="skel-mt" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function GamePanelSkeleton() {
  return (
    <div className="game-panel-skeleton" aria-hidden="true">
      <div className="game-panel-skeleton__header">
        <Skeleton width="120px" height="22px" />
        <Skeleton width="48px" height="14px" />
      </div>
      <div className="game-panel-skeleton__body">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="game-panel-skeleton__row" key={i}>
            <Skeleton width="60px" height="13px" />
            <Skeleton width="100%" height="13px" />
          </div>
        ))}
      </div>
    </div>
  )
}
