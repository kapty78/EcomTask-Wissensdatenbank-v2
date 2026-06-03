import OpenAI from "openai"
import { KnowledgeItemChunk } from "@/types/knowledge"
import { generateLocalEmbedding } from "@/lib/generate-local-embedding"

// Simplified function to initialize OpenAI client using environment variable
function initializeOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error("OpenAI API Key not found in environment variables.")
    throw new Error("OpenAI API Key is missing.")
  }
  // Removed Azure logic for now
  return new OpenAI({
    apiKey: apiKey
    // organization: process.env.OPENAI_ORGANIZATION_ID // Add if needed
  })
}

/**
 * Function overloads for generateEmbeddings
 */
// Overload for a single string query
export async function generateEmbeddings(
  query: string,
  provider?: "openai" | "local"
): Promise<number[]>
// Overload for an array of chunks
export async function generateEmbeddings(
  chunks: KnowledgeItemChunk[],
  provider: "openai" | "local"
): Promise<(number[] | null)[]>
// Implementation that handles both cases
export async function generateEmbeddings(
  input: string | KnowledgeItemChunk[],
  provider: "openai" | "local" = "openai"
): Promise<number[] | (number[] | null)[]> {
  // Case 1: String input (single query)
  if (typeof input === "string") {
    const query = input
    console.log(
      `[Embedding Lib] Generating embedding for string query using ${provider}...`
    )

    if (provider === "openai") {
      try {
        const openai = initializeOpenAIClient()

        console.log(
          `[Embedding Lib] Requesting OpenAI embedding for query text...`
        )
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: query
        })

        const embedding = response.data[0].embedding
        console.log(
          `[Embedding Lib] Received OpenAI embedding with dimension: ${embedding.length}`
        )
        return embedding
      } catch (error: any) {
        console.error(
          "[Embedding Lib] Failed to generate OpenAI embedding for query:",
          error
        )
        throw new Error(`OpenAI embedding generation failed: ${error.message}`)
      }
    } else if (provider === "local") {
      try {
        const embedding = await generateLocalEmbedding(query)
        console.log(
          `[Embedding Lib] Generated local embedding with dimension: ${embedding.length}`
        )
        return embedding as number[]
      } catch (error: any) {
        console.error(
          "[Embedding Lib] Failed to generate local embedding for query:",
          error
        )
        throw new Error(`Local embedding generation failed: ${error.message}`)
      }
    }

    console.error(
      `[Embedding Lib] Unsupported embeddings provider: ${provider}`
    )
    throw new Error(`Unsupported embeddings provider: ${provider}`)
  }

  // Case 2: Array of chunks
  const chunks = input as KnowledgeItemChunk[]

  if (chunks.length === 0) {
    return []
  }

  console.log(
    `[Embedding Lib] Generating embeddings for ${chunks.length} chunks using ${provider}...`
  )

  if (provider === "openai") {
    try {
      // Initialize OpenAI client using environment variables
      const openai = initializeOpenAIClient()
      const batchSize = 100 // Process in batches
      const allEmbeddings: (number[] | null)[] = []

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize)
        const textsToEmbed = batchChunks.map(chunk => chunk.content)

        console.log(
          `[Embedding Lib] Requesting OpenAI embeddings for batch ${i / batchSize + 1}...`
        )
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: textsToEmbed
        })

        const batchEmbeddings = response.data.map((item: any) => item.embedding)
        allEmbeddings.push(...batchEmbeddings)
        console.log(
          `[Embedding Lib] Received ${batchEmbeddings.length} embeddings for batch.`
        )
      }

      if (allEmbeddings.length !== chunks.length) {
        console.error(
          `[Embedding Lib] OpenAI Embedding count mismatch: Expected ${chunks.length}, Got ${allEmbeddings.length}`
        )
        throw new Error("OpenAI embedding count mismatch.")
      }

      console.log(
        `[Embedding Lib] Successfully generated ${allEmbeddings.length} OpenAI embeddings.`
      )
      return allEmbeddings
    } catch (error: any) {
      console.error(
        "[Embedding Lib] Failed to generate OpenAI embeddings:",
        error
      )
      throw new Error(`OpenAI embedding generation failed: ${error.message}`)
    }
  } else if (provider === "local") {
    try {
      const embeddingPromises = chunks.map(chunk =>
        generateLocalEmbedding(chunk.content).catch(error => {
          console.error(
            `[Embedding Lib] Error generating local embedding for chunk: ${chunk.content.substring(0, 50)}...`,
            error
          )
          return null
        })
      )
      const settledResults = await Promise.allSettled(embeddingPromises)
      const embeddings = settledResults.map(result => {
        if (result.status === "fulfilled") {
          return result.value as number[] | null
        } else {
          return null
        }
      })
      console.log(
        `[Embedding Lib] Successfully generated/attempted ${embeddings.length} local embeddings.`
      )
      return embeddings
    } catch (error: any) {
      console.error(
        "[Embedding Lib] Failed to generate local embeddings:",
        error
      )
      throw new Error(`Local embedding generation failed: ${error.message}`)
    }
  }

  console.error(`[Embedding Lib] Unsupported embeddings provider: ${provider}`)
  throw new Error(`Unsupported embeddings provider: ${provider}`)
}