import { useEffect, useRef, useState } from 'react'
import type { ChatMessage as ChatMessageType } from '../types'
import { FormattedAnswer } from './FormattedAnswer'

interface ChatMessageProps {
  message: ChatMessageType
  // When true, the assistant body is revealed with a typewriter effect.
  animate?: boolean
  // Notifies the parent on each reveal tick so the view can stay scrolled.
  onReveal?: () => void
}

// Reveals `text` like a typewriter when `enabled`. The revealed length is
// derived from elapsed time (not an incrementing counter), so re-renders,
// StrictMode double-mounts, or background updates can't stall it — each tick
// recomputes from the start timestamp and converges to the full string. We
// drive it with setInterval rather than requestAnimationFrame because rAF is
// paused on hidden documents; setInterval keeps firing (throttled) so the
// reveal still completes. Once a given string finishes (or when disabled) it
// renders in full immediately.
const CHARS_PER_SECOND = 600

function useTypewriter(text: string, enabled: boolean, onTick?: () => void): string {
  const [count, setCount] = useState(enabled ? 0 : text.length)
  const doneFor = useRef<string | null>(enabled ? null : text)

  useEffect(() => {
    if (!enabled || doneFor.current === text) {
      setCount(text.length)
      return
    }
    const start = performance.now()
    const id = window.setInterval(() => {
      const n = Math.min(text.length, Math.floor(((performance.now() - start) / 1000) * CHARS_PER_SECOND))
      setCount(n)
      onTick?.()
      if (n >= text.length) {
        doneFor.current = text
        window.clearInterval(id)
      }
    }, 16)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled])

  return text.slice(0, count)
}

export function ChatMessage({ message, animate = false, onReveal }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const revealed = useTypewriter(message.body, !isUser && animate, onReveal)

  if (isUser) {
    return (
      <article className="message-card user">
        <p className="message-body">{message.body}</p>
      </article>
    )
  }

  const isTyping = animate && revealed.length < message.body.length

  return (
    <article className="message-card assistant">
      <div className="message-meta">
        <span className="message-avatar" aria-hidden="true">⚾</span>
        <span className="message-tag">{message.tag ?? 'BattersBetter'}</span>
        {message.title && <span className="message-title">{message.title}</span>}
      </div>
      <FormattedAnswer text={revealed} />
      {isTyping && <span className="type-caret" aria-hidden="true" />}
    </article>
  )
}
