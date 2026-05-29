import { useEffect, useMemo, useState } from 'react'
import type { ScoreCard, MlbFeedPayload, StatEntry, PitchEvent, PitchLocation, MlbPerson, MlbTeam } from '../types'
import { BaseballDiamond as _BaseballDiamond, MiniBaseballDiamond } from './BaseballDiamond'

const PITCH_CODE_LABELS: Record<string, string> = {
  B: 'Ball',
  C: 'Called Strike',
  F: 'Foul',
  S: 'Swinging Strike',
  X: 'In Play',
}

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatName(person: MlbPerson | null | undefined): string | null {
  return person?.fullName || null
}

function formatRecord(record: { wins?: number; losses?: number } | null | undefined): string | null {
  const wins = record?.wins
  const losses = record?.losses
  if (wins === null || wins === undefined || losses === null || losses === undefined) return null
  return `${wins}-${losses}`
}

function formatStatLine(stats: Record<string, number | string | undefined | null> | null | undefined): string | null {
  if (!stats) return null
  const hits = stats.hits
  const atBats = stats.atBats
  if (hits === undefined || hits === null || atBats === undefined || atBats === null) return null

  const suffixes = [
    (stats.homeRuns as number) > 0 ? `${stats.homeRuns} HR` : null,
    (stats.rbi as number) > 0 ? `${stats.rbi} RBI` : null,
    (stats.baseOnBalls as number) > 0 ? `${stats.baseOnBalls} BB` : null,
  ].filter(Boolean)

  return [`${hits}-${atBats}`, ...suffixes].join(' • ')
}

function formatArrowInning(halfInning: string | null | undefined, inningOrdinal: string | null | undefined): string | null {
  if (!halfInning || !inningOrdinal) return null
  const arrow = String(halfInning).toLowerCase().includes('top') ? '↑' : '↓'
  return `${arrow} ${inningOrdinal}`
}

function formatOrdinals(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  if (numeric % 100 >= 11 && numeric % 100 <= 13) return `${numeric}th`
  if (numeric % 10 === 1) return `${numeric}st`
  if (numeric % 10 === 2) return `${numeric}nd`
  if (numeric % 10 === 3) return `${numeric}rd`
  return `${numeric}th`
}

function abbreviateName(value: string | null | undefined): string | null {
  if (!value) return null
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const first = parts[0]
  const last = parts[parts.length - 1]
  return `${first[0]}. ${last}`
}

function buildHeadshotUrl(personId: number | null | undefined): string | null {
  if (!personId) return null
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/${personId}/headshot/67/current`
}

function buildTeamLogoUrl(teamId: number | null | undefined): string | null {
  if (!teamId) return null
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`
}

function uniqueValues<T>(values: (T | null | undefined)[] | null | undefined): T[] {
  return [...new Set((values ?? []).filter((v): v is T => v !== null && v !== undefined))]
}

function pickStatEntries(
  statMap: Record<string, unknown> | null | undefined,
  labels: [string, string][]
): StatEntry[] {
  return labels
    .map(([label, key]) => {
      const value = statMap?.[key]
      if (value === null || value === undefined || value === '' || value === '.---' || value === '-.--') {
        return null
      }
      return { label, value: value as string | number }
    })
    .filter((entry): entry is StatEntry => entry !== null)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPlayer(feed: MlbFeedPayload | null, playerId: number | undefined): Record<string, any> | null {
  const awayPlayers = feed?.liveData?.boxscore?.teams?.away?.players ?? {}
  const homePlayers = feed?.liveData?.boxscore?.teams?.home?.players ?? {}
  return awayPlayers[`ID${playerId}`] ?? homePlayers[`ID${playerId}`] ?? null
}

type StatusBucket = 'final' | 'live' | 'scheduled' | 'other'

function getStatusBucket(statusCode: string | null | undefined, statusText: string | null | undefined): StatusBucket {
  if (statusCode === 'F' || /final|completed/i.test(statusText || '')) return 'final'
  if (statusCode === 'L' || /in progress|live/i.test(statusText || '')) return 'live'
  if (statusCode === 'P' || /scheduled|pre-game|pregame/i.test(statusText || '')) return 'scheduled'
  return 'other'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePitchResult(event: Record<string, any> | null | undefined): string | null {
  const detailText = event?.details?.description || PITCH_CODE_LABELS[event?.details?.code] || event?.result || null
  if (!detailText) return null
  return String(detailText).toUpperCase()
}

interface InningRows {
  inningLabels: (string | number)[]
  rows: Array<{
    team: string | null | undefined
    inningRuns: (number | string)[]
    totals: Record<string, unknown>
  }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInningRows(linescore: Record<string, any> | null | undefined, awayAbbreviation: string | null | undefined, homeAbbreviation: string | null | undefined): InningRows | null {
  const innings = linescore?.innings ?? []
  if (innings.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inningLabels = innings.map((inning: any) => inning.ordinalNum || inning.num)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const awayRuns = innings.map((inning: any) => inning.away?.runs ?? '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const homeRuns = innings.map((inning: any) => inning.home?.runs ?? '')
  const totals = linescore?.teams ?? {}

  return {
    inningLabels,
    rows: [
      { team: awayAbbreviation, inningRuns: awayRuns, totals: totals.away ?? {} },
      { team: homeAbbreviation, inningRuns: homeRuns, totals: totals.home ?? {} },
    ],
  }
}

interface LiveContext {
  inningState: string | null
  countEntries: StatEntry[]
  pitcherName: string | null
  pitcherStats: StatEntry[]
  pitcherCount: number | null
  pitcherThrows: string | null
  pitcherHeadshot: string | null
  pitcherEra: string | null
  batterName: string | null
  batterStats: StatEntry[]
  batterLine: string | null
  batterSide: string | null
  batterHeadshot: string | null
  baseState: string | null
  rawBaseState: string
  balls: number | null
  strikes: number | null
  outs: number | null
  outsSummary: string | null
  onDeck: string | null
  lastEvent: string | null
  pitchHistory: PitchEvent[]
  pitchLocation: PitchLocation | null
  latestPitchLabel: string | null
  latestPitchType: string | null
  latestPitchVelocity: number | null
}

function buildLiveContext(feed: MlbFeedPayload | null): LiveContext {
  const linescore = feed?.liveData?.linescore
  const currentPlay = feed?.liveData?.plays?.currentPlay
  const offense = linescore?.offense ?? {}
  const defense = linescore?.defense ?? {}
  const batter = currentPlay?.matchup?.batter ?? offense?.batter ?? null
  const pitcher = currentPlay?.matchup?.pitcher ?? defense?.pitcher ?? null
  const batterPlayer = batter?.id ? findPlayer(feed, batter.id) : null
  const pitcherPlayer = pitcher?.id ? findPlayer(feed, pitcher.id) : null

  const batterStats = pickStatEntries(batterPlayer?.stats?.batting, [
    ['AB', 'atBats'],
    ['H', 'hits'],
    ['RBI', 'rbi'],
    ['BB', 'baseOnBalls'],
    ['SO', 'strikeOuts'],
    ['HR', 'homeRuns'],
  ])

  const pitcherStats = pickStatEntries(pitcherPlayer?.stats?.pitching, [
    ['P', 'numberOfPitches'],
    ['IP', 'inningsPitched'],
    ['K', 'strikeOuts'],
    ['ER', 'earnedRuns'],
    ['BB', 'baseOnBalls'],
  ])

  const runnerEntries = [
    offense?.first ? `1st: ${offense.first.fullName}` : null,
    offense?.second ? `2nd: ${offense.second.fullName}` : null,
    offense?.third ? `3rd: ${offense.third.fullName}` : null,
  ].filter(Boolean) as string[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pitchEvents = (currentPlay?.playEvents ?? []).filter((event: any) => event?.isPitch)
  const pitchHistory: PitchEvent[] = pitchEvents
    .slice(-6)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((event: any) => ({
      id: event?.playId ?? `${event?.pitchNumber ?? Math.random()}`,
      number: event?.pitchNumber ?? null,
      result: normalizePitchResult(event),
      pitchType: event?.details?.type?.description ?? event?.details?.type ?? null,
      velocity: event?.pitchData?.startSpeed ?? null,
      x: event?.pitchData?.coordinates?.pX,
      z: event?.pitchData?.coordinates?.pZ,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((event: any) => event.result || event.pitchType || event.velocity || (event.x !== undefined && event.z !== undefined))

  const lastEvent =
    currentPlay?.result?.description ||
    currentPlay?.playEvents?.slice(-1)?.[0]?.details?.description ||
    currentPlay?.result?.event ||
    null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestPitch = [...(currentPlay?.playEvents ?? [])].reverse().find((event: any) =>
    event?.isPitch && event?.pitchData?.coordinates?.pX !== undefined && event?.pitchData?.coordinates?.pZ !== undefined
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestTaggedPitch = [...(currentPlay?.playEvents ?? [])].reverse().find((event: any) => event?.isPitch)

  const pitcherCount: number | null = pitcherPlayer?.stats?.pitching?.numberOfPitches ?? null
  const batterLine = formatStatLine(batterPlayer?.stats?.batting)
  const pitcherEra: string | null = pitcherPlayer?.seasonStats?.pitching?.era ?? pitcherPlayer?.stats?.pitching?.era ?? null
  const onDeck: string | null = offense?.onDeck?.fullName ?? null
  const _outLabel =
    linescore?.outs !== undefined && linescore?.outs !== null
      ? `${formatOrdinals(linescore.outs + 1)?.replace('1st', '1 out').replace('2nd', '2 outs').replace('3rd', '3 outs')}`
      : null

  return {
    inningState:
      linescore?.inningHalf && linescore?.currentInningOrdinal
        ? formatArrowInning(linescore.inningHalf, linescore.currentInningOrdinal)
        : null,
    countEntries: pickStatEntries(
      { balls: linescore?.balls, strikes: linescore?.strikes, outs: linescore?.outs },
      [['Balls', 'balls'], ['Strikes', 'strikes'], ['Outs', 'outs']]
    ),
    pitcherName: formatName(pitcher),
    pitcherStats,
    pitcherCount,
    pitcherThrows: currentPlay?.matchup?.pitchHand?.code ?? null,
    pitcherHeadshot: buildHeadshotUrl(pitcher?.id),
    pitcherEra,
    batterName: formatName(batter),
    batterStats,
    batterLine,
    batterSide: currentPlay?.matchup?.batSide?.code ?? null,
    batterHeadshot: buildHeadshotUrl(batter?.id),
    baseState: runnerEntries.length > 0 ? runnerEntries.join(' | ') : null,
    rawBaseState: [offense?.first ? '1st' : null, offense?.second ? '2nd' : null, offense?.third ? '3rd' : null]
      .filter(Boolean)
      .join(', ') || 'Bases empty',
    balls: linescore?.balls ?? null,
    strikes: linescore?.strikes ?? null,
    outs: linescore?.outs ?? null,
    outsSummary:
      linescore?.outs !== undefined && linescore?.outs !== null
        ? `${linescore.outs} ${linescore.outs === 1 ? 'out' : 'outs'}`
        : null,
    onDeck: abbreviateName(onDeck),
    lastEvent,
    pitchHistory,
    pitchLocation:
      latestPitch?.pitchData?.coordinates?.pX !== undefined && latestPitch?.pitchData?.coordinates?.pZ !== undefined
        ? {
            x: latestPitch.pitchData.coordinates.pX,
            z: latestPitch.pitchData.coordinates.pZ,
            pitchType: latestPitch?.details?.type?.description ?? latestPitch?.details?.type ?? null,
            velocity: latestPitch?.pitchData?.startSpeed ?? null,
          }
        : null,
    latestPitchLabel:
      latestTaggedPitch?.details?.description ||
      PITCH_CODE_LABELS[latestTaggedPitch?.details?.code] ||
      latestTaggedPitch?.details?.type?.description ||
      null,
    latestPitchType:
      latestTaggedPitch?.details?.type?.description ||
      latestTaggedPitch?.details?.type ||
      null,
    latestPitchVelocity: latestTaggedPitch?.pitchData?.startSpeed ?? null,
  }
}

interface BatterRow {
  id: string | number
  name: string | null
  position: string | null
  orderSlot: number | null
  roleLabel: string | null
  isSubstitute: boolean
  values: Record<string, unknown>
}

interface BatterTable {
  team: string | null | undefined
  rows: BatterRow[]
  totals: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBatterTable(teamBoxscore: Record<string, any> | null | undefined, abbreviation: string | null | undefined): BatterTable | null {
  if (!teamBoxscore) return null

  const lineupIds: number[] = teamBoxscore.batters ?? []
  const playerMap: Record<string, unknown> = teamBoxscore.players ?? {}
  const seenPlayers = new Set<number>()
  const seenSlots = new Set<number>()

  const rows = lineupIds
    .filter((playerId) => {
      if (seenPlayers.has(playerId)) return false
      seenPlayers.add(playerId)
      return true
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((playerId) => (playerMap as Record<string, any>)[`ID${playerId}`])
    .filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((player: any): BatterRow | null => {
      const batting = player?.stats?.batting ?? null
      const battingOrder = player?.battingOrder ?? null
      const orderSlot =
        battingOrder && String(battingOrder).length >= 3
          ? Number.parseInt(String(battingOrder).slice(0, -2), 10)
          : null
      const values = {
        ab: batting?.atBats,
        h: batting?.hits,
        r: batting?.runs,
        rbi: batting?.rbi,
        bb: batting?.baseOnBalls,
        so: batting?.strikeOuts,
        hr: batting?.homeRuns,
        avg: batting?.avg,
      }

      const hasStats = Object.values(values).some((v) => v !== null && v !== undefined && v !== '' && v !== '.---')
      if (!hasStats) return null

      const isSubstitute =
        Boolean(player?.gameStatus?.isSubstitute) ||
        (orderSlot !== null && seenSlots.has(orderSlot))

      if (orderSlot !== null) seenSlots.add(orderSlot)

      return {
        id: player?.person?.id ?? `${abbreviation}-${player?.person?.fullName}`,
        name: player?.person?.fullName ?? null,
        position: player?.position?.abbreviation ?? null,
        orderSlot,
        roleLabel: isSubstitute ? player?.position?.abbreviation ?? 'Sub' : null,
        isSubstitute,
        values,
      }
    })
    .filter((row): row is BatterRow => row !== null)

  if (rows.length === 0) return null

  return {
    team: abbreviation,
    rows,
    totals: {
      ab: teamBoxscore?.teamStats?.batting?.atBats ?? null,
      h: teamBoxscore?.teamStats?.batting?.hits ?? null,
      r: teamBoxscore?.teamStats?.batting?.runs ?? null,
      rbi: teamBoxscore?.teamStats?.batting?.rbi ?? null,
      bb: teamBoxscore?.teamStats?.batting?.baseOnBalls ?? null,
      so: teamBoxscore?.teamStats?.batting?.strikeOuts ?? null,
      hr: teamBoxscore?.teamStats?.batting?.homeRuns ?? null,
      avg: teamBoxscore?.teamStats?.batting?.avg ?? null,
    },
  }
}

interface PitcherRow {
  id: string | number
  name: string | null
  hand: string | null
  values: Record<string, unknown>
}

interface PitcherTable {
  team: string | null | undefined
  rows: PitcherRow[]
  totals: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPitcherTable(teamBoxscore: Record<string, any> | null | undefined, abbreviation: string | null | undefined): PitcherTable | null {
  if (!teamBoxscore) return null

  const pitcherIds = uniqueValues<number>(teamBoxscore.pitchers)
  const playerMap: Record<string, unknown> = teamBoxscore.players ?? {}

  const rows = pitcherIds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((playerId) => (playerMap as Record<string, any>)[`ID${playerId}`])
    .filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((player: any): PitcherRow | null => {
      const pitching = player?.stats?.pitching ?? null
      const values = {
        ip: pitching?.inningsPitched,
        h: pitching?.hits,
        r: pitching?.runs,
        er: pitching?.earnedRuns,
        k: pitching?.strikeOuts,
        bb: pitching?.baseOnBalls,
        hr: pitching?.homeRuns,
        era: pitching?.era ?? player?.seasonStats?.pitching?.era,
        whip: pitching?.whip ?? player?.seasonStats?.pitching?.whip,
      }

      const hasStats = Object.values(values).some((v) => v !== null && v !== undefined && v !== '' && v !== '.---' && v !== '-.--')
      if (!hasStats) return null

      return {
        id: player?.person?.id ?? `${abbreviation}-${player?.person?.fullName}`,
        name: player?.person?.fullName ?? null,
        hand: player?.pitchHand?.code ?? null,
        values,
      }
    })
    .filter((row): row is PitcherRow => row !== null)

  if (rows.length === 0) return null

  return {
    team: abbreviation,
    rows,
    totals: {
      ip: teamBoxscore?.teamStats?.pitching?.inningsPitched ?? null,
      h: teamBoxscore?.teamStats?.pitching?.hits ?? null,
      r: teamBoxscore?.teamStats?.pitching?.runs ?? null,
      er: teamBoxscore?.teamStats?.pitching?.earnedRuns ?? null,
      k: teamBoxscore?.teamStats?.pitching?.strikeOuts ?? null,
      bb: teamBoxscore?.teamStats?.pitching?.baseOnBalls ?? null,
      hr: teamBoxscore?.teamStats?.pitching?.homeRuns ?? null,
      era: teamBoxscore?.teamStats?.pitching?.era ?? null,
      whip: teamBoxscore?.teamStats?.pitching?.whip ?? null,
    },
  }
}

interface ScoringEvent {
  id: string
  inning: string
  summary: string | null
  awayScore: number | null
  homeScore: number | null
  battingTeam: string | null | undefined
}

interface BoxScoreTeam {
  key: string
  team: string | null | undefined
  battingTable: BatterTable | null
  pitchingTable: PitcherTable | null
}

interface BoxScoreContext {
  innings: InningRows | null
  teams: BoxScoreTeam[]
  battingTables: BatterTable[]
  battingRows: Array<{ team: string | null | undefined; stats: StatEntry[] }>
  pitchingRows: Array<{ team: string | null | undefined; stats: StatEntry[] }>
  decisions: string[]
  scoringEvents: ScoringEvent[]
}

function buildBoxScoreContext(feed: MlbFeedPayload | null, selectedCard: ScoreCard | null | undefined): BoxScoreContext {
  const linescore = feed?.liveData?.linescore
  const away = feed?.liveData?.boxscore?.teams?.away
  const home = feed?.liveData?.boxscore?.teams?.home
  const decisions = feed?.liveData?.decisions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlays: any[] = feed?.liveData?.plays?.allPlays ?? []
  const scoringEvents: ScoringEvent[] = allPlays
    .filter((play) => play?.about?.isScoringPlay)
    .map((play, index) => ({
      id: `${play.about?.inning}-${play.about?.halfInning}-${index}`,
      inning: `${play.about?.halfInning === 'top' ? '↑' : '↓'} ${play.about?.inning}${play.about?.inning === 1 ? 'st' : play.about?.inning === 2 ? 'nd' : play.about?.inning === 3 ? 'rd' : 'th'}`,
      summary: play?.result?.description ?? null,
      awayScore: play?.result?.awayScore ?? null,
      homeScore: play?.result?.homeScore ?? null,
      battingTeam:
        play?.about?.halfInning === 'top'
          ? selectedCard?.awayAbbreviation
          : selectedCard?.homeAbbreviation,
    }))
    .filter((event) => event.summary)

  return {
    innings: buildInningRows(linescore, selectedCard?.awayAbbreviation, selectedCard?.homeAbbreviation),
    teams: [
      {
        key: 'away',
        team: selectedCard?.awayAbbreviation,
        battingTable: buildBatterTable(away, selectedCard?.awayAbbreviation),
        pitchingTable: buildPitcherTable(away, selectedCard?.awayAbbreviation),
      },
      {
        key: 'home',
        team: selectedCard?.homeAbbreviation,
        battingTable: buildBatterTable(home, selectedCard?.homeAbbreviation),
        pitchingTable: buildPitcherTable(home, selectedCard?.homeAbbreviation),
      },
    ].filter((team) => team.battingTable || team.pitchingTable),
    battingTables: [
      buildBatterTable(away, selectedCard?.awayAbbreviation),
      buildBatterTable(home, selectedCard?.homeAbbreviation),
    ].filter((t): t is BatterTable => t !== null),
    battingRows: [
      { team: selectedCard?.awayAbbreviation, stats: pickStatEntries(away?.teamStats?.batting, [['AB', 'atBats'], ['H', 'hits'], ['R', 'runs'], ['RBI', 'rbi'], ['BB', 'baseOnBalls'], ['SO', 'strikeOuts'], ['HR', 'homeRuns']]) },
      { team: selectedCard?.homeAbbreviation, stats: pickStatEntries(home?.teamStats?.batting, [['AB', 'atBats'], ['H', 'hits'], ['R', 'runs'], ['RBI', 'rbi'], ['BB', 'baseOnBalls'], ['SO', 'strikeOuts'], ['HR', 'homeRuns']]) },
    ],
    pitchingRows: [
      { team: selectedCard?.awayAbbreviation, stats: pickStatEntries(away?.teamStats?.pitching, [['IP', 'inningsPitched'], ['H', 'hits'], ['R', 'runs'], ['ER', 'earnedRuns'], ['BB', 'baseOnBalls'], ['SO', 'strikeOuts'], ['Pitches', 'numberOfPitches']]) },
      { team: selectedCard?.homeAbbreviation, stats: pickStatEntries(home?.teamStats?.pitching, [['IP', 'inningsPitched'], ['H', 'hits'], ['R', 'runs'], ['ER', 'earnedRuns'], ['BB', 'baseOnBalls'], ['SO', 'strikeOuts'], ['Pitches', 'numberOfPitches']]) },
    ],
    decisions: [
      decisions?.winner ? `W: ${decisions.winner.fullName}` : null,
      decisions?.loser ? `L: ${decisions.loser.fullName}` : null,
      decisions?.save ? `SV: ${decisions.save.fullName}` : null,
    ].filter((d): d is string => d !== null),
    scoringEvents,
  }
}

interface ScheduledContext {
  previewItems: Array<{ label: string; value: string }>
}

function buildScheduledContext(feed: MlbFeedPayload | null): ScheduledContext {
  const gameData = feed?.gameData ?? {}
  const probablePitchers = gameData?.probablePitchers ?? {}
  const venue: string | null = gameData?.venue?.name ?? null
  const previewItems = [
    venue ? { label: 'Venue', value: venue } : null,
    probablePitchers?.away?.fullName ? { label: 'Away probable', value: probablePitchers.away.fullName as string } : null,
    probablePitchers?.home?.fullName ? { label: 'Home probable', value: probablePitchers.home.fullName as string } : null,
  ].filter((item): item is { label: string; value: string } => item !== null)

  return { previewItems }
}

// ---- Sub-components ----

interface AssetImageProps {
  alt: string
  className?: string
  src: string | null
}

function AssetImage({ alt, className, src }: AssetImageProps) {
  return src ? (
    <img
      alt={alt}
      className={className}
      loading="lazy"
      onError={(event) => { event.currentTarget.style.display = 'none' }}
      src={src}
    />
  ) : null
}

interface TeamBadgeProps {
  abbreviation: string | null | undefined
  logoUrl: string | null
  teamName: string | null | undefined
}

function TeamBadge({ abbreviation, logoUrl, teamName }: TeamBadgeProps) {
  return (
    <div className="team-badge">
      <AssetImage alt={`${teamName} logo`} className="team-badge__logo" src={logoUrl} />
      <span>{abbreviation}</span>
    </div>
  )
}

interface StatPillsProps {
  entries: StatEntry[] | null | undefined
}

function StatPills({ entries }: StatPillsProps) {
  if (!entries || entries.length === 0) return null
  return (
    <div className="detail-pill-grid">
      {entries.map((entry) => (
        <div className="detail-pill" key={`${entry.label}-${entry.value}`}>
          <span>{entry.label}</span>
          <strong>{entry.value}</strong>
        </div>
      ))}
    </div>
  )
}

interface BoxScoreTableProps {
  innings: InningRows | null | undefined
}

function BoxScoreTable({ innings }: BoxScoreTableProps) {
  if (!innings) return null
  const gridTemplateColumns = `68px repeat(${innings.inningLabels.length}, minmax(28px, 1fr)) 34px 34px 34px`
  return (
    <div className="boxscore-table">
      <div className="boxscore-row boxscore-row--header" style={{ gridTemplateColumns }}>
        <span>Team</span>
        {innings.inningLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
        <span>R</span>
        <span>H</span>
        <span>E</span>
      </div>
      {innings.rows.map((row) => (
        <div className="boxscore-row" key={String(row.team)} style={{ gridTemplateColumns }}>
          <span>{row.team}</span>
          {row.inningRuns.map((value, index) => (
            <span key={`${row.team}-${index}`}>{value}</span>
          ))}
          <strong>{(row.totals as Record<string, unknown>).runs as string ?? ''}</strong>
          <strong>{(row.totals as Record<string, unknown>).hits as string ?? ''}</strong>
          <strong>{(row.totals as Record<string, unknown>).errors as string ?? ''}</strong>
        </div>
      ))}
    </div>
  )
}

function formatTableValue(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === '.---') return ''
  return String(value)
}

interface TeamStatRowsProps {
  title: string
  rows: Array<{ team: string | null | undefined; stats: StatEntry[] }>
}

function TeamStatRows({ title, rows }: TeamStatRowsProps) {
  const visibleRows = rows?.filter((row) => row.stats && row.stats.length > 0) ?? []
  if (visibleRows.length === 0) return null
  return (
    <section className="detail-section">
      <p className="section-label">{title}</p>
      <div className="team-stat-grid">
        {visibleRows.map((row) => (
          <article className="team-stat-card" key={`${title}-${row.team}`}>
            <h3>{row.team}</h3>
            <StatPills entries={row.stats} />
          </article>
        ))}
      </div>
    </section>
  )
}

interface BatterLineTablesProps {
  tables: BatterTable[] | null | undefined
}

function BatterLineTables({ tables }: BatterLineTablesProps) {
  if (!tables || tables.length === 0) return null
  return (
    <section className="detail-section">
      <p className="section-label">Batters</p>
      <div className="batter-table-grid">
        {tables.map((table) => (
          <article className="detail-card batter-table-card" key={String(table.team)}>
            <div className="batter-table-card__header">
              <h3>{table.team}</h3>
              <span>Box score</span>
            </div>
            <div className="batter-table">
              <div className="batter-table__row batter-table__row--header">
                <span>Player</span>
                <span>AB</span><span>H</span><span>R</span><span>RBI</span>
                <span>BB</span><span>SO</span><span>HR</span><span>AVG</span>
              </div>
              {table.rows.map((row) => (
                <div className={`batter-table__row${row.isSubstitute ? ' batter-table__row--substitute' : ''}`} key={String(row.id)}>
                  <div className="batter-table__player">
                    <strong><span>{row.name}</span></strong>
                    {row.isSubstitute ? (
                      <span>{row.roleLabel ? `Sub • ${row.roleLabel}` : 'Substitute'}</span>
                    ) : row.position ? (
                      <span>{row.position}</span>
                    ) : null}
                  </div>
                  <span>{formatTableValue(row.values.ab)}</span>
                  <span>{formatTableValue(row.values.h)}</span>
                  <span>{formatTableValue(row.values.r)}</span>
                  <span>{formatTableValue(row.values.rbi)}</span>
                  <span>{formatTableValue(row.values.bb)}</span>
                  <span>{formatTableValue(row.values.so)}</span>
                  <span>{formatTableValue(row.values.hr)}</span>
                  <span>{formatTableValue(row.values.avg)}</span>
                </div>
              ))}
              <div className="batter-table__row batter-table__row--totals">
                <div className="batter-table__player"><strong>Totals</strong></div>
                <strong>{formatTableValue(table.totals.ab)}</strong>
                <strong>{formatTableValue(table.totals.h)}</strong>
                <strong>{formatTableValue(table.totals.r)}</strong>
                <strong>{formatTableValue(table.totals.rbi)}</strong>
                <strong>{formatTableValue(table.totals.bb)}</strong>
                <strong>{formatTableValue(table.totals.so)}</strong>
                <strong>{formatTableValue(table.totals.hr)}</strong>
                <strong />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

interface PitcherLineTablesProps {
  tables: PitcherTable[] | null | undefined
}

function PitcherLineTables({ tables }: PitcherLineTablesProps) {
  if (!tables || tables.length === 0) return null
  return (
    <section className="detail-section">
      <p className="section-label">Pitchers</p>
      <div className="pitcher-table-grid">
        {tables.map((table) => (
          <article className="detail-card batter-table-card" key={String(table.team)}>
            <div className="batter-table-card__header">
              <h3>{table.team}</h3>
              <span>Box score</span>
            </div>
            <div className="batter-table pitcher-table">
              <div className="batter-table__row batter-table__row--header pitcher-table__row">
                <span>Pitcher</span>
                <span>IP</span><span>H</span><span>R</span><span>ER</span>
                <span>K</span><span>BB</span><span>HR</span><span>ERA</span><span>WHIP</span>
              </div>
              {table.rows.map((row) => (
                <div className="batter-table__row pitcher-table__row" key={String(row.id)}>
                  <div className="batter-table__player">
                    <strong>{row.name}</strong>
                    {row.hand ? <span>{row.hand}HP</span> : null}
                  </div>
                  <span>{formatTableValue(row.values.ip)}</span>
                  <span>{formatTableValue(row.values.h)}</span>
                  <span>{formatTableValue(row.values.r)}</span>
                  <span>{formatTableValue(row.values.er)}</span>
                  <span>{formatTableValue(row.values.k)}</span>
                  <span>{formatTableValue(row.values.bb)}</span>
                  <span>{formatTableValue(row.values.hr)}</span>
                  <span>{formatTableValue(row.values.era)}</span>
                  <span>{formatTableValue(row.values.whip)}</span>
                </div>
              ))}
              <div className="batter-table__row batter-table__row--totals pitcher-table__row">
                <div className="batter-table__player"><strong>Totals</strong></div>
                <strong>{formatTableValue(table.totals.ip)}</strong>
                <strong>{formatTableValue(table.totals.h)}</strong>
                <strong>{formatTableValue(table.totals.r)}</strong>
                <strong>{formatTableValue(table.totals.er)}</strong>
                <strong>{formatTableValue(table.totals.k)}</strong>
                <strong>{formatTableValue(table.totals.bb)}</strong>
                <strong>{formatTableValue(table.totals.hr)}</strong>
                <strong />
                <strong />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

interface TeamToggleProps {
  activeTeamKey: string
  teams: BoxScoreTeam[]
  onChange: (key: string) => void
}

function TeamToggle({ activeTeamKey, teams, onChange }: TeamToggleProps) {
  if (!teams || teams.length < 2) return null
  return (
    <div className="team-toggle" role="tablist" aria-label="Box score team view">
      {teams.map((team) => (
        <button
          key={team.key}
          type="button"
          role="tab"
          aria-selected={activeTeamKey === team.key}
          className={`team-toggle__button${activeTeamKey === team.key ? ' team-toggle__button--active' : ''}`}
          onClick={() => onChange(team.key)}
        >
          {team.team}
        </button>
      ))}
    </div>
  )
}

interface ScoringSummaryProps {
  events: ScoringEvent[] | null | undefined
  awayAbbreviation: string | null | undefined
  homeAbbreviation: string | null | undefined
}

function ScoringSummary({ events, awayAbbreviation, homeAbbreviation }: ScoringSummaryProps) {
  if (!events || events.length === 0) return null
  return (
    <section className="detail-section">
      <div className="detail-card scoring-summary-card">
        <p className="section-label">Scoring summary</p>
        <div className="scoring-summary-table">
          <div className="scoring-summary-header">
            <span>Inning</span>
            <span>Play</span>
            <span>{awayAbbreviation}</span>
            <span>{homeAbbreviation}</span>
          </div>
          {events.map((event) => (
            <div className="scoring-summary-row" key={event.id}>
              <span>{event.inning}</span>
              <div className="scoring-summary-play">
                <strong>{event.battingTeam}</strong>
                <p>{event.summary}</p>
              </div>
              <span>{event.awayScore}</span>
              <span>{event.homeScore}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

interface Tab {
  id: string
  label: string
}

interface DetailTabsProps {
  activeTab: string
  onChange: (id: string) => void
  tabs: Tab[]
}

function DetailTabs({ activeTab, onChange, tabs }: DetailTabsProps) {
  if (!tabs || tabs.length < 2) return null
  return (
    <div className="mt-4 border-t border-white/8 pt-3" role="tablist" aria-label="Selected game views">
      <div className="flex flex-wrap items-end justify-center gap-6">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`border-b-2 px-1 pb-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? 'border-[rgb(193,41,46)] text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-100'
            }`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface PitchLocationZoneProps {
  history?: PitchEvent[]
  onSelectPitch?: (id: string) => void
  selectedPitchId: string | null
}

function PitchLocationZone({ history = [], onSelectPitch, selectedPitchId }: PitchLocationZoneProps) {
  if (!history || history.length === 0) return null
  const pitchTrail = history
  const selectedPitch = pitchTrail.find((e) => e.id === selectedPitchId) ?? pitchTrail[pitchTrail.length - 1] ?? null
  const pitchMeta = [
    selectedPitch?.result,
    selectedPitch?.pitchType,
    selectedPitch?.velocity ? `${Math.round(selectedPitch.velocity)} MPH` : null,
  ].filter(Boolean).join(' • ')

  return (
    <div className="detail-card strikezone-card scorecast-zone-card">
      <div className="scorecast-zone-shell scorecast-zone-shell--minimal">
        <div className="strikezone strikezone--minimal">
          <div className="strikezone__box" />
          <div className="strikezone__grid" />
          {pitchTrail.map((event, index) => {
            if (event.x === undefined || event.z === undefined) return null
            const left = `${Math.max(8, Math.min(92, 50 + event.x * 18))}%`
            const top = `${Math.max(8, Math.min(92, 82 - event.z * 18))}%`
            const isLatest = index === pitchTrail.length - 1
            const isSelected = event.id === selectedPitchId
            return (
              <button
                className={`strikezone__marker${isLatest ? ' strikezone__marker--latest' : ''}${isSelected ? ' strikezone__marker--selected' : ''}`}
                key={event.id}
                onClick={() => onSelectPitch?.(event.id)}
                style={{ left, top }}
                type="button"
              >
                {event.number}
              </button>
            )
          })}
        </div>
      </div>
      {pitchMeta ? <p className="strikezone__meta">{pitchMeta}</p> : null}
    </div>
  )
}

interface CountDotsProps {
  active: number | null | undefined
  total?: number
  label: string
  tone?: 'accent' | 'green' | 'red'
}

function CountDots({ active, total = 3, label, tone = 'accent' }: CountDotsProps) {
  if (active === null || active === undefined) return null
  return (
    <div className="count-group">
      <span>{label}</span>
      <div className="count-group__dots">
        {Array.from({ length: total }).map((_, index) => (
          <i
            className={`count-dot${index < active ? ` count-dot--${tone}` : ''}`}
            key={`${label}-${index}`}
          />
        ))}
      </div>
    </div>
  )
}

interface PitchHistoryRowProps {
  history: PitchEvent[] | null | undefined
  onSelectPitch?: (id: string) => void
  selectedPitchId: string | null
}

function PitchHistoryRow({ history, onSelectPitch, selectedPitchId }: PitchHistoryRowProps) {
  if (!history || history.length === 0) return null
  return (
    <div className="pitch-history-row">
      {history.slice().reverse().map((pitch, index) => (
        <button
          className={`pitch-history-card${index === 0 ? ' pitch-history-card--latest' : ''}${pitch.id === selectedPitchId ? ' pitch-history-card--selected' : ''}`}
          key={pitch.id}
          onClick={() => onSelectPitch?.(pitch.id)}
          type="button"
        >
          {pitch.number ? <strong>{pitch.number}</strong> : null}
          {pitch.result ? <span>{pitch.result}</span> : null}
          {pitch.pitchType ? <p>{pitch.pitchType.toUpperCase()}</p> : null}
          {pitch.velocity ? <small>{Math.round(pitch.velocity)} MPH</small> : null}
        </button>
      ))}
    </div>
  )
}

interface ScoreboardHeaderProps {
  awayTeam: MlbTeam | null
  homeTeam: MlbTeam | null
  liveContext: LiveContext
  selectedCard: ScoreCard | null | undefined
}

function ScoreboardHeader({ awayTeam, homeTeam, liveContext, selectedCard }: ScoreboardHeaderProps) {
  const inningSummary = [liveContext.inningState, liveContext.outsSummary].filter(Boolean).join(', ')
  return (
    <div className="detail-card live-scoreboard-header">
      <div className="live-scoreboard-header__team">
        <AssetImage alt={`${awayTeam?.name || selectedCard?.awayAbbreviation} logo`} className="live-scoreboard-header__logo" src={buildTeamLogoUrl(awayTeam?.id)} />
        <span>{selectedCard?.awayAbbreviation}</span>
      </div>
      <strong className="live-scoreboard-header__score">{selectedCard?.awayScore ?? 0}</strong>
      <div className="live-scoreboard-header__center">
        {inningSummary ? <p>{inningSummary}</p> : null}
        <MiniBaseballDiamond baseState={liveContext.rawBaseState} />
      </div>
      <strong className="live-scoreboard-header__score">{selectedCard?.homeScore ?? 0}</strong>
      <div className="live-scoreboard-header__team">
        <AssetImage alt={`${homeTeam?.name || selectedCard?.homeAbbreviation} logo`} className="live-scoreboard-header__logo" src={buildTeamLogoUrl(homeTeam?.id)} />
        <span>{selectedCard?.homeAbbreviation}</span>
      </div>
    </div>
  )
}

interface SelectedGameScorebugProps {
  awayTeam: MlbTeam | null
  homeTeam: MlbTeam | null
  selectedCard: ScoreCard | null | undefined
  statusBucket: StatusBucket
  statusText: string | null
}

function SelectedGameScorebug({ awayTeam, homeTeam, selectedCard, statusBucket, statusText }: SelectedGameScorebugProps) {
  const awayRecord = formatRecord(awayTeam?.record)
  const homeRecord = formatRecord(homeTeam?.record)
  const centerLabel =
    statusBucket === 'final'
      ? 'Final'
      : statusBucket === 'scheduled'
        ? formatTime(selectedCard?.gameDate) || statusText
        : selectedCard?.count && selectedCard?.inningState
          ? `${selectedCard.inningState} • ${selectedCard.count}`
          : selectedCard?.inningState || statusText

  return (
    <div className="selected-game-scorebug">
      <div className="selected-game-scorebug__team">
        <AssetImage
          alt={`${awayTeam?.name || selectedCard?.awayAbbreviation} logo`}
          className="selected-game-scorebug__logo"
          src={buildTeamLogoUrl(awayTeam?.id)}
        />
        <span>{selectedCard?.awayAbbreviation}</span>
        {awayRecord ? <small className="text-[rgb(196, 30, 58)]">{awayRecord}</small> : null}
      </div>
      <strong className="selected-game-scorebug__score">{selectedCard?.awayScore ?? '-'}</strong>
      <div className="selected-game-scorebug__center">
        {centerLabel ? <p>{centerLabel}</p> : null}
        {statusBucket === 'final' ? (
          <span className="selected-game-scorebug__final">Final</span>
        ) : selectedCard?.baseState ? (
          <MiniBaseballDiamond baseState={selectedCard.baseState} />
        ) : null}
      </div>
      <strong className="selected-game-scorebug__score">{selectedCard?.homeScore ?? '-'}</strong>
      <div className="selected-game-scorebug__team">
        <AssetImage
          alt={`${homeTeam?.name || selectedCard?.homeAbbreviation} logo`}
          className="selected-game-scorebug__logo"
          src={buildTeamLogoUrl(homeTeam?.id)}
        />
        <span>{selectedCard?.homeAbbreviation}</span>
        {homeRecord ? <small className="text-[rgb(196, 30, 58)]">{homeRecord}</small> : null}
      </div>
    </div>
  )
}

interface MatchupCardProps {
  awayTeam: MlbTeam | null
  homeTeam: MlbTeam | null
  liveContext: LiveContext
}

function MatchupCard({ liveContext }: MatchupCardProps) {
  const pitcherLine = liveContext.pitcherStats.map((entry) => `${entry.value} ${entry.label}`).join(', ')
  const batterLine = [
    liveContext.batterLine,
    liveContext.batterStats.map((entry) => `${entry.value} ${entry.label}`).slice(0, 4).join(', '),
  ].filter(Boolean).join(' • ')

  return (
    <div className="detail-card matchup-card">
      <div className="matchup-card__side">
        <span className="section-label">Pitcher</span>
        <div className="matchup-card__person">
          <AssetImage alt={liveContext.pitcherName || 'Pitcher headshot'} className="person-headshot" src={liveContext.pitcherHeadshot} />
          <div>
            {liveContext.pitcherName ? <h3>{abbreviateName(liveContext.pitcherName)}</h3> : null}
            {liveContext.pitcherThrows ? <p>{liveContext.pitcherThrows}HP</p> : null}
            {pitcherLine ? <small>{pitcherLine}</small> : null}
          </div>
        </div>
      </div>
      <div className="matchup-card__vs">VS</div>
      <div className="matchup-card__side matchup-card__side--right">
        <span className="section-label">Batter</span>
        <div className="matchup-card__person matchup-card__person--right">
          <div>
            {liveContext.batterName ? <h3>{abbreviateName(liveContext.batterName)}</h3> : null}
            {liveContext.batterSide ? <p>{liveContext.batterSide}HB</p> : null}
            {batterLine ? <small>{batterLine}</small> : null}
          </div>
          <AssetImage alt={liveContext.batterName || 'Batter headshot'} className="person-headshot" src={liveContext.batterHeadshot} />
        </div>
      </div>
      {liveContext.pitcherCount || liveContext.onDeck ? (
        <div className="matchup-card__meta">
          {liveContext.pitcherCount ? <span>Pitch Count: {liveContext.pitcherCount}</span> : null}
          {liveContext.onDeck ? <span>On Deck: {liveContext.onDeck}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

interface LiveViewProps {
  awayTeam: MlbTeam | null
  homeTeam: MlbTeam | null
  liveContext: LiveContext
  boxScoreContext: BoxScoreContext | null
  selectedCard: ScoreCard | null | undefined
}

function LiveView({ awayTeam, homeTeam, liveContext, boxScoreContext, selectedCard }: LiveViewProps) {
  const [selectedPitchId, setSelectedPitchId] = useState<string | null>(
    liveContext.pitchHistory[liveContext.pitchHistory.length - 1]?.id ?? null
  )
  const selectedPitch =
    liveContext.pitchHistory.find((p) => p.id === selectedPitchId) ??
    liveContext.pitchHistory[liveContext.pitchHistory.length - 1] ??
    null
  const pitchBannerMeta = [
    liveContext.latestPitchType,
    liveContext.latestPitchVelocity ? `${Math.round(liveContext.latestPitchVelocity)} MPH` : null,
  ].filter(Boolean).join(' • ')

  useEffect(() => {
    setSelectedPitchId(liveContext.pitchHistory[liveContext.pitchHistory.length - 1]?.id ?? null)
  }, [liveContext.pitchHistory])

  return (
    <section className="detail-section">
      <div className="live-scorecast-card">
        <ScoreboardHeader awayTeam={awayTeam} homeTeam={homeTeam} liveContext={liveContext} selectedCard={selectedCard} />
        <MatchupCard awayTeam={awayTeam} homeTeam={homeTeam} liveContext={liveContext} />

        <div className="live-scorecast-field">
          <div className="detail-card live-center-card">
            <div className="count-row count-row--scorecast">
              <CountDots active={liveContext.balls} label="Balls" tone="green" total={4} />
              <CountDots active={liveContext.strikes} label="Strikes" tone="red" total={3} />
              <CountDots active={liveContext.outs} label="Outs" tone="red" total={3} />
            </div>
            <div className="live-center-card__body">
              {liveContext.pitchLocation || liveContext.pitchHistory.length > 0 ? (
                <PitchLocationZone
                  history={liveContext.pitchHistory}
                  onSelectPitch={setSelectedPitchId}
                  selectedPitchId={selectedPitchId}
                />
              ) : null}
            </div>
          </div>
        </div>

        {selectedPitch?.result || selectedPitch?.pitchType || selectedPitch?.velocity || liveContext.latestPitchLabel || pitchBannerMeta ? (
          <div className="live-pitch-banner">
            {selectedPitch?.result || liveContext.latestPitchLabel ? <strong>{selectedPitch?.result || liveContext.latestPitchLabel}</strong> : null}
            {selectedPitch?.pitchType || selectedPitch?.velocity ? (
              <span>
                {[selectedPitch?.pitchType, selectedPitch?.velocity ? `${Math.round(selectedPitch.velocity)} MPH` : null].filter(Boolean).join(' • ')}
              </span>
            ) : pitchBannerMeta ? <span>{pitchBannerMeta}</span> : null}
          </div>
        ) : null}

        {liveContext.lastEvent ? (
          <div className="detail-card live-last-play">
            <p className="section-label">Last play</p>
            <p>{liveContext.lastEvent}</p>
          </div>
        ) : null}

        <PitchHistoryRow history={liveContext.pitchHistory} onSelectPitch={setSelectedPitchId} selectedPitchId={selectedPitchId} />

        <div className="detail-card live-line-score-card">
          <p className="section-label">Live box score</p>
          <BoxScoreTable innings={boxScoreContext?.innings} />
        </div>
      </div>
    </section>
  )
}

interface BoxScoreViewProps {
  boxScoreContext: BoxScoreContext
  title?: string
}

function BoxScoreView({ boxScoreContext, title = 'Box score' }: BoxScoreViewProps) {
  const [activeTeamKey, setActiveTeamKey] = useState(boxScoreContext?.teams?.[0]?.key ?? 'away')
  const activeTeam =
    boxScoreContext?.teams?.find((team) => team.key === activeTeamKey) ??
    boxScoreContext?.teams?.[0] ??
    null

  useEffect(() => {
    setActiveTeamKey(boxScoreContext?.teams?.[0]?.key ?? 'away')
  }, [boxScoreContext?.teams?.[0]?.key, boxScoreContext?.teams?.[1]?.key])

  return (
    <section className="detail-section">
      <div className="detail-card">
        <p className="section-label">{title}</p>
        <BoxScoreTable innings={boxScoreContext.innings} />
        {boxScoreContext.decisions.length > 0 ? <p className="boxscore-decisions">{boxScoreContext.decisions.join(' · ')}</p> : null}
      </div>
      <TeamToggle activeTeamKey={activeTeamKey} onChange={setActiveTeamKey} teams={boxScoreContext.teams} />
      <BatterLineTables tables={activeTeam?.battingTable ? [activeTeam.battingTable] : []} />
      <PitcherLineTables tables={activeTeam?.pitchingTable ? [activeTeam.pitchingTable] : []} />
    </section>
  )
}

interface ScheduledViewProps {
  scheduledContext: ScheduledContext
  selectedCard: ScoreCard | null | undefined
}

function ScheduledView({ scheduledContext, selectedCard }: ScheduledViewProps) {
  const previewItems = [
    { label: 'First pitch', value: formatTime(selectedCard?.gameDate) },
    ...(scheduledContext.previewItems ?? []),
  ].filter((item): item is { label: string; value: string } => item.value !== null && item.value !== undefined)

  return (
    <section className="detail-section">
      <div className="detail-card">
        <p className="section-label">Matchup preview</p>
        <div className="detail-pill-grid">
          {previewItems.map((item) => (
            <div className="detail-pill" key={`${item.label}-${item.value}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ScoreBox has a compatible subset of ScoreCard fields; accept both
export type SelectedCardLike = ScoreCard | import('../types').ScoreBox | null | undefined

export interface SelectedGamePanelProps {
  gameFeed: MlbFeedPayload | null
  loading: boolean
  selectedCard: SelectedCardLike
  scoreError: string
  today: string
}

export function SelectedGamePanel({ gameFeed, loading, selectedCard, scoreError: _scoreError }: SelectedGamePanelProps) {
  // Cast to ScoreCard for internal use — ScoreBox has compatible fields
  const card = selectedCard as ScoreCard | null | undefined
  const statusText: string | null = gameFeed?.gameData?.status?.detailedState ?? card?.status ?? null
  const statusCode: string | null = gameFeed?.gameData?.status?.abstractGameCode ?? card?.statusCode ?? null
  const statusBucket = getStatusBucket(statusCode, statusText)
  const awayTeam: MlbTeam | null = gameFeed?.gameData?.teams?.away ?? null
  const homeTeam: MlbTeam | null = gameFeed?.gameData?.teams?.home ?? null

  const [activeTab, setActiveTab] = useState('feed')

  const liveContext = statusBucket === 'live' ? buildLiveContext(gameFeed) : null
  const boxScoreContext = statusBucket !== 'scheduled' && gameFeed ? buildBoxScoreContext(gameFeed, card) : null
  const scheduledContext = statusBucket === 'scheduled' ? buildScheduledContext(gameFeed) : null

  const tabs = useMemo<Tab[]>(() => {
    if (statusBucket === 'live') {
      return [
        { id: 'feed', label: 'Live feed' },
        { id: 'boxscore', label: 'Box score' },
        ...(boxScoreContext?.scoringEvents?.length ? [{ id: 'summary', label: 'Scoring summary' }] : []),
      ]
    }
    if (statusBucket === 'final') {
      return [
        { id: 'boxscore', label: 'Box score' },
        ...(boxScoreContext?.scoringEvents?.length ? [{ id: 'summary', label: 'Scoring summary' }] : []),
      ]
    }
    return []
  }, [boxScoreContext?.scoringEvents?.length, statusBucket])

  useEffect(() => {
    if (statusBucket === 'live') { setActiveTab('feed'); return }
    if (statusBucket === 'final') { setActiveTab('boxscore'); return }
    setActiveTab('feed')
  }, [card?.gamePk, statusBucket])

  return (
    <section className="score-box hero-score-box">
      <SelectedGameScorebug
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        selectedCard={card}
        statusBucket={statusBucket}
        statusText={statusText}
      />

      {!loading ? <DetailTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} /> : null}

      {loading ? <div className="detail-card"><p>Loading game detail...</p></div> : null}
      {!loading && statusBucket === 'final' && activeTab === 'boxscore' && boxScoreContext ? <BoxScoreView boxScoreContext={boxScoreContext} title="Final box score" /> : null}
      {!loading && statusBucket === 'final' && activeTab === 'summary' ? (
        <ScoringSummary
          awayAbbreviation={boxScoreContext?.innings?.rows?.[0]?.team}
          events={boxScoreContext?.scoringEvents}
          homeAbbreviation={boxScoreContext?.innings?.rows?.[1]?.team}
        />
      ) : null}
      {!loading && statusBucket === 'live' && activeTab === 'feed' && liveContext ? (
        <LiveView
          awayTeam={awayTeam}
          boxScoreContext={boxScoreContext}
          homeTeam={homeTeam}
          liveContext={liveContext}
          selectedCard={card}
        />
      ) : null}
      {!loading && statusBucket === 'live' && activeTab === 'boxscore' && boxScoreContext ? <BoxScoreView boxScoreContext={boxScoreContext} title="Current box score" /> : null}
      {!loading && statusBucket === 'live' && activeTab === 'summary' ? (
        <ScoringSummary
          awayAbbreviation={boxScoreContext?.innings?.rows?.[0]?.team}
          events={boxScoreContext?.scoringEvents}
          homeAbbreviation={boxScoreContext?.innings?.rows?.[1]?.team}
        />
      ) : null}
      {!loading && statusBucket === 'scheduled' && scheduledContext ? <ScheduledView scheduledContext={scheduledContext} selectedCard={card} /> : null}
    </section>
  )
}
