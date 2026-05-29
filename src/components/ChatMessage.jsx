export function ChatMessage({ message }) {
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
