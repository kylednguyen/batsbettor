import type { LiveGame } from '../types'

interface GameChipProps {
  game: LiveGame
}

export function GameChip({ game }: GameChipProps) {
  return (
    <article className="game-chip">
      <div className="game-chip-header">
        <strong>{game.matchup}</strong>
        <span>{game.status}</span>
      </div>
      <p>{game.score}</p>
    </article>
  )
}
