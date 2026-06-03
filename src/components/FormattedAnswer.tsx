import React from 'react'

// Renders the assistant's reply. The LLM is prompted to answer in a fixed
// structure (Direct answer / Why / Confidence / Missing data); when it does, we
// render each section with its own styling (incl. a colored confidence badge).
// Otherwise we fall back to light markdown (paragraphs, bullets, bold).

const SECTION_LABELS = ['direct answer', 'why', 'confidence', 'missing data']

interface Section {
  label: string // '' for preamble text before the first labeled section
  lines: string[]
}

// Inline **bold** support.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <React.Fragment key={`${keyBase}-${i}`}>{part}</React.Fragment>
  })
}

function parseSections(body: string): Section[] | null {
  const sections: Section[] = []
  let current: Section | null = null
  let matched = 0

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    const m = line.match(/^([A-Za-z][A-Za-z ]+?):\s*(.*)$/)
    const label = m?.[1]?.trim().toLowerCase()

    if (label && SECTION_LABELS.includes(label)) {
      matched += 1
      current = { label, lines: [] }
      sections.push(current)
      if (m?.[2]?.trim()) current.lines.push(m[2].trim())
    } else if (current) {
      current.lines.push(line)
    } else if (line.trim()) {
      current = { label: '', lines: [line] }
      sections.push(current)
    }
  }

  return matched >= 2 ? sections : null
}

function toBullets(lines: string[]): string[] {
  return lines.map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean)
}

// Render free-form text: group bullet lines into <ul>, the rest into <p>.
function RichText({ text, keyBase }: { text: string; keyBase: string }) {
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  let para: string[] = []

  const flushPara = (k: string) => {
    if (para.length) {
      blocks.push(<p key={k}>{renderInline(para.join(' '), k)}</p>)
      para = []
    }
  }
  const flushBullets = (k: string) => {
    if (bullets.length) {
      blocks.push(
        <ul className="ans-list" key={k}>
          {bullets.map((b, i) => (
            <li key={`${k}-${i}`}>{renderInline(b, `${k}-${i}`)}</li>
          ))}
        </ul>
      )
      bullets = []
    }
  }

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (/^[-*•]\s+/.test(line)) {
      flushPara(`${keyBase}-p${i}`)
      bullets.push(line.replace(/^[-*•]\s+/, ''))
    } else if (!line) {
      flushPara(`${keyBase}-p${i}`)
      flushBullets(`${keyBase}-b${i}`)
    } else {
      flushBullets(`${keyBase}-b${i}`)
      para.push(line)
    }
  })
  flushPara(`${keyBase}-pend`)
  flushBullets(`${keyBase}-bend`)

  return <>{blocks}</>
}

function confidenceLevel(value: string): 'high' | 'med' | 'low' {
  const v = value.toLowerCase()
  if (v.includes('high')) return 'high'
  if (v.includes('med')) return 'med'
  return 'low'
}

export function FormattedAnswer({ text }: { text: string }) {
  const sections = parseSections(text)

  if (!sections) {
    return (
      <div className="ans">
        <RichText text={text} keyBase="fb" />
      </div>
    )
  }

  return (
    <div className="ans">
      {sections.map((s, i) => {
        const key = `s${i}`

        if (!s.label) {
          return <RichText text={s.lines.join('\n')} keyBase={key} />
        }

        if (s.label === 'direct answer') {
          return (
            <p className="ans-lead" key={key}>
              {renderInline(s.lines.join(' ').trim(), key)}
            </p>
          )
        }

        if (s.label === 'confidence') {
          const value = s.lines.join(' ').trim() || 'Unknown'
          return (
            <div className="ans-row" key={key}>
              <span className="ans-label">Confidence</span>
              <span className={`ans-badge ans-badge--${confidenceLevel(value)}`}>{value}</span>
            </div>
          )
        }

        if (s.label === 'missing data') {
          const value = s.lines.join(' ').trim()
          if (!value || /^none\b/i.test(value)) {
            return (
              <div className="ans-row" key={key}>
                <span className="ans-label">Missing data</span>
                <span className="ans-badge ans-badge--ok">None</span>
              </div>
            )
          }
          const items = toBullets(s.lines)
          return (
            <div className="ans-section ans-section--warn" key={key}>
              <span className="ans-label ans-label--warn">Missing data</span>
              <ul className="ans-list ans-list--warn">
                {items.map((b, j) => (
                  <li key={`${key}-${j}`}>{renderInline(b, `${key}-${j}`)}</li>
                ))}
              </ul>
            </div>
          )
        }

        // "why" and any other labeled section
        const title = s.label.replace(/\b\w/g, (c) => c.toUpperCase())
        return (
          <div className="ans-section" key={key}>
            <span className="ans-label">{title}</span>
            <RichText text={s.lines.join('\n')} keyBase={key} />
          </div>
        )
      })}
    </div>
  )
}
