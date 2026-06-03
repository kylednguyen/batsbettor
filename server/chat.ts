// Thin compatibility shim: the chat endpoint calls handleChat, which now
// delegates to the RAG + LLM explanation layer in llm/mlbChatService.
export {
  answerMlbQuestion as handleChat,
  type ChatRequest,
  type ChatResponse,
} from './llm/mlbChatService.js'
