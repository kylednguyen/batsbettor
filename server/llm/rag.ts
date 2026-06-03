// Lightweight, dependency-free RAG retriever.
//
// For a small, curated knowledge base (~15 short docs), a TF-IDF cosine
// retriever gives good results with zero cost and zero dependencies — no
// embedding model to download, no Ollama daemon, no vector database. The
// interface (retrieve -> ranked docs) is deliberately swappable: it can be
// replaced with local embeddings (e.g. Transformers.js) or pgvector later
// without touching callers.

import { baseballKnowledgeDocs, type KnowledgeDoc } from './baseballKnowledge.js'

export interface RetrievedDoc {
  id: string
  title: string
  text: string
  score: number
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'its', 'that', 'this',
  'from', 'has', 'have', 'how', 'what', 'why', 'when', 'which', 'who', 'do',
  'does', 'can', 'will', 'would', 'should', 'about', 'than', 'then', 'so',
  'they', 'their', 'there', 'i', 'me', 'my', 'you', 'your', 'we',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

interface IndexedDoc {
  doc: KnowledgeDoc
  tfidf: Map<string, number>
  norm: number
}

// Build the TF-IDF index once at module load.
const docCount = baseballKnowledgeDocs.length
const docFreq = new Map<string, number>()
for (const doc of baseballKnowledgeDocs) {
  const seen = new Set(tokenize(`${doc.title} ${doc.text}`))
  for (const term of seen) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
}

function idf(term: string): number {
  const df = docFreq.get(term) ?? 0
  if (df === 0) return 0
  return Math.log((docCount + 1) / (df + 1)) + 1
}

function vectorize(tokens: string[]): { vec: Map<string, number>; norm: number } {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  const vec = new Map<string, number>()
  let sumSq = 0
  for (const [term, count] of tf) {
    const weight = count * idf(term)
    if (weight === 0) continue
    vec.set(term, weight)
    sumSq += weight * weight
  }
  return { vec, norm: Math.sqrt(sumSq) || 1 }
}

const index: IndexedDoc[] = baseballKnowledgeDocs.map((doc) => {
  const { vec, norm } = vectorize(tokenize(`${doc.title} ${doc.text}`))
  return { doc, tfidf: vec, norm }
})

function cosine(
  queryVec: Map<string, number>,
  queryNorm: number,
  indexed: IndexedDoc
): number {
  let dot = 0
  // Iterate the smaller vector for efficiency.
  const [small, large] =
    queryVec.size < indexed.tfidf.size ? [queryVec, indexed.tfidf] : [indexed.tfidf, queryVec]
  for (const [term, weight] of small) {
    const other = large.get(term)
    if (other) dot += weight * other
  }
  return dot / (queryNorm * indexed.norm)
}

// Retrieve the top-k most relevant knowledge docs for a query.
export function retrieve(query: string, k = 4): RetrievedDoc[] {
  const { vec, norm } = vectorize(tokenize(query))

  const scored = index
    .map((indexed) => ({
      id: indexed.doc.id,
      title: indexed.doc.title,
      text: indexed.doc.text,
      score: cosine(vec, norm, indexed),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    // No keyword overlap — fall back to the most generally useful docs.
    return index
      .filter((d) => ['win-probability', 'model-vs-market-edge'].includes(d.doc.id))
      .map((d) => ({ id: d.doc.id, title: d.doc.title, text: d.doc.text, score: 0 }))
  }

  return scored.slice(0, k)
}
