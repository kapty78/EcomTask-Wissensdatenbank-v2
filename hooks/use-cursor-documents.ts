import { useState, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase-browser'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Database } from '@/supabase/types'
import { 
  DocumentProcessingStatus, 
  DocumentUploadInput,
  DocumentSearchParams,
  DocumentSearchResult,
  Document
} from '@/types/cursor-documents'
import { logger } from '@/lib/utils/logger'

interface UseCursorDocumentsProps {
  workspaceId?: string
}

interface UseCursorDocumentsReturn {
  // Document operations
  uploadDocument: (input: DocumentUploadInput) => Promise<string>
  getDocumentStatus: (documentId: string) => Promise<DocumentProcessingStatus>
  listDocuments: () => Promise<Document[]>
  deleteDocument: (documentId: string) => Promise<boolean>
  
  // Search operations
  searchDocuments: (params: DocumentSearchParams) => Promise<DocumentSearchResult[]>
  
  // State
  loading: boolean
  error: string | null
}

/**
 * Hook for interacting with the Cursor document APIs
 */
export function useCursorDocuments({ workspaceId }: UseCursorDocumentsProps = {}): UseCursorDocumentsReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useSupabaseClient()

  
  /**
   * Upload a document and start processing
   * Automatically uses large file upload for files > 4MB
   */
  const uploadDocument = async (input: DocumentUploadInput): Promise<string> => {
    setLoading(true)
    setError(null)

    try {
      // Validate file BEFORE any processing
      const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
      const maxFileSize = 200 * 1024 * 1024 // 200MB per file - updated limit
      const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '._.', '._ds_store']

      const fileName = input.file.name.toLowerCase()
      const fileExtension = '.' + input.file.name.split('.').pop()?.toLowerCase()

      // Skip macOS and Windows system files silently
      if (systemFiles.some(sysFile => fileName === sysFile || fileName.startsWith(sysFile))) {
        throw new Error(`Systemdatei kann nicht hochgeladen werden: ${input.file.name}`)
      }

      if (!allowedTypes.includes(fileExtension)) {
        throw new Error(`Nicht unterstützter Dateityp: ${fileExtension}. Erlaubte Formate: ${allowedTypes.join(', ')}`)
      }

      if (input.file.size > maxFileSize) {
        throw new Error(`Datei zu groß: ${(input.file.size / (1024 * 1024)).toFixed(1)}MB. Maximum: 200MB`)
      }

      // Get session for auth token
      if (!supabase || !supabase.auth) {
        throw new Error('Supabase client not initialized')
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

      if (sessionError) {
          throw new Error(`Authentication failed: ${sessionError.message}`)
      }

      const token = sessionData?.session?.access_token

      if (!token) {
        throw new Error('Authentication required: No access token')
      }

      const wsId = input.workspace_id || workspaceId
      
      // Check file size and use appropriate upload method
      const LARGE_FILE_THRESHOLD = 4 * 1024 * 1024; // 4MB
      
      logger.info(`File size: ${(input.file.size / 1024 / 1024).toFixed(2)}MB, threshold: 4MB`)
      
      if (input.file.size > LARGE_FILE_THRESHOLD) {
        // Use large file upload flow
        logger.info(`Large file detected (${(input.file.size / 1024 / 1024).toFixed(2)}MB), using presigned URL upload`)
        
        // Step 1: Get presigned URL
        const presignedResponse = await fetch('/api/cursor/upload-large', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileName: input.file.name,
            fileSize: input.file.size,
            fileType: input.file.type,
            title: input.title,
            description: input.description,
            workspaceId: wsId,
            knowledgeBaseId: input.knowledge_base_id
          })
        })
        
        if (!presignedResponse.ok) {
          const errorData = await presignedResponse.json().catch(() => ({ error: 'Failed to create upload URL' }))
          throw new Error(errorData.error || `Failed to create upload URL (status ${presignedResponse.status})`)
        }
        
        const { uploadUrl, documentId, filePath } = await presignedResponse.json()
        
        // Step 2: Upload directly to Supabase Storage
        logger.info('Uploading file directly to Supabase Storage...')
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: input.file,
          headers: {
            'Content-Type': input.file.type
          }
        })
        
        if (!uploadResponse.ok) {
          throw new Error(`Direct upload failed (status ${uploadResponse.status})`)
        }
        
        // Step 3: Confirm upload completion
        logger.info('Confirming upload completion and starting processing...')
        const confirmResponse = await fetch('/api/cursor/upload-large', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            documentId,
            knowledgeBaseId: input.knowledge_base_id
          })
        })
        
        if (!confirmResponse.ok) {
          const errorData = await confirmResponse.json().catch(() => ({ error: 'Failed to confirm upload' }))
          throw new Error(errorData.error || `Failed to confirm upload (status ${confirmResponse.status})`)
        }
        
        logger.info(`Large file upload completed successfully for document ${documentId}`)
        return documentId
        
      } else {
        // Standarder Upload-Flow (Server übernimmt Chunking + Weiterverarbeitung)
        logger.info(`Regular file size (${(input.file.size / 1024 / 1024).toFixed(2)}MB), using standard upload`)
        
        const formData = new FormData()
        formData.append('file', input.file)
        
        if (input.title) {
          formData.append('title', input.title)
        }
        
        if (input.description) {
          formData.append('description', input.description)
        }
        
        if (wsId) {
          formData.append('workspace_id', wsId)
        }
        
        if (input.knowledge_base_id) {
          formData.append('knowledge_base_id', input.knowledge_base_id);
        }
        
        const response = await fetch('/api/cursor/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        })
        
        if (!response.ok) {
          let errorData = { error: 'Upload failed with status: ' + response.status };
          try {
               errorData = await response.json()
          } catch(e) {
          }
          throw new Error(errorData.error || `Upload failed (status ${response.status})`)
        }
        
        const data = await response.json()
        return data.document_id
      }
      
    } catch (err: any) {
      setError(err.message || 'Failed to upload document')
      throw err // Re-throw to be caught by handleSubmit
    } finally {
      setLoading(false)
    }
  }
  
  /**
   * Get document processing status
   */
  const getDocumentStatus = async (documentId: string): Promise<DocumentProcessingStatus> => {
    try {
      // Get session for auth token
      if (!supabase || !supabase.auth) {
        throw new Error('Supabase client not initialized')
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
          throw new Error(`Authentication failed: ${sessionError.message}`)
      }
      
      const token = sessionData?.session?.access_token
      
      if (!token) {
         throw new Error('Authentication required: No access token')
      }
      
      // Call API
      const response = await fetch(`/api/cursor/status?document_id=${documentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (!response.ok) {
        let errorData = { error: 'Status check failed with status: ' + response.status };
         try {
             errorData = await response.json()
        } catch(e) {
        }
        throw new Error(errorData.error || `Failed to get status (status ${response.status})`)
      }
      
      return await response.json()
      
    } catch (err: any) {
      throw err // Re-throw to be handled by the polling logic
    }
  }
  
  /**
   * List all documents for the current user
   */
  const listDocuments = async (): Promise<Document[]> => {
    setLoading(true)
    setError(null)
    
    try {
       if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      // Query direct from Supabase (needs RLS)
      let query = supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })
      
      // Filter by workspace ID if provided
      if (workspaceId) {
        query = query.eq('workspace_id', workspaceId)
      }
      
      const { data, error: queryError } = await query
      
      if (queryError) {
        throw new Error(queryError.message)
      }
      
      return data || []
      
    } catch (err: any) {
      setError(err.message || 'Failed to list documents')
      throw err
    } finally {
      setLoading(false)
    }
  }
  
  /**
   * Delete a document and its chunks
   */
  const deleteDocument = async (documentId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    
    try {
      if (!supabase) {
        throw new Error('Supabase client not initialized')
      }
      // Delete the document (cascade will handle chunks)
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId)
      
      if (deleteError) {
        throw new Error(deleteError.message)
      }
      
      return true
      
    } catch (err: any) {
      setError(err.message || 'Failed to delete document')
      throw err
    } finally {
      setLoading(false)
    }
  }
  
  /**
   * Search documents
   */
  const searchDocuments = async (params: DocumentSearchParams): Promise<DocumentSearchResult[]> => {
    setLoading(true)
    setError(null)
    
    try {
      // Get session for auth token
      if (!supabase || !supabase.auth) {
        throw new Error('Supabase client not initialized')
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

       if (sessionError) {
          throw new Error(`Authentication failed: ${sessionError.message}`)
      }
      
      const token = sessionData?.session?.access_token
      
      if (!token) {
         throw new Error('Authentication required: No access token')
      }
      
      // Add workspace ID from hook props if not in params
      const searchParams = { ...params }
      if (!searchParams.workspace_id && workspaceId) {
        searchParams.workspace_id = workspaceId
      }
      
      // Call API
      const response = await fetch('/api/cursor/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchParams)
      })
      
      if (!response.ok) {
        let errorData = { error: 'Search failed with status: ' + response.status };
         try {
             errorData = await response.json()
        } catch(e) {
        }
        throw new Error(errorData.error || `Search failed (status ${response.status})`)
      }
      
      const data = await response.json()
      return data.results || []
      
    } catch (err: any) {
      setError(err.message || 'Failed to search documents')
      throw err
    } finally {
      setLoading(false)
    }
  }
  
  return {
    uploadDocument,
    getDocumentStatus,
    listDocuments,
    deleteDocument,
    searchDocuments,
    loading,
    error
  }
} 