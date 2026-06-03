export interface N8nChunkPayload {
  document: {
    title: string
    fileName?: string
    knowledgeBaseId: string
    workspaceId: string | null
    userId: string
    sourceType: 'file' | 'text'
  }
  chunks: Array<{
    index: number
    content: string
    tokens?: number
    metadata?: Record<string, any>
  }>
}

export async function sendChunksToN8n(
  webhookUrl: string,
  payload: N8nChunkPayload,
  options?: { token?: string }
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })

  return res
}


