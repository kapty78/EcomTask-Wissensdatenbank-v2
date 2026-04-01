export interface KnowledgeItemChunk {
  content: string
  tokens: number
  metadata?: {
    title?: string
    summary?: string
    chunkIndex?: number
    chunkingMethod?: 'ai_semantic' | 'traditional_recursive' | 'single_chunk'
    documentType?: string
  }
}
