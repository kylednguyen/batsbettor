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
