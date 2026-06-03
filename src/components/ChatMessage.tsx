import type { ChatMessage as ChatMessageType } from '../types'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <article className={`message-card ${message.role}`}>
      {!isUser && (
        <div className="message-meta">
          <span className="message-tag">{message.tag ?? 'BattersBetter'}</span>
          {message.title && <span className="message-title">{message.title}</span>}
        </div>
      )}
      <p className="message-body">{message.body}</p>
    </article>
  )
}
