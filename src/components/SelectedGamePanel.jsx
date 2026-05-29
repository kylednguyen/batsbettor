import { useEffect, useMemo, useState } from 'react'

import { BaseballDiamond, MiniBaseballDiamond } from './BaseballDiamond'

const PITCH_CODE_LABELS = {
  B: 'Ball',
  C: 'Called Strike',
  F: 'Foul',
  S: 'Swinging Strike',
  X: 'In Play',
}

function formatTime(value) {
  if (!value) return null
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatName(person) {
  return person?.fullName || null
}

function formatRecord(record) {
  const wins = record?.wins
  const losses = record?.losses
  if (wins === null || wins === undefined || losses === null || losses === undefined) return null
  return `${wins}-${losses}`
}

function formatStatLine(stats) {
  if (!stats) return null
  const hits = stats.hits
  const atBats = stats.atBats
  if (hits === undefined || hits === null || atBats === undefined || atBats === null) return null

  const suffixes = [
    stats.homeRuns > 0 ? `${stats.homeRuns} HR` : null,
    stats.rbi > 0 ? `${stats.rbi} RBI` : null,
    stats.baseOnBalls > 0 ? `${stats.baseOnBalls} BB` : null,
  ].filter(Boolean)

  return [`${hits}-${atBats}`, ...suffixes].join(' • ')
}

function formatArrowInning(halfInning, inningOrdinal) {
  if (!halfInning || !inningOrdinal) return null
  const arrow = String(halfInning).toLowerCase().includes('top') ? '↑' : '↓'
  return `${arrow} ${inningOrdinal}`
}

function formatOrdinals(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  if (numeric % 100 >= 11 && numeric % 100 <= 13) return `${numeric}th`
  if (numeric % 10 === 1) return `${numeric}st`
  if (numeric % 10 === 2) return `${numeric}nd`
  if (numeric % 10 === 3) return `${numeric}rd`
  return `${numeric}th`
}

function abbreviateName(value) {
  if (!value) return null
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const first = parts[0]
  const last = parts[parts.length - 1]
  return `${first[0]}. ${last}`
}

function buildHeadshotUrl(personId) {
  if (!personId) return null
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/${personId}/headshot/67/current`
}

function buildTeamLogoUrl(teamId) {
  if (!teamId) return null
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`
}

function uniqueValues(values) {
  return [...new Set((values ?? []).filter(Boolean))]
}

function pickStatEntries(statMap, labels) {
  return labels
    .map(([label, key]) => {
      const value = statMap?.[key]
      if (value === null || value === undefined || value === '' || value === '.---' || value === '-.--') {
        return null
      }
      return { label, value }
    })
    .filter(Boolean)
}

function findPlayer(feed, playerId) {
  const awayPlayers = feed?.liveData?.boxscore?.teams?.away?.players ?? {}
  const homePlayers = feed?.liveData?.boxscore?.teams?.home?.players ?? {}
  return awayPlayers[`ID${playerId}`] ?? homePlayers[`ID${playerId}`] ?? null
}

function getStatusBucket(statusCode, statusText) {
  if (statusCode === 'F' || /final|completed/i.test(statusText || '')) return 'final'
  if (statusCode === 'L' || /in progress|live/i.test(statusText || '')) return 'live'
  if (statusCode === 'P' || /scheduled|pre-game|pregame/i.test(statusText || '')) return 'scheduled'
  return 'other'
}

function normalizePitchResult(event) {
  const detailText = event?.details?.description || PITCH_CODE_LABELS[event?.details?.code] || event?.result || null
  if (!detailText) return null
  return String(detailText).toUpperCase()
}

function buildInningRows(linescore, awayAbbreviation, homeAbbreviation) {
  const innings = linescore?.innings ?? []
  if (innings.length === 0) return null

  const inningLabels = innings.map((inning) => inning.ordinalNum || inning.num)
  const awayRuns = innings.map((inning) => inning.away?.runs ?? '')
  const homeRuns = innings.map((inning) => inning.home?.runs ?? '')
  const totals = linescore?.teams ?? {}

  return {
    inningLabels,
    rows: [
      {
        team: awayAbbreviation,
        inningRuns: awayRuns,
        totals: totals.away ?? {},
      },
      {
        team: homeAbbreviation,
        inningRuns: homeRuns,
        totals: totals.home ?? {},
      },
    ],
  }
}

function buildLiveContext(feed) {
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
  ].filter(Boolean)

  const pitchEvents = (currentPlay?.playEvents ?? []).filter((event) => event?.isPitch)
  const pitchHistory = pitchEvents
    .slice(-6)
    .map((event) => ({
      id: event?.playId ?? `${event?.pitchNumber ?? Math.random()}`,
      number: event?.pitchNumber ?? null,
      result: normalizePitchResult(event),
      pitchType: event?.details?.type?.description ?? event?.details?.type ?? null,
      velocity: event?.pitchData?.startSpeed ?? null,
      x: event?.pitchData?.coordinates?.pX,
      z: event?.pitchData?.coordinates?.pZ,
    }))
    .filter((event) => event.result || event.pitchType || event.velocity || (event.x !== undefined && event.z !== undefined))

  const lastEvent =
    currentPlay?.result?.description ||
    currentPlay?.playEvents?.slice(-1)?.[0]?.details?.description ||
    currentPlay?.result?.event ||
    null

  const latestPitch = [...(currentPlay?.playEvents ?? [])]
    .reverse()
    .find((event) => event?.isPitch && event?.pitchData?.coordinates?.pX !== undefined && event?.pitchData?.coordinates?.pZ !== undefined)

  const latestTaggedPitch = [...(currentPlay?.playEvents ?? [])]
    .reverse()
    .find((event) => event?.isPitch)

  const pitcherCount = pitcherPlayer?.stats?.pitching?.numberOfPitches ?? null
  const batterLine = formatStatLine(batterPlayer?.stats?.batting)
  const pitcherEra = pitcherPlayer?.seasonStats?.pitching?.era ?? pitcherPlayer?.stats?.pitching?.era ?? null
  const onDeck = offense?.onDeck?.fullName ?? null
  const outLabel =
    linescore?.outs !== undefined && linescore?.outs !== null
      ? `${formatOrdinals(linescore.outs + 1)?.replace('1st', '1 out').replace('2nd', '2 outs').replace('3rd', '3 outs')}`
      : null

  return {
    inningState:
      linescore?.inningHalf && linescore?.currentInningOrdinal
        ? formatArrowInning(linescore.inningHalf, linescore.currentInningOrdinal)
        : null,
    countEntries: pickStatEntries(
      {
        balls: linescore?.balls,
        strikes: linescore?.strikes,
        outs: linescore?.outs,
      },
      [
        ['Balls', 'balls'],
        ['Strikes', 'strikes'],
        ['Outs', 'outs'],
      ]
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
            pitchType:
              latestPitch?.details?.type?.description ??
              latestPitch?.details?.type ??
              null,
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

function buildBatterTable(teamBoxscore, abbreviation) {
  if (!teamBoxscore) return null

  const lineupIds = teamBoxscore.batters ?? []
  const playerMap = teamBoxscore.players ?? {}
  const seenPlayers = new Set()
  const seenSlots = new Set()

  const rows = lineupIds
    .filter((playerId) => {
      if (seenPlayers.has(playerId)) return false
      seenPlayers.add(playerId)
      return true
    })
    .map((playerId) => playerMap[`ID${playerId}`])
    .filter(Boolean)
    .map((player) => {
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

      const hasStats = Object.values(values).some((value) => value !== null && value !== undefined && value !== '' && value !== '.---')
      if (!hasStats) return null

      const isSubstitute =
        Boolean(player?.gameStatus?.isSubstitute) ||
        (orderSlot !== null && seenSlots.has(orderSlot))

      if (orderSlot !== null) {
        seenSlots.add(orderSlot)
      }

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
    .filter(Boolean)

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

function buildPitcherTable(teamBoxscore, abbreviation) {
  if (!teamBoxscore) return null

  const pitcherIds = uniqueValues(teamBoxscore.pitchers)
  const playerMap = teamBoxscore.players ?? {}

  const rows = pitcherIds
    .map((playerId) => playerMap[`ID${playerId}`])
    .filter(Boolean)
    .map((player) => {
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

      const hasStats = Object.values(values).some((value) => value !== null && value !== undefined && value !== '' && value !== '.---' && value !== '-.--')
      if (!hasStats) return null

      return {
        id: player?.person?.id ?? `${abbreviation}-${player?.person?.fullName}`,
        name: player?.person?.fullName ?? null,
        hand: player?.pitchHand?.code ?? null,
        values,
      }
    })
    .filter(Boolean)

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

function buildBoxScoreContext(feed, selectedCard) {
  const linescore = feed?.liveData?.linescore
  const away = feed?.liveData?.boxscore?.teams?.away
  const home = feed?.liveData?.boxscore?.teams?.home
  const decisions = feed?.liveData?.decisions
  const allPlays = feed?.liveData?.plays?.allPlays ?? []
  const scoringEvents = allPlays
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
    ].filter(Boolean),
    battingRows: [
      {
        team: selectedCard?.awayAbbreviation,
        stats: pickStatEntries(away?.teamStats?.batting, [
          ['AB', 'atBats'],
          ['H', 'hits'],
          ['R', 'runs'],
          ['RBI', 'rbi'],
          ['BB', 'baseOnBalls'],
          ['SO', 'strikeOuts'],
          ['HR', 'homeRuns'],
        ]),
      },
      {
        team: selectedCard?.homeAbbreviation,
        stats: pickStatEntries(home?.teamStats?.batting, [
          ['AB', 'atBats'],
          ['H', 'hits'],
          ['R', 'runs'],
          ['RBI', 'rbi'],
          ['BB', 'baseOnBalls'],
          ['SO', 'strikeOuts'],
          ['HR', 'homeRuns'],
        ]),
      },
    ],
    pitchingRows: [
      {
        team: selectedCard?.awayAbbreviation,
        stats: pickStatEntries(away?.teamStats?.pitching, [
          ['IP', 'inningsPitched'],
          ['H', 'hits'],
          ['R', 'runs'],
          ['ER', 'earnedRuns'],
          ['BB', 'baseOnBalls'],
          ['SO', 'strikeOuts'],
          ['Pitches', 'numberOfPitches'],
        ]),
      },
      {
        team: selectedCard?.homeAbbreviation,
        stats: pickStatEntries(home?.teamStats?.pitching, [
          ['IP', 'inningsPitched'],
          ['H', 'hits'],
          ['R', 'runs'],
          ['ER', 'earnedRuns'],
          ['BB', 'baseOnBalls'],
          ['SO', 'strikeOuts'],
          ['Pitches', 'numberOfPitches'],
        ]),
      },
    ],
    decisions: [
      decisions?.winner ? `W: ${decisions.winner.fullName}` : null,
      decisions?.loser ? `L: ${decisions.loser.fullName}` : null,
      decisions?.save ? `SV: ${decisions.save.fullName}` : null,
    ].filter(Boolean),
    scoringEvents,
  }
}

function buildScheduledContext(feed) {
  const gameData = feed?.gameData ?? {}
  const probablePitchers = gameData?.probablePitchers ?? {}
  const venue = gameData?.venue?.name ?? null
  const previewItems = [
    venue ? { label: 'Venue', value: venue } : null,
    probablePitchers?.away?.fullName ? { label: 'Away probable', value: probablePitchers.away.fullName } : null,
    probablePitchers?.home?.fullName ? { label: 'Home probable', value: probablePitchers.home.fullName } : null,
  ].filter(Boolean)

  return { previewItems }
}

function AssetImage({ alt, className, src }) {
  return src ? <img alt={alt} className={className} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} src={src} /> : null
}

function TeamBadge({ abbreviation, logoUrl, teamName }) {
  return (
    <div className="team-badge">
      <AssetImage alt={`${teamName} logo`} className="team-badge__logo" src={logoUrl} />
      <span>{abbreviation}</span>
    </div>
  )
}

function StatPills({ entries }) {
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

function BoxScoreTable({ innings }) {
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
        <div className="boxscore-row" key={row.team} style={{ gridTemplateColumns }}>
          <span>{row.team}</span>
          {row.inningRuns.map((value, index) => (
            <span key={`${row.team}-${index}`}>{value}</span>
          ))}
          <strong>{row.totals.runs ?? ''}</strong>
          <strong>{row.totals.hits ?? ''}</strong>
          <strong>{row.totals.errors ?? ''}</strong>
        </div>
      ))}
    </div>
  )
}

function formatTableValue(value) {
  if (value === null || value === undefined || value === '' || value === '.---') return ''
  return value
}

function TeamStatRows({ title, rows }) {
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

function BatterLineTables({ tables }) {
  if (!tables || tables.length === 0) return null

  return (
    <section className="detail-section">
      <p className="section-label">Batters</p>
      <div className="batter-table-grid">
        {tables.map((table) => (
          <article className="detail-card batter-table-card" key={table.team}>
            <div className="batter-table-card__header">
              <h3>{table.team}</h3>
              <span>Box score</span>
            </div>

            <div className="batter-table">
              <div className="batter-table__row batter-table__row--header">
                <span>Player</span>
                <span>AB</span>
                <span>H</span>
                <span>R</span>
                <span>RBI</span>
                <span>BB</span>
                <span>SO</span>
                <span>HR</span>
                <span>AVG</span>
              </div>

              {table.rows.map((row) => (
                <div className={`batter-table__row${row.isSubstitute ? ' batter-table__row--substitute' : ''}`} key={row.id}>
                  <div className="batter-table__player">
                    <strong>
                      <span>{row.name}</span>
                    </strong>
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
                <div className="batter-table__player">
                  <strong>Totals</strong>
                </div>
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

function PitcherLineTables({ tables }) {
  if (!tables || tables.length === 0) return null

  return (
    <section className="detail-section">
      <p className="section-label">Pitchers</p>
      <div className="pitcher-table-grid">
        {tables.map((table) => (
          <article className="detail-card batter-table-card" key={table.team}>
            <div className="batter-table-card__header">
              <h3>{table.team}</h3>
              <span>Box score</span>
            </div>

            <div className="batter-table pitcher-table">
              <div className="batter-table__row batter-table__row--header pitcher-table__row">
                <span>Pitcher</span>
                <span>IP</span>
                <span>H</span>
                <span>R</span>
                <span>ER</span>
                <span>K</span>
                <span>BB</span>
                <span>HR</span>
                <span>ERA</span>
                <span>WHIP</span>
              </div>

              {table.rows.map((row) => (
                <div className="batter-table__row pitcher-table__row" key={row.id}>
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
                <div className="batter-table__player">
                  <strong>Totals</strong>
                </div>
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

function TeamToggle({ activeTeamKey, teams, onChange }) {
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

function ScoringSummary({ events, awayAbbreviation, homeAbbreviation }) {
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

function DetailTabs({ activeTab, onChange, tabs }) {
  if (!tabs || tabs.length < 2) return null
  return (
    <div
      className="mt-4 border-t border-white/8 pt-3"
      role="tablist"
      aria-label="Selected game views"
    >
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

function PitchLocationZone({ history = [], onSelectPitch, selectedPitchId }) {
  if (!history || history.length === 0) return null
  const pitchTrail = history ?? []
  const selectedPitch = pitchTrail.find((event) => event.id === selectedPitchId) ?? pitchTrail[pitchTrail.length - 1] ?? null
  const pitchMeta = [
    selectedPitch?.result,
    selectedPitch?.pitchType,
    selectedPitch?.velocity ? `${Math.round(selectedPitch.velocity)} MPH` : null,
  ]
    .filter(Boolean)
    .join(' • ')

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

function CountDots({ active, total = 3, label, tone = 'accent' }) {
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

function PitchHistoryRow({ history, onSelectPitch, selectedPitchId }) {
  if (!history || history.length === 0) return null
  return (
    <div className="pitch-history-row">
      {history
        .slice()
        .reverse()
        .map((pitch, index) => (
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

function ScoreboardHeader({ awayTeam, homeTeam, liveContext, selectedCard }) {
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

function SelectedGameScorebug({ awayTeam, homeTeam, selectedCard, statusBucket, statusText }) {
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

function MatchupCard({ awayTeam, homeTeam, liveContext }) {
  const pitcherLine = liveContext.pitcherStats
    .map((entry) => `${entry.value} ${entry.label}`)
    .join(', ')
  const batterLine = [liveContext.batterLine, liveContext.batterStats.map((entry) => `${entry.value} ${entry.label}`).slice(0, 4).join(', ')]
    .filter(Boolean)
    .join(' • ')

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

function LiveView({ awayTeam, boxScoreContext, homeTeam, liveContext, selectedCard }) {
  const [selectedPitchId, setSelectedPitchId] = useState(liveContext.pitchHistory[liveContext.pitchHistory.length - 1]?.id ?? null)
  const selectedPitch =
    liveContext.pitchHistory.find((pitch) => pitch.id === selectedPitchId) ??
    liveContext.pitchHistory[liveContext.pitchHistory.length - 1] ??
    null
  const pitchBannerMeta = [liveContext.latestPitchType, liveContext.latestPitchVelocity ? `${Math.round(liveContext.latestPitchVelocity)} MPH` : null]
    .filter(Boolean)
    .join(' • ')

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

function BoxScoreView({ boxScoreContext, title = 'Box score' }) {
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

function ScheduledView({ scheduledContext, selectedCard }) {
  const previewItems = [
    { label: 'First pitch', value: formatTime(selectedCard?.gameDate) },
    ...(scheduledContext.previewItems ?? []),
  ].filter((item) => item.value)

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

export function SelectedGamePanel({ gameFeed, loading, selectedCard, scoreError, today }) {
  const statusText = gameFeed?.gameData?.status?.detailedState ?? selectedCard?.status ?? null
  const statusCode = gameFeed?.gameData?.status?.abstractGameCode ?? selectedCard?.statusCode ?? null
  const statusBucket = getStatusBucket(statusCode, statusText)
  const awayTeam = gameFeed?.gameData?.teams?.away ?? null
  const homeTeam = gameFeed?.gameData?.teams?.home ?? null

  const [activeTab, setActiveTab] = useState('feed')

  const liveContext = statusBucket === 'live' ? buildLiveContext(gameFeed) : null
  const boxScoreContext = statusBucket !== 'scheduled' && gameFeed ? buildBoxScoreContext(gameFeed, selectedCard) : null
  const scheduledContext = statusBucket === 'scheduled' ? buildScheduledContext(gameFeed) : null

  const tabs = useMemo(() => {
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
    if (statusBucket === 'live') {
      setActiveTab('feed')
      return
    }
    if (statusBucket === 'final') {
      setActiveTab('boxscore')
      return
    }
    setActiveTab('feed')
  }, [selectedCard?.gamePk, statusBucket])

  return (
    <section className="score-box hero-score-box">
      <SelectedGameScorebug
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        selectedCard={selectedCard}
        statusBucket={statusBucket}
        statusText={statusText}
      />

      {!loading ? <DetailTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} /> : null}

      {loading ? <div className="detail-card"><p>Loading game detail...</p></div> : null}
      {!loading && statusBucket === 'final' && activeTab === 'boxscore' ? <BoxScoreView boxScoreContext={boxScoreContext} title="Final box score" /> : null}
      {!loading && statusBucket === 'final' && activeTab === 'summary' ? (
        <ScoringSummary
          awayAbbreviation={boxScoreContext?.innings?.rows?.[0]?.team}
          events={boxScoreContext?.scoringEvents}
          homeAbbreviation={boxScoreContext?.innings?.rows?.[1]?.team}
        />
      ) : null}
      {!loading && statusBucket === 'live' && activeTab === 'feed' ? (
        <LiveView
          awayTeam={awayTeam}
          boxScoreContext={boxScoreContext}
          homeTeam={homeTeam}
          liveContext={liveContext}
          selectedCard={selectedCard}
        />
      ) : null}
      {!loading && statusBucket === 'live' && activeTab === 'boxscore' ? <BoxScoreView boxScoreContext={boxScoreContext} title="Current box score" /> : null}
      {!loading && statusBucket === 'live' && activeTab === 'summary' ? (
        <ScoringSummary
          awayAbbreviation={boxScoreContext?.innings?.rows?.[0]?.team}
          events={boxScoreContext?.scoringEvents}
          homeAbbreviation={boxScoreContext?.innings?.rows?.[1]?.team}
        />
      ) : null}
      {!loading && statusBucket === 'scheduled' ? <ScheduledView scheduledContext={scheduledContext} selectedCard={selectedCard} /> : null}
    </section>
  )
}
