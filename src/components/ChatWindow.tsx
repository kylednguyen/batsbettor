import { useEffect, useRef } from 'react'
import type { ChatMessage as ChatMessageType } from '../types'
import { ChatMessage } from './ChatMessage'

interface ChatWindowProps {
  messages: ChatMessageType[]
  loading?: boolean
}

export function ChatWindow({ messages, loading = false }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  return (
    <section className="chat-stream">
      {messages.map((message, index) => (
        <ChatMessage key={index} message={message} />
      ))}
      {loading && (
        <article className="message-card assistant message-card--loading">
          <div className="message-meta">
            <span className="message-tag">BattersBetter</span>
          </div>
          <div className="typing-indicator">
            <span /><span /><span />
          </div>
        </article>
      )}
      <div ref={bottomRef} />
    </section>
  )
}
