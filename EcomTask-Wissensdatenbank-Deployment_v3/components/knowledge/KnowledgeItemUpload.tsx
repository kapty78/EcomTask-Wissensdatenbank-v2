"use client"

import React, { useState, useRef, useEffect } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Database } from "@/lib/supabase/types"
import {
  ArrowUpCircle,
  AlertCircle,
  FileUp,
  Upload,
  X,
  Check,
  FileText,
  Loader2,
  FolderOpen
} from "lucide-react"
import { useCursorDocuments } from "@/hooks/use-cursor-documents"
import { DocumentProcessingStatus } from "@/types/cursor-documents"

interface KnowledgeItemUploadProps {
  userId: string
  knowledgeBaseId: string
  onUploadComplete: () => void
  onCancel: () => void
}

export const KnowledgeItemUpload: React.FC<KnowledgeItemUploadProps> = ({
  userId,
  knowledgeBaseId,
  onUploadComplete,
  onCancel
}) => {
  const [sourceType, setSourceType] = useState<"file" | "folder" | "text">("file")
  const [sourceName, setSourceName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [folderName, setFolderName] = useState("")
  const [textContent, setTextContent] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [isCheckingTitle, setIsCheckingTitle] = useState(false)

  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null)
  const [processingStatus, setProcessingStatus] = useState<DocumentProcessingStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // For folder uploads: track multiple documents
  const [folderDocuments, setFolderDocuments] = useState<string[]>([])
  const [folderProgress, setFolderProgress] = useState<{[documentId: string]: DocumentProcessingStatus}>({})
  const [isFolderPolling, setIsFolderPolling] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadDocument, getDocumentStatus, loading } = useCursorDocuments()
  const supabase = createClientComponentClient<Database>()

  // Simple drag & drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
      setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const items = e.dataTransfer.items
    const files: File[] = []

    // Check if we have DataTransferItems (better for folder detection)
    if (items && items.length > 0) {
      // Process all items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            if (entry.isDirectory) {
              // It's a folder - read all files from it
              const folderFiles = await readDirectoryRecursively(entry as FileSystemDirectoryEntry)
              files.push(...folderFiles)
            } else if (entry.isFile) {
              // It's a single file
              const file = item.getAsFile()
              if (file) files.push(file)
            }
          }
        }
      }
    }

    // Fallback to dataTransfer.files if webkitGetAsEntry is not supported
    if (files.length === 0 && e.dataTransfer.files.length > 0) {
      files.push(...Array.from(e.dataTransfer.files))
    }

    if (files.length === 0) {
      setError('Keine Dateien gefunden')
      return
    }

    // Pre-validate and filter files before processing
    const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
    const maxFileSize = 50 * 1024 * 1024 // 50MB per file
    const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '._.', '._ds_store']
    const invalidFiles: { name: string, reason: string }[] = []
    const validFiles: File[] = []

    files.forEach(file => {
      const fileName = file.name.toLowerCase()
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()

      // Skip macOS and Windows system files silently
      if (systemFiles.some(sysFile => fileName === sysFile || fileName.startsWith(sysFile))) {
        return // Skip silently
      }

      if (!allowedTypes.includes(fileExtension)) {
        invalidFiles.push({ name: file.name, reason: `Nicht unterstützter Dateityp: ${fileExtension}` })
      } else if (file.size > maxFileSize) {
        invalidFiles.push({ name: file.name, reason: `Datei zu groß: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max. 50MB)` })
      } else {
        validFiles.push(file)
      }
    })

    // Use filtered valid files instead of all files
    const filesToProcess = validFiles

    // Show error only if there are invalid files AND no valid files
    if (invalidFiles.length > 0 && filesToProcess.length === 0) {
      setError(`Folgende Dateien können nicht hochgeladen werden:\n${invalidFiles.map(f => `• ${f.name}: ${f.reason}`).join('\n')}`)
      return
    }

    // Check if we have any files to process
    if (filesToProcess.length === 0) {
      setError('Keine gültigen Dateien gefunden')
      return
    }

    // Determine if it's a folder or single file upload
    if (filesToProcess.length > 1) {
      // Multiple files - treat as folder (already validated)
      handleFolderFiles(filesToProcess)
    } else {
      // Single file (already validated)
      const droppedFile = filesToProcess[0]
      setFile(droppedFile)
      setSourceName(droppedFile.name)
      resetState()
    }
  }

  // Helper function to read directory recursively
  const readDirectoryRecursively = (directory: FileSystemDirectoryEntry): Promise<File[]> => {
    return new Promise((resolve) => {
      const files: File[] = []
      const reader = directory.createReader()

      const readEntries = () => {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            resolve(files)
            return
          }

          const promises = entries.map((entry) => {
            return new Promise<void>((resolveEntry) => {
              if (entry.isFile) {
                (entry as FileSystemFileEntry).file((file) => {
                  files.push(file)
                  resolveEntry()
                })
              } else if (entry.isDirectory) {
                readDirectoryRecursively(entry as FileSystemDirectoryEntry).then((subFiles) => {
                  files.push(...subFiles)
                  resolveEntry()
                })
              } else {
                resolveEntry()
              }
            })
          })

          Promise.all(promises).then(() => {
            readEntries() // Continue reading if there are more entries
          })
        })
      }

      readEntries()
    })
  }

  const handleFolderFiles = (fileList: File[]) => {
    // Files are already validated in handleDrop
    setFiles(fileList)
    setSourceType("folder")

    // Extract folder name from first file path
    const firstFilePath = fileList[0].webkitRelativePath || fileList[0].name
    const folderPath = firstFilePath.split('/').slice(0, -1).join('/')
    setFolderName(folderPath || 'Ordner Upload')
    resetState()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      setFile(files[0])
      setSourceName(files[0].name)
      resetState()
    }
  }

  const resetState = () => {
    setCurrentDocumentId(null)
    setProcessingStatus(null)
    setIsPolling(false)
    setError(null)
    setTitleError(null)
    
    // Reset folder state
    setFolderDocuments([])
    setFolderProgress({})
    setIsFolderPolling(false)
  }

  const clearFile = () => {
    setFile(null)
    setSourceName("")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    resetState()
  }

  const clearFolder = () => {
    setFiles([])
    setFolderName("")
    setSourceName("")
    resetState()
  }

  const clearTextContent = () => {
    setTextContent("")
    setSourceName("")
    resetState()
  }

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles && selectedFiles.length > 0) {
      const files = Array.from(selectedFiles)
      
      // Pre-validate and filter files before processing
      const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
      const maxFileSize = 200 * 1024 * 1024 // 200MB per file
      const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '._.', '._ds_store']
      const invalidFiles: { name: string, reason: string }[] = []
      const validFiles: File[] = []

      files.forEach(file => {
        const fileName = file.name.toLowerCase()
        const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
        
        // Skip macOS and Windows system files silently
        if (systemFiles.some(sysFile => fileName === sysFile || fileName.startsWith(sysFile))) {
          return // Skip silently
        }
        
        if (!allowedTypes.includes(fileExtension)) {
          invalidFiles.push({ name: file.name, reason: `Nicht unterstützter Dateityp: ${fileExtension}` })
        } else if (file.size > maxFileSize) {
          invalidFiles.push({ name: file.name, reason: `Datei zu groß: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max. 50MB)` })
        } else {
          validFiles.push(file)
        }
      })

      // Show error only if there are invalid files AND no valid files
      if (invalidFiles.length > 0 && validFiles.length === 0) {
        setError(`Folgende Dateien können nicht hochgeladen werden:\n${invalidFiles.map(f => `• ${f.name}: ${f.reason}`).join('\n')}`)
        return
      }

      // Show warning if some files were skipped but we have valid files
      if (invalidFiles.length > 0 && validFiles.length > 0) {
        console.warn(`${invalidFiles.length} Dateien wurden übersprungen:`, invalidFiles)
      }

      // Check if we have any files to process
      if (validFiles.length === 0) {
        setError('Keine gültigen Dateien gefunden')
        return
      }

      handleFolderFiles(validFiles)
    }
  }

  // Single document status polling
  useEffect(() => {
    if (!currentDocumentId || !isPolling) return

    const pollInterval = setInterval(async () => {
      try {
        const status = await getDocumentStatus(currentDocumentId)
        setProcessingStatus(status)

        // Stop polling when finished, aber Nachricht sichtbar lassen
        if (status.status === 'completed' || status.status === 'failed' || 
            status.status === 'facts_completed' || status.status === 'facts_failed') {
          setIsPolling(false)
        }
      } catch (err: any) {
        setError(err.message || 'Status-Polling fehlgeschlagen')
        setIsPolling(false)
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [currentDocumentId, isPolling, getDocumentStatus, sourceType, onUploadComplete])

  // Folder documents status polling
  useEffect(() => {
    if (!isFolderPolling || folderDocuments.length === 0) return

    const pollInterval = setInterval(async () => {
      try {
        const statusPromises = folderDocuments.map(async (docId) => {
          const status = await getDocumentStatus(docId)
          return { docId, status }
        })

        const results = await Promise.all(statusPromises)
        const newProgress: {[documentId: string]: DocumentProcessingStatus} = {}
        
        let completedCount = 0
        let failedCount = 0
        
        results.forEach(({ docId, status }) => {
          newProgress[docId] = status
          
          if (status.status === 'completed' || status.status === 'facts_completed') {
            completedCount++
          } else if (status.status === 'failed' || status.status === 'facts_failed') {
            failedCount++
          }
        })

        setFolderProgress(newProgress)

        // Update overall folder status
        const totalFiles = folderDocuments.length
        const processedFiles = completedCount + failedCount
        const overallProgress = Math.round((processedFiles / totalFiles) * 100)

        setProcessingStatus({
          document_id: 'folder-upload',
          status: processedFiles === totalFiles ? 'completed' : 'processing',
          progress: overallProgress,
          message: `${completedCount} von ${totalFiles} Dateien erfolgreich verarbeitet${failedCount > 0 ? `, ${failedCount} fehlgeschlagen` : ''}`
        })

        // Stop polling when all files are processed
        if (processedFiles === totalFiles) {
          setIsFolderPolling(false)
          
          // Auto-clear and notify completion after brief delay
          setTimeout(() => {
            clearFolder()
            onUploadComplete()
          }, 3000)
        }

      } catch (err: any) {
        setError(err.message || 'Status-Polling für Ordner fehlgeschlagen')
        setIsFolderPolling(false)
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [isFolderPolling, folderDocuments, getDocumentStatus, onUploadComplete])

  // Debounced title uniqueness check
  useEffect(() => {
    if (!sourceName.trim() || sourceType !== "text") {
      setTitleError(null)
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        setIsCheckingTitle(true)
        setTitleError(null)

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          setTitleError("Nicht authentifiziert")
          return
        }

        const response = await fetch('/api/cursor/check-title-uniqueness', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ title: sourceName.trim() })
        })

        const result = await response.json()
        
        if (!response.ok) {
          setTitleError(result.error || 'Fehler bei der Validierung')
          return
        }

        if (!result.isUnique) {
          setTitleError('Ein Dokument mit diesem Namen existiert bereits')
        }
      } catch (error) {
        console.error('Error checking title uniqueness:', error)
        setTitleError('Fehler bei der Validierung')
      } finally {
        setIsCheckingTitle(false)
      }
    }, 500) // 500ms delay

    return () => clearTimeout(timeoutId)
  }, [sourceName, sourceType, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetState()

    console.log('🚀 handleSubmit called with sourceType:', sourceType)

    if (sourceType === "file" && !file) {
      setError("Bitte wählen Sie eine Datei aus")
      return
    }
    if (sourceType === "folder" && files.length === 0) {
      setError("Bitte wählen Sie einen Ordner aus")
      return
    }
    if (sourceType === "text" && !textContent.trim()) {
      setError("Bitte geben Sie Text ein")
      return
    }

    // 🔒 PRE-FLIGHT VALIDATION - Block large files BEFORE any network request
    console.log('🛡️ Starting pre-flight validation...')

    // Validate single file upload
    if (sourceType === "file" && file) {
      const fileSizeMB = file.size / (1024 * 1024)
      console.log(`📄 Validating single file: ${file.name} (${fileSizeMB.toFixed(1)}MB)`)

      if (fileSizeMB > 200) {
        console.log(`❌ File too large: ${fileSizeMB.toFixed(1)}MB > 200MB`)
        setError(`Datei zu groß: ${fileSizeMB.toFixed(1)}MB. Maximum: 200MB`)
        return
      }

      const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      if (!allowedTypes.includes(fileExtension)) {
        console.log(`❌ Invalid file type: ${fileExtension}`)
        setError(`Dateityp ${fileExtension} wird nicht unterstützt. Erlaubte Formate: ${allowedTypes.join(', ')}`)
        return
      }

      console.log('✅ Single file validation passed')
    }

    // Validate folder upload
    if (sourceType === "folder" && files.length > 0) {
      console.log(`📁 Validating ${files.length} files in folder`)

      const maxFileSize = 200 * 1024 * 1024 // 200MB per file
      const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '._.', '._ds_store']
      let totalSize = 0
      let validFiles = 0

      files.forEach(f => {
        const fileName = f.name.toLowerCase()
        const fileExtension = '.' + f.name.split('.').pop()?.toLowerCase()

        // Skip system files
        if (systemFiles.some(sysFile => fileName === sysFile || fileName.startsWith(sysFile))) {
          console.log(`⏭️ Skipping system file: ${f.name}`)
          return
        }

        // Check file size
        if (f.size > maxFileSize) {
          console.log(`❌ File too large: ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`)
          setError(`Datei zu groß: ${(f.size / (1024 * 1024)).toFixed(1)}MB. Maximum: 200MB`)
          return
        }

        // Check file type
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
        if (!allowedTypes.includes(fileExtension)) {
          console.log(`❌ Invalid file type: ${f.name} (${fileExtension})`)
          setError(`Dateityp ${fileExtension} wird nicht unterstützt. Erlaubte Formate: ${allowedTypes.join(', ')}`)
          return
        }

        totalSize += f.size
        validFiles++
        console.log(`✅ Valid file: ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`)
      })

      if (validFiles === 0) {
        console.log('❌ No valid files in folder')
        setError('Keine gültigen Dateien im Ordner gefunden')
        return
      }

      if (totalSize > 200 * 1024 * 1024) {
        console.log(`❌ Folder too large: ${(totalSize / (1024 * 1024)).toFixed(1)}MB > 200MB`)
        setError(`Ordner insgesamt zu groß: ${(totalSize / (1024 * 1024)).toFixed(1)}MB (max. 200MB)`)
        return
      }

      console.log(`✅ Folder validation passed: ${validFiles} files, ${(totalSize / (1024 * 1024)).toFixed(1)}MB total`)
    }

    console.log('🎯 Pre-flight validation passed, proceeding with upload')
    if (sourceType === "text" && !sourceName.trim()) {
      setError("Bitte geben Sie eine Bezeichnung ein")
      return
    }
    if (titleError) {
      setError(titleError)
      return
    }

    try {
      if (sourceType === 'folder' && files.length > 0) {
        // Handle folder upload
        await uploadFolder()
      } else if (sourceType === 'file' && file) {
        const docId = await uploadDocument({
          file: file,
          title: sourceName || file.name,
          knowledge_base_id: knowledgeBaseId
        })

        if (docId) {
          setCurrentDocumentId(docId)
          setIsPolling(true)
          setProcessingStatus({
            document_id: docId,
            status: 'uploading',
            progress: 0
          })
        } else {
          throw new Error("Upload fehlgeschlagen: Keine Dokument-ID erhalten")
        }
      } else if (sourceType === 'text' && textContent) {
        let fileName = sourceName || "text-content"
        if (!fileName.toLowerCase().endsWith('.txt')) {
          fileName += '.txt'
        }

        const textBlob = new Blob([textContent], { type: 'text/plain' })
        const textFile = new File([textBlob], fileName, { type: 'text/plain' })

        const docId = await uploadDocument({
          file: textFile,
          title: sourceName || "Text-Inhalt",
          knowledge_base_id: knowledgeBaseId
        })

        if (docId) {
          setCurrentDocumentId(docId)
          setIsPolling(true)
          setProcessingStatus({
            document_id: docId,
            status: 'uploading',
            progress: 0
          })
        } else {
          throw new Error("Upload fehlgeschlagen: Keine Dokument-ID erhalten")
        }
      }

    } catch (err: any) {
      setError(err.message || "Upload fehlgeschlagen")
    }
  }

  const uploadFolder = async () => {
    if (files.length === 0) return

    setError(null)
    setProcessingStatus({
      document_id: 'folder-upload',
      status: 'uploading',
      progress: 0,
      message: `Ordner-Upload wird vorbereitet...`
    })

    try {
      // Get session for auth token
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('Nicht authentifiziert')
      }

      // 🔍 Check if we need to use large file upload strategy
      const LARGE_FILE_THRESHOLD = 4 * 1024 * 1024 // 4MB
      const hasLargeFiles = files.some(f => f.size > LARGE_FILE_THRESHOLD)
      const totalSize = files.reduce((sum, f) => sum + f.size, 0)
      
      console.log(`📁 Folder upload: ${files.length} files, total size: ${(totalSize / (1024 * 1024)).toFixed(1)}MB`)
      console.log(`📊 Large files detected: ${hasLargeFiles}`)
      
      // 🚀 NEW STRATEGY: Always use individual uploads to avoid FormData size limits
      console.log('🚀 Using individual upload strategy for all files')
      
      const results = []
      const documentIds = []
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const progress = Math.round((i / files.length) * 50) + 25
        
        setProcessingStatus({
          document_id: 'folder-upload',
          status: 'processing',
          progress,
          message: `Lade Datei ${i + 1}/${files.length} hoch: ${file.name}`
        })
        
        try {
          // Use the existing uploadDocument function which handles large files automatically
          const docId = await uploadDocument({
            file: file,
            title: file.name,
            knowledge_base_id: knowledgeBaseId
          })
          
          if (docId) {
            documentIds.push(docId)
            results.push({
              document_id: docId,
              file_name: file.name,
              status: 'uploaded'
            })
            console.log(`✅ Successfully uploaded: ${file.name}`)
          }
        } catch (err: any) {
          console.error(`❌ Failed to upload ${file.name}:`, err)
          results.push({
            file_name: file.name,
            status: 'failed',
            error: err.message
          })
        }
      }
      
      // Set up folder polling for successful uploads
      if (documentIds.length > 0) {
        console.log(`📋 Starting polling for ${documentIds.length} documents:`, documentIds)
        
        setFolderDocuments(documentIds)
        setIsFolderPolling(true)
        
        setProcessingStatus({
          document_id: 'folder-upload',
          status: 'processing',
          progress: 75,
          message: `${documentIds.length} von ${files.length} Dateien hochgeladen. Warte auf Verarbeitung...`
        })
        
        // Show warning if some uploads failed
        const failedCount = results.filter(r => r.status === 'failed').length
        if (failedCount > 0) {
          console.warn(`⚠️ ${failedCount} Dateien konnten nicht hochgeladen werden`)
        }
      } else {
        throw new Error('Keine Dateien konnten hochgeladen werden')
      }

    } catch (err: any) {
      setError(err.message || "Ordner-Upload fehlgeschlagen")
      setProcessingStatus({
        document_id: 'folder-upload',
        status: 'failed',
        progress: 0,
        message: err.message || "Ordner-Upload fehlgeschlagen"
      })
    }
  }

  const getStatusMessage = () => {
    if (!processingStatus) return null
    
    const { status } = processingStatus
    
    if (status === 'completed' || status === 'facts_completed') {
      return {
        icon: <Check className="size-5 text-primary" />,
        title: "Erfolgreich verarbeitet",
        message: "Das Dokument wurde zu Ihrer Wissensdatenbank hinzugefügt.",
        bgClass: "bg-muted/20 border-border"
      }
    }
    
    if (status === 'failed' || status === 'facts_failed') {
      return {
        icon: <AlertCircle className="size-5 text-muted-foreground" />,
        title: "Verarbeitung fehlgeschlagen",
        message: processingStatus.error || "Ein Fehler ist aufgetreten.",
        bgClass: "bg-muted/20 border-border"
      }
    }
    
    // Mehr Details für bessere User Experience
    if (status === 'processing') {
      return {
        icon: <Loader2 className="size-5 animate-spin text-primary" />,
        title: "Wird verarbeitet...",
        message: `Das Dokument wird vom Server analysiert und verarbeitet. ${processingStatus.message || ''}`,
        bgClass: "bg-muted border-border"
      }
    }
    
    return {
      icon: <Loader2 className="size-5 animate-spin text-primary" />,
      title: "Wird hochgeladen...",
      message: "Das Dokument wird hochgeladen und vorbereitet.",
      bgClass: "bg-muted border-border"
    }
  }

  const statusInfo = getStatusMessage()
  // 🔒 Button bleibt disabled bis ALLE Dateien vollständig verarbeitet sind
  const isProcessing = isPolling || loading || isFolderPolling
  const isCompleted = processingStatus?.status === 'completed' || processingStatus?.status === 'facts_completed'

  return (
    <div className="space-y-4 min-h-0 overflow-y-auto">
      {/* Source Type Toggle */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            sourceType === "file"
              ? "bg-primary text-foreground"
              : "bg-muted text-muted-foreground hover:bg-secondary/80"
          }`}
          onClick={() => {
            setSourceType("file")
            clearTextContent()
            clearFolder()
          }}
        >
          <FileUp className="size-4" />
          <span>Datei</span>
        </button>
        <button
          type="button"
          className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            sourceType === "folder"
              ? "bg-primary text-foreground"
              : "bg-muted text-muted-foreground hover:bg-secondary/80"
          }`}
          onClick={() => {
            setSourceType("folder")
            clearTextContent()
            clearFile()
          }}
        >
          <FolderOpen className="size-4" />
          <span>Ordner</span>
        </button>
        <button
          type="button"
          className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            sourceType === "text"
              ? "bg-primary text-foreground"
              : "bg-muted text-muted-foreground hover:bg-secondary/80"
          }`}
          onClick={() => {
            setSourceType("text")
            clearFile()
            clearFolder()
          }}
        >
          <FileText className="size-4" />
          <span>Text</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* File Upload */}
        {sourceType === "file" && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Datei
            </label>
            <div 
              className={`flex items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-white/10 bg-card"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {!file ? (
                  <div className="space-y-4">
                  <ArrowUpCircle className={`mx-auto size-12 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="text-center">
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer text-primary hover:text-primary transition-colors"
                      >
                      <span className="font-medium">
                          {isDragging ? "Datei hier ablegen" : "Datei hochladen"}
                        </span>
                        <input
                          id="file-upload"
                          type="file"
                          className="sr-only"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          accept=".pdf,.doc,.docx,.txt,.md,.html"
                        />
                    </label>
                    {!isDragging && <span className="text-muted-foreground"> oder per Drag & Drop</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                    PDF, DOC, DOCX, TXT, MD, HTML
                    </p>
                  </div>
              ) : (
                <div className="flex w-full items-center justify-between bg-card border border-white/8 p-4 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="size-6 text-primary" />
                    <span className="text-sm text-muted-foreground">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="rounded-full p-1 hover:bg-muted"
                  >
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Folder Upload */}
        {sourceType === "folder" && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Ordner
            </label>
            <div
              className={`flex items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-white/10 bg-card"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {!files.length ? (
                <div className="space-y-4">
                  <FolderOpen className={`mx-auto size-12 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="text-center">
                    <label
                      htmlFor="folder-upload"
                      className="cursor-pointer text-primary hover:text-primary transition-colors"
                    >
                      <span className="font-medium">
                        {isDragging ? "Ordner hier ablegen" : "Ordner hochladen"}
                      </span>
                      <input
                        id="folder-upload"
                        type="file"
                        className="sr-only"
                        multiple
                        webkitdirectory=""
                        onChange={handleFolderChange}
                      />
                    </label>
                    {!isDragging && <span className="text-muted-foreground"> oder per Drag & Drop</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PDF, DOC, DOCX, TXT, MD, HTML (max. 50 Dateien, 200MB pro Datei)
                  </p>
                </div>
              ) : (
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between bg-card border border-white/8 p-4 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-6 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{folderName}</p>
                        <p className="text-xs text-muted-foreground">{files.length} Dateien ausgewählt</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearFolder}
                      className="rounded-full p-1 hover:bg-muted"
                    >
                      <X className="size-4 text-muted-foreground" />
                    </button>
                  </div>

                  {/* File list preview */}
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {files.slice(0, 10).map((file, index) => (
                      <div key={index} className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-white/10 p-2 rounded">
                        <FileText className="size-3" />
                        <span className="truncate">{file.name}</span>
                        <span className="ml-auto">{(file.size / 1024 / 1024).toFixed(2)}MB</span>
                      </div>
                    ))}
                    {files.length > 10 && (
                      <div className="text-xs text-muted-foreground text-center py-1">
                        ... und {files.length - 10} weitere Dateien
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Input */}
        {sourceType === "text" && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Text
            </label>
            <div className="relative">
              <textarea
                rows={8}
                className="w-full min-h-[120px] max-h-[50vh] resize-y rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                placeholder="Fügen Sie hier Ihren Text ein..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
              />
              {textContent && (
                <button
                  type="button"
                  onClick={clearTextContent}
                  className="absolute right-2 top-2 rounded-full p-1 hover:bg-muted"
                >
                  <X className="size-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Name Input */}
        {(sourceType === "text" || (sourceType === "file" && file)) && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Bezeichnung {sourceType === "text" ? <span className="text-primary">*</span> : "(optional)"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className={`w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none pr-10 ${
                  titleError
                    ? "border-muted-foreground/50 bg-muted/10 focus:border-muted-foreground"
                    : "border-border bg-card focus:border-primary"
                }`}
                placeholder={
                  sourceType === "file"
                    ? "Dateiname (optional)"
                    : "Name für diesen Text (erforderlich)"
                }
                required={sourceType === "text"}
              />
              {/* Title validation feedback */}
              {sourceType === "text" && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  {isCheckingTitle && (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  )}
                  {!isCheckingTitle && sourceName.trim() && !titleError && (
                    <Check className="size-4 text-primary" />
                  )}
                </div>
              )}
            </div>
            {/* Error message below */}
            {sourceType === "text" && titleError && (
              <div className="mt-1">
                <p className="text-xs text-muted-foreground">{titleError}</p>
              </div>
            )}
          </div>
        )}

        {/* Status Display - Kompakt */}
        {statusInfo && (
          <div className={`rounded-lg border border-white/8 p-3 ${statusInfo.bgClass}`}>
            <div className="flex items-center gap-2">
              {statusInfo.icon}
              <span className="text-sm font-medium text-foreground">
                {statusInfo.title}
              </span>
            </div>
            {statusInfo.message && (
              <div className="mt-1 text-xs text-muted-foreground">
                {statusInfo.message}
              </div>
            )}
          </div>
        )}

        {/* Error Display - Kompakt */}
        {error && (
          <div className="mt-1">
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          {isCompleted ? (
            <button
              type="button"
              onClick={() => {
                if (sourceType === "file") clearFile()
                else if (sourceType === "folder") clearFolder()
                else clearTextContent()
              }}
              className="rounded-lg px-8 py-3 font-medium text-foreground bg-primary hover:bg-pink-600"
            >
              <div className="flex items-center gap-2">
                <Check className="size-4" />
                <span>Fertig</span>
              </div>
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                isProcessing ||
                (sourceType === "file" && !file) ||
                (sourceType === "folder" && files.length === 0) ||
                (sourceType === "text" && (!textContent.trim() || !sourceName.trim() || !!titleError || isCheckingTitle))
              }
              className={`rounded-lg px-8 py-3 font-medium text-foreground ${
                isProcessing ||
                (sourceType === "file" && !file) ||
                (sourceType === "folder" && files.length === 0) ||
                (sourceType === "text" && (!textContent.trim() || !sourceName.trim() || !!titleError || isCheckingTitle))
                  ? "bg-muted opacity-50 cursor-not-allowed"
                  : "bg-primary hover:bg-pink-600"
              }`}
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Verarbeite...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Upload className="size-4" />
                  <span>Hochladen</span>
                </div>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}