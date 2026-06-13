import { useEffect, useRef } from 'react'
import type { ChatMessage as ChatMessageType } from '../types'
import { ChatMessage } from './ChatMessage'

interface ChatWindowProps {
  messages: ChatMessageType[]
  loading?: boolean
}

export function ChatWindow({ messages, loading = false }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  // Typewriter only the final assistant message, and only once it has arrived
  // (i.e. we're no longer waiting on the request).
  const lastIndex = messages.length - 1
  const lastIsAssistant = messages[lastIndex]?.role === 'assistant'

  return (
    <section className="chat-stream">
      {messages.map((message, index) => (
        <ChatMessage
          key={index}
          message={message}
          animate={!loading && lastIsAssistant && index === lastIndex}
          onReveal={scrollToBottom}
        />
      ))}
      {loading && (
        <article className="message-card assistant message-card--loading">
          <div className="message-meta">
            <span className="message-avatar" aria-hidden="true">⚾</span>
            <span className="message-tag">BattersBetter</span>
          </div>
          <span className="type-caret" aria-hidden="true" />
        </article>
      )}
      <div ref={bottomRef} />
    </section>
  )
}
