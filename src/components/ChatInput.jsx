import { useState } from 'react'

export function ChatInput({ prompt, setPrompt, minimal = false }) {
  const [isFocused, setIsFocused] = useState(false)
  const labelText = minimal ? 'Ask anything' : 'Ask about a live game, fair odds, final score projection, or biggest model edge...'
  const showFloatingLabel = isFocused

  return (
    <form
      className={`composer${minimal ? ' composer--minimal' : ''}${showFloatingLabel ? ' composer--focused' : ''}`}
      onSubmit={(event) => event.preventDefault()}
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
          placeholder={showFloatingLabel ? '' : labelText}
          rows="1"
          value={prompt}
        />
        <button aria-label="Send prompt" className="send-button" type="submit">
          <svg aria-hidden="true" className="send-button__icon" viewBox="0 0 24 24">
            <path
              d="M5.1 18.9 15.8 8.2l1.7 1.7L6.8 20.6c-.5.5-1.2.8-1.9.9l-1 .1.1-1c.1-.7.4-1.4 1.1-1.7Zm11-12.3 1-1c.6-.6 1.3-1 2.1-1.1l.8-.1-.1.8c-.1.8-.5 1.5-1.1 2.1l-1 1-1.7-1.7Z"
              fill="currentColor"
            />
            <path
              d="M14.9 7.4 16.6 9.1"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
        </button>
      </div>
    </form>
  )
}
