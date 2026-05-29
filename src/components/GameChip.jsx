export function GameChip({ game }) {
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
