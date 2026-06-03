import type { ChatMessage as ChatMessageType } from '../types'
import { FormattedAnswer } from './FormattedAnswer'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <article className="message-card user">
        <p className="message-body">{message.body}</p>
      </article>
    )
  }

  return (
    <article className="message-card assistant">
      <div className="message-meta">
        <span className="message-avatar" aria-hidden="true">⚾</span>
        <span className="message-tag">{message.tag ?? 'BattersBetter'}</span>
        {message.title && <span className="message-title">{message.title}</span>}
      </div>
      <FormattedAnswer text={message.body} />
    </article>
  )
}
