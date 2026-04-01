"use client"

import React, { useState, useRef, useEffect } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
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

const PIPELINE_PROXY_BASE = "/api/wissensbasis-pipeline"
const PIPELINE_BUCKET = process.env.NEXT_PUBLIC_WISSENSBASIS_BUCKET || "documents"
const PIPELINE_USE_SIGNED_URLS =
  process.env.NEXT_PUBLIC_WISSENSBASIS_USE_SIGNED_URLS === "true"

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  pending: "Wartend",
  processing: "In Verarbeitung",
  done: "Fertig",
  failed: "Fehlgeschlagen"
}

function mapPipelineStatus(status?: string): string {
  if (!status) return "Unbekannt"
  return PIPELINE_STATUS_LABELS[status] || status
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
  ".rtf": "application/rtf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff"
}

function resolveUploadMimeType(file: File): string | undefined {
  if (file.type && file.type.trim().length > 0) return file.type
  const ext = `.${file.name.split(".").pop()?.toLowerCase() || ""}`
  return EXTENSION_MIME_MAP[ext]
}

function sanitizeStorageSegment(segment: string): string {
  const normalized = segment
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
  const safe = normalized
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .trim()

  if (!safe) return "file"
  if (/^\.+$/.test(safe)) return "file"
  return safe.slice(0, 180)
}

function buildSafeStoragePath(
  userId: string,
  jobId: string,
  relativePath: string,
  index: number
): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const segments = cleaned.split("/").filter(Boolean)
  const safeSegments = (segments.length > 0 ? segments : [`file-${index + 1}`]).map(
    sanitizeStorageSegment
  )
  return `${userId}/${jobId}/${safeSegments.join("/")}`
}

const LEGACY_ALLOWED_TYPES = [".pdf", ".doc", ".docx", ".txt", ".md", ".html"]
const PIPELINE_ALLOWED_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".html",
  ".eml",
  ".msg",
  ".rtf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".tiff",
  ".tif"
]

interface KnowledgeItemUploadProps {
  userId: string
  knowledgeBaseId: string
  onUploadComplete: () => void
  onCancel: () => void
}

export const KnowledgeItemUploadSimple: React.FC<KnowledgeItemUploadProps> = ({
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
  const [pipelineJobId, setPipelineJobId] = useState<string | null>(null)
  const [isFolderPolling, setIsFolderPolling] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadDocument, getDocumentStatus, loading } = useCursorDocuments()
  const supabase = getSupabaseClient()
  const pipelineImportingRef = useRef(false)
  const importedPipelineJobIdRef = useRef<string | null>(null)
  const uploadDocumentRef = useRef(uploadDocument)
  const onUploadCompleteRef = useRef(onUploadComplete)

  useEffect(() => {
    uploadDocumentRef.current = uploadDocument
  }, [uploadDocument])

  useEffect(() => {
    onUploadCompleteRef.current = onUploadComplete
  }, [onUploadComplete])

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
    let containsDirectory = false

    // Check if we have DataTransferItems (better for folder detection)
    if (items && items.length > 0) {
      // Process all items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            if (entry.isDirectory) {
              containsDirectory = true
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
    const isFolderDrop =
      containsDirectory ||
      files.length > 1 ||
      files.some((f) => (f.webkitRelativePath || "").includes("/"))
    const allowedTypes = isFolderDrop ? PIPELINE_ALLOWED_TYPES : LEGACY_ALLOWED_TYPES
    const maxFileSize = (isFolderDrop ? 200 : 50) * 1024 * 1024 // 200MB for folder, 50MB for single
    const maxFileSizeMB = Math.round(maxFileSize / (1024 * 1024))
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
        invalidFiles.push({ name: file.name, reason: `Datei zu groß: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max. ${maxFileSizeMB}MB)` })
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
    if (isFolderDrop || filesToProcess.length > 1) {
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
    setIsFolderPolling(false)
    setPipelineJobId(null)
    pipelineImportingRef.current = false
    importedPipelineJobIdRef.current = null
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
      const allowedTypes = PIPELINE_ALLOWED_TYPES
      const maxFileSize = 200 * 1024 * 1024 // 200MB per file
      const maxFileSizeMB = Math.round(maxFileSize / (1024 * 1024))
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
          invalidFiles.push({ name: file.name, reason: `Datei zu groß: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max. ${maxFileSizeMB}MB)` })
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

        // Stop polling when finished
        if (status.status === 'completed' || status.status === 'failed' || 
            status.status === 'facts_completed' || status.status === 'facts_failed') {
          setIsPolling(false)
          
          // Auto-clear on success
          if (status.status === 'completed' || status.status === 'facts_completed') {
            setTimeout(() => {
              if (sourceType === 'file') clearFile()
              else if (sourceType === 'text') clearTextContent()
              else clearFolder()
              onUploadCompleteRef.current()
            }, 2000)
          }
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
    if (!isFolderPolling || !pipelineJobId) return

    const importPipelineResultToKnowledgeBase = async () => {
      if (!pipelineJobId) return

      setProcessingStatus({
        document_id: "folder-upload",
        status: "processing",
        progress: 90,
        message: "Ergebnis-PDF wird geladen..."
      })

      const response = await fetch(`${PIPELINE_PROXY_BASE}/jobs/${pipelineJobId}/result`)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data?.detail || `PDF-Download fehlgeschlagen (${response.status})`
        )
      }

      const blob = await response.blob()
      const baseName =
        folderName
          ?.split("/")
          .filter(Boolean)
          .pop() || "Wissenstext"

      const uploadTitle = `${baseName} Wissenstext`
      const resultPdf = new File([blob], `${uploadTitle}.pdf`, { type: "application/pdf" })

      setProcessingStatus({
        document_id: "folder-upload",
        status: "uploading",
        progress: 95,
        message: "PDF wird in die Wissensdatenbank hochgeladen..."
      })

      const documentId = await uploadDocumentRef.current({
        file: resultPdf,
        title: uploadTitle,
        knowledge_base_id: knowledgeBaseId
      })

      setProcessingStatus({
        document_id: documentId,
        status: "uploading",
        progress: 0,
        message: "PDF hochgeladen. Verarbeitung in der Wissensdatenbank läuft..."
      })

      setCurrentDocumentId(documentId)
      setIsPolling(true)
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`${PIPELINE_PROXY_BASE}/jobs/${pipelineJobId}`)
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(data?.detail || `Status-Request fehlgeschlagen (${response.status})`)
        }

        const status = data?.status as string | undefined

        if (status === "pending") {
          setProcessingStatus({
            document_id: "folder-upload",
            status: "processing",
            progress: 60,
            message: `Status: ${mapPipelineStatus(status)}. Job wartet in der Queue...`
          })
          return
        }

        if (status === "processing") {
          setProcessingStatus({
            document_id: "folder-upload",
            status: "processing",
            progress: 80,
            message: `Status: ${mapPipelineStatus(status)}. Dateien werden verarbeitet...`
          })
          return
        }

        if (status === "failed") {
          setProcessingStatus({
            document_id: "folder-upload",
            status: "failed",
            progress: 0,
            message: `Status: ${mapPipelineStatus(status)}. ${data?.error || "Verarbeitung fehlgeschlagen"}`
          })
          setIsFolderPolling(false)
          return
        }

        if (status === "done") {
          if (
            pipelineImportingRef.current ||
            importedPipelineJobIdRef.current === pipelineJobId
          ) {
            return
          }

          pipelineImportingRef.current = true
          setIsFolderPolling(false)
          try {
            await importPipelineResultToKnowledgeBase()
            importedPipelineJobIdRef.current = pipelineJobId
          } finally {
            pipelineImportingRef.current = false
          }
        }
      } catch (err: any) {
        setError(err.message || "Status-Polling fehlgeschlagen")
        setProcessingStatus({
          document_id: "folder-upload",
          status: "failed",
          progress: 0,
          message: err.message || "Status-Polling fehlgeschlagen"
        })
        setIsFolderPolling(false)
      }
    }

    pollStatus()
    const pollInterval = setInterval(pollStatus, 10000)

    return () => clearInterval(pollInterval)
  }, [isFolderPolling, pipelineJobId, folderName, knowledgeBaseId])

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

      const allowedTypes = LEGACY_ALLOWED_TYPES
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
        const allowedTypes = PIPELINE_ALLOWED_TYPES
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
          title: sourceName || "Text Content",
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

      const clientJobId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`

      importedPipelineJobIdRef.current = null
      pipelineImportingRef.current = false

      const uploadedUrls: string[] = []
      const uploadErrors: string[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const progress = Math.round((i / files.length) * 45) + 5
        const relativePath = file.webkitRelativePath || file.name || `file-${i + 1}`
        const storagePath = buildSafeStoragePath(userId, clientJobId, relativePath, i)

        setProcessingStatus({
          document_id: "folder-upload",
          status: "uploading",
          progress,
          message: `Lade Datei ${i + 1}/${files.length} in Storage hoch: ${file.name}`
        })

        const { error: uploadError } = await supabase.storage
          .from(PIPELINE_BUCKET)
          .upload(storagePath, file, {
            contentType: resolveUploadMimeType(file),
            upsert: true
          })

        if (uploadError) {
          uploadErrors.push(`${file.name}: ${uploadError.message}`)
          continue
        }

        if (PIPELINE_USE_SIGNED_URLS) {
          const { data, error: signedError } = await supabase.storage
            .from(PIPELINE_BUCKET)
            .createSignedUrl(storagePath, 3600)

          if (signedError || !data?.signedUrl) {
            uploadErrors.push(
              `${file.name}: Signed URL konnte nicht erstellt werden`
            )
            continue
          }
          uploadedUrls.push(data.signedUrl)
        } else {
          const { data } = supabase.storage
            .from(PIPELINE_BUCKET)
            .getPublicUrl(storagePath)

          if (!data?.publicUrl) {
            uploadErrors.push(`${file.name}: Public URL fehlt`)
            continue
          }
          uploadedUrls.push(data.publicUrl)
        }
      }

      if (uploadedUrls.length === 0) {
        throw new Error("Keine Dateien konnten hochgeladen werden")
      }

      if (uploadErrors.length > 0) {
        console.warn("Einige Dateien konnten nicht hochgeladen werden:", uploadErrors)
      }

      setProcessingStatus({
        document_id: "folder-upload",
        status: "processing",
        progress: 55,
        message: `Starte Job für ${uploadedUrls.length} Dateien...`
      })

      const startResponse = await fetch(`${PIPELINE_PROXY_BASE}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ file_urls: uploadedUrls })
      })

      const startData = await startResponse.json().catch(() => ({}))

      if (!startResponse.ok) {
        throw new Error(
          startData?.detail || `Job-Start fehlgeschlagen (${startResponse.status})`
        )
      }

      if (!startData?.job_id) {
        throw new Error("Job-ID fehlt in der Antwort")
      }

      setPipelineJobId(startData.job_id)
      setIsFolderPolling(true)

      setProcessingStatus({
        document_id: "folder-upload",
        status: "processing",
        progress: 60,
        message: `Job gestartet (Status: ${mapPipelineStatus(startData.status || "pending")})`
      })

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
        message:
          processingStatus.message ||
          (sourceType === "folder"
            ? "PDF wurde in die Wissensdatenbank übernommen."
            : "Das Dokument wurde zu Ihrer Wissensdatenbank hinzugefügt."),
        bgClass: "bg-muted/20 border-border"
      }
    }
    
    if (status === 'failed' || status === 'facts_failed') {
      return {
        icon: <AlertCircle className="size-5 text-muted-foreground" />,
        title: "Verarbeitung fehlgeschlagen",
        message: processingStatus.error || processingStatus.message || "Ein Fehler ist aufgetreten.",
        bgClass: "bg-muted/20 border-border"
      }
    }
    
    return {
      icon: <Loader2 className="size-5 animate-spin text-pink-500" />,
      title: "Wird verarbeitet...",
      message: processingStatus.message || "Das Dokument wird hochgeladen und vom Server verarbeitet.",
      bgClass: "bg-[#333333] border-gray-600"
    }
  }

  const statusInfo = getStatusMessage()
  // 🔒 Button bleibt disabled bis ALLE Dateien vollständig verarbeitet sind
  const isProcessing = isPolling || loading || isFolderPolling
  const isCompleted = processingStatus?.status === 'completed' || processingStatus?.status === 'facts_completed'

  return (
    <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
      {/* Source Type Toggle */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            sourceType === "file"
              ? "bg-pink-500 text-white"
              : "bg-[#333333] text-gray-300 hover:bg-[#444444]"
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
              ? "bg-pink-500 text-white"
              : "bg-[#333333] text-gray-300 hover:bg-[#444444]"
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
              ? "bg-pink-500 text-white"
              : "bg-[#333333] text-gray-300 hover:bg-[#444444]"
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
            <label className="block text-sm font-medium text-gray-300">
              Datei
            </label>
            <div 
              className={`flex items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragging
                  ? "border-pink-500 bg-pink-500/10"
                  : "border-[#333333] bg-[#252525]"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {!file ? (
                <div className="space-y-4">
                  <ArrowUpCircle className={`mx-auto size-12 ${isDragging ? "text-pink-400" : "text-gray-400"}`} />
                  <div className="text-center">
                    <label
                      htmlFor="file-upload"
                      className="cursor-pointer text-pink-500 hover:text-pink-400 transition-colors"
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
                    {!isDragging && <span className="text-gray-400"> oder per Drag & Drop</span>}
                  </div>
                  <p className="text-xs text-gray-500">
                    PDF, DOC, DOCX, TXT, MD, HTML
                  </p>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between bg-[#2a2a2a] p-4 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="size-6 text-pink-500" />
                    <span className="text-sm text-gray-300">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="rounded-full p-1 hover:bg-[#333333]"
                  >
                    <X className="size-4 text-gray-400" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Folder Upload */}
        {sourceType === "folder" && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Ordner
            </label>
            <div
              className={`flex items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragging
                  ? "border-pink-500 bg-pink-500/10"
                  : "border-[#333333] bg-[#252525]"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {!files.length ? (
                <div className="space-y-4">
                  <FolderOpen className={`mx-auto size-12 ${isDragging ? "text-pink-400" : "text-gray-400"}`} />
                  <div className="text-center">
                    <label
                      htmlFor="folder-upload"
                      className="cursor-pointer text-pink-500 hover:text-pink-400 transition-colors"
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
                        {...({} as { webkitdirectory?: string })}
                      />
                    </label>
                    {!isDragging && <span className="text-gray-400"> oder per Drag & Drop</span>}
                  </div>
                  <p className="text-xs text-gray-500">
                    PDF, DOC, DOCX, TXT, MD, HTML (max. 50 Dateien, 200MB total)
                  </p>
                </div>
              ) : (
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between bg-[#2a2a2a] p-4 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-6 text-pink-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-300">{folderName}</p>
                        <p className="text-xs text-gray-500">{files.length} Dateien ausgewählt</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearFolder}
                      className="rounded-full p-1 hover:bg-[#333333]"
                    >
                      <X className="size-4 text-gray-400" />
                    </button>
                  </div>

                  {/* File list preview */}
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {files.slice(0, 10).map((file, index) => (
                      <div key={index} className="flex items-center gap-2 text-xs text-gray-400 bg-[#1a1a1a] p-2 rounded">
                        <FileText className="size-3" />
                        <span className="truncate">{file.name}</span>
                        <span className="ml-auto">{(file.size / 1024 / 1024).toFixed(2)}MB</span>
                      </div>
                    ))}
                    {files.length > 10 && (
                      <div className="text-xs text-gray-500 text-center py-1">
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
            <label className="block text-sm font-medium text-gray-300">
              Text
            </label>
            <div className="relative">
              <textarea
                rows={8}
                className="w-full rounded-lg border border-[#333333] bg-[#252525] px-4 py-3 text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none"
                placeholder="Fügen Sie hier Ihren Text ein..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
              />
              {textContent && (
                <button
                  type="button"
                  onClick={clearTextContent}
                  className="absolute right-2 top-2 rounded-full p-1 hover:bg-[#333333]"
                >
                  <X className="size-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Name Input */}
        {(sourceType === "text" || (sourceType === "file" && file)) && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Bezeichnung {sourceType === "text" ? <span className="text-pink-500">*</span> : "(optional)"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className={`w-full rounded-lg border px-4 py-2 text-white placeholder-gray-500 focus:outline-none pr-10 ${
                  titleError
                    ? "border-muted-foreground/50 bg-muted/10 focus:border-muted-foreground"
                    : "border-[#333333] bg-[#252525] focus:border-pink-500"
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
                    <Loader2 className="size-4 animate-spin text-pink-500" />
                  )}
                  {!isCheckingTitle && sourceName.trim() && !titleError && (
                    <Check className="size-4 text-pink-500" />
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
          <div className={`rounded-lg border p-3 ${statusInfo.bgClass}`}>
            <div className="flex items-center gap-2">
              {statusInfo.icon}
              <span className="text-sm font-medium text-gray-200">
                {statusInfo.title}
              </span>
            </div>
            {statusInfo.message && (
              <div className="mt-1 text-xs text-gray-300">
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
              className={`rounded-lg px-8 py-3 font-medium text-white ${
                isProcessing ||
                (sourceType === "file" && !file) ||
                (sourceType === "folder" && files.length === 0) ||
                (sourceType === "text" && (!textContent.trim() || !sourceName.trim() || !!titleError || isCheckingTitle))
                  ? "bg-[#333333] opacity-50 cursor-not-allowed"
                  : "bg-pink-500 hover:bg-pink-600"
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
