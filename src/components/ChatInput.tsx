import { useLayoutEffect, useRef } from 'react'

interface ChatInputProps {
  prompt: string
  setPrompt: (value: string) => void
  onSubmit?: (message: string) => void
  minimal?: boolean
  disabled?: boolean
}

// Grows with content from one line up to this cap, then scrolls.
const MAX_TEXTAREA_HEIGHT = 200

export function ChatInput({
  prompt,
  setPrompt,
  onSubmit,
  minimal = false,
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const placeholder = minimal
    ? 'Ask anything'
    : 'Ask about live games, fair odds, projections, or model edges…'

  const hasText = prompt.trim().length > 0

  // Auto-grow: collapse to one line, then grow to content height (capped). When
  // empty we leave it at `auto` so it rests at a single line.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    if (prompt) el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [prompt])

  function submitPrompt() {
    const trimmed = prompt.trim()
    if (!trimmed || disabled) return
    onSubmit?.(trimmed)
    setPrompt('')
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    submitPrompt()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitPrompt()
    }
  }

  return (
    <form
      className={`composer${minimal ? ' composer--minimal' : ''}`}
      onSubmit={handleSubmit}
    >
      <textarea
        ref={textareaRef}
        aria-label="Chat prompt"
        className="composer-input"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        value={prompt}
        disabled={disabled}
      />

      <button
        aria-label="Send prompt"
        className="send-button"
        type="submit"
        disabled={disabled || !hasText}
      >
        <svg
          aria-hidden="true"
          className="send-button__icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 5v14M5 12l7-7 7 7"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </form>
  )
}
