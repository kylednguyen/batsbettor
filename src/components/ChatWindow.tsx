import type { ChatMessage as ChatMessageType } from '../types'
import { ChatMessage } from './ChatMessage'

interface ChatWindowProps {
  messages: ChatMessageType[]
}

export function ChatWindow({ messages }: ChatWindowProps) {
  return (
    <section className="chat-stream">
      {messages.map((message) => (
        <ChatMessage key={message.title} message={message} />
      ))}
    </section>
  )
}
