export * from "./announcement"
export * from "./assistant-retrieval-item"
export * from "./chat"
export * from "./chat-file"
export * from "./chat-message"
export * from "./collection-file"
export * from "./content-type"
export * from "./file-item-chunk"
export * from "./images/assistant-image"
export * from "./images/message-image"
export * from "./images/workspace-image"
export * from "./llms"
export * from "./models"
export * from "./sharing"
export * from "./sidebar-data"

export type RequestId = string

export type UploadProgressStage =
  | "extraction"
  | "chunking"
  | "facts"
  | "embedding"
  | "saving"
  | "completed"

export interface KnowledgeUploadProgress {
  stage: UploadProgressStage
  percentComplete: number
  message: string
  currentItem?: number
  totalItems?: number
}

export interface UploadStatus {
  status: boolean
  completed: boolean
  progress: KnowledgeUploadProgress
  logs: string[]
  lastLogIndex: number
  result?: any
}
