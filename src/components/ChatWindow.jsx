import { ChatMessage } from './ChatMessage'

export function ChatWindow({ messages }) {
  return (
    <section className="chat-stream">
      {messages.map((message) => (
        <ChatMessage key={message.title} message={message} />
      ))}
    </section>
  )
}
