export interface Document {
  id: string
  file_name: string
  file_type: string
  file_size?: number
  storage_url: string
  title?: string
  description?: string
  user_id: string
  workspace_id?: string
  created_at: string
  updated_at?: string
}

export interface DocumentChunk {
  id: string
  document_id: string
  content: string
  embedding?: number[] // OpenAI embeddings (1536 dimensions)
  local_embedding?: number[] // Local embeddings (384 dimensions)
  content_position?: number
  chunk_size?: number
  created_at: string
}

export interface DocumentSearchResult {
  id: string
  document_id: string
  content: string
  similarity?: number // For vector search
  rank?: number // For text search
  document_title?: string
  document_url: string
}

// Input for uploading a document
export interface DocumentUploadInput {
  file: File
  title?: string
  description?: string
  workspace_id?: string
  knowledge_base_id?: string
}

// Status of document processing
export interface DocumentProcessingStatus {
  document_id: string
  status: 'uploading' | 'processing' | 'embedding' | 'completed' | 'failed' | 'unknown' | 
          'facts_extracting' | 'facts_saving' | 'facts_completed' | 'facts_failed'
  progress: number // 0-100
  error?: string
  updated_at?: string
  chunks_count?: number
  message?: string
  document?: {
    file_name: string;
    file_type: string;
    created_at: string;
  }
}

// Search parameters
export interface DocumentSearchParams {
  query: string
  search_type: 'semantic' | 'fulltext' | 'hybrid'
  workspace_id?: string
  limit?: number
  threshold?: number
} 