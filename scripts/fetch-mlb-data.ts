import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MlbStatsClient, flattenGamesFromSchedule } from '../src/api/mlbStatsClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const value: string | true = next && !next.startsWith('--') ? next : true
    args[key] = value
    if (value !== true) i += 1
  }
  return args
}

async function writeJson(relativePath: string, payload: unknown): Promise<string> {
  const destination = path.join(projectRoot, relativePath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, JSON.stringify(payload, null, 2), 'utf-8')
  return destination
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const date = (args.date as string) || new Date().toISOString().slice(0, 10)
  const outputDir = (args.outputDir as string) || 'data/raw/mlbstats'
  const client = new MlbStatsClient()

  const schedule = await client.getScheduleByDate({ date })
  const games = flattenGamesFromSchedule(schedule)
  const schedulePath = await writeJson(`${outputDir}/schedule_${date}.json`, schedule)

  console.log(`Fetched schedule for ${date}: ${games.length} games`)
  console.log(`Saved: ${schedulePath}`)

  if (games.length === 0) return

  const selectedGamePk = Number(args.gamePk || games[0].gamePk)
  const liveFeed = await client.getGameFeed({ gamePk: selectedGamePk })
  const feedPath = await writeJson(`${outputDir}/live_game_${selectedGamePk}.json`, liveFeed)

  console.log(`Fetched live feed for gamePk ${selectedGamePk}`)
  console.log(`Saved: ${feedPath}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
