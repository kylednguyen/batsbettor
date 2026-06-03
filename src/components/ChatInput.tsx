import { useState } from 'react'

interface ChatInputProps {
  prompt: string
  setPrompt: (value: string) => void
  onSubmit?: (message: string) => void
  minimal?: boolean
  disabled?: boolean
}

export function ChatInput({ prompt, setPrompt, onSubmit, minimal = false, disabled = false }: ChatInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const labelText = minimal ? 'Ask anything' : 'Ask about a live game, fair odds, final score projection, or biggest model edge...'
  const showFloatingLabel = isFocused

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed || disabled) return
    onSubmit?.(trimmed)
    setPrompt('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const trimmed = prompt.trim()
      if (!trimmed || disabled) return
      onSubmit?.(trimmed)
      setPrompt('')
    }
  }

  return (
    <form
      className={`composer${minimal ? ' composer--minimal' : ''}${showFloatingLabel ? ' composer--focused' : ''}`}
      onSubmit={handleSubmit}
    >
      <div className={`composer-floating-label${showFloatingLabel ? ' composer-floating-label--visible' : ''}`}>
        {labelText}
      </div>

      <div className="composer-row">
        <textarea
          aria-label="Chat prompt"
          className="composer-input"
          onChange={(event) => setPrompt(event.target.value)}
          onBlur={() => setIsFocused(false)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={showFloatingLabel ? '' : labelText}
          rows={1}
          value={prompt}
          disabled={disabled}
        />
        <button aria-label="Send prompt" className="send-button" type="submit" disabled={disabled}>
          <svg aria-hidden="true" className="send-button__icon" width="18" height="18" strokeWidth="1.5" viewBox="0 0 24 24" fill="none">
            <path d="M11.5757 1.42426C11.81 1.18995 12.1899 1.18995 12.4243 1.42426L22.5757 11.5757C22.81 11.81 22.8101 12.1899 22.5757 12.4243L12.4243 22.5757C12.19 22.81 11.8101 22.8101 11.5757 22.5757L1.42426 12.4243C1.18995 12.19 1.18995 11.8101 1.42426 11.5757L11.5757 1.42426Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  )
}
