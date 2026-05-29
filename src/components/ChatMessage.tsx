import type { ChatMessage as ChatMessageType } from '../types'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  return (
    <article className={`message-card ${message.role}`}>
      <div className="message-meta">
        <span className="message-tag">{message.tag}</span>
        <span className="message-title">{message.title}</span>
      </div>
      <p>{message.body}</p>
    </article>
  )
}
