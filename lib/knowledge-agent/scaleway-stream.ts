import type OpenAI from "openai"

type ToolSchema = Record<string, any>

const SAFE_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "items", "enum", "description", "default",
  "additionalProperties", "minimum", "maximum", "minLength", "maxLength",
  "minItems", "maxItems", "format",
])

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema)
  if (!isObject(schema)) return schema
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!SAFE_SCHEMA_KEYS.has(key)) continue
    if (key === "properties" && isObject(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, sanitizeSchema(child)])
      )
    } else if (key === "items") {
      out.items = sanitizeSchema(value)
    } else {
      out[key] = value
    }
  }
  return out
}

export function normalizeKnowledgeTools(tools?: ToolSchema[]): ToolSchema[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => {
    const fn = tool.function ?? tool
    return {
      type: "function",
      function: {
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        parameters: sanitizeSchema(fn.parameters ?? { type: "object", properties: {} }),
      },
    }
  })
}

export function normalizeKnowledgeToolName(name: string): string {
  return name.replace(/^functions\./, "")
}

export type ScalewayAgentStreamParams = {
  model: string
  messages: any[]
  tools?: ToolSchema[]
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>
  signal?: AbortSignal
}

/** Streamt Scaleway/GLM und behaelt den bestehenden Chat-Chunk-Vertrag. */
export async function* streamScalewayKnowledgeAgent(
  client: OpenAI,
  params: ScalewayAgentStreamParams
): AsyncGenerator<any> {
  const tools = normalizeKnowledgeTools(params.tools)
  const request: Record<string, any> = {
    model: params.model,
    messages: params.messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 8192,
  }
  if (tools) {
    request.tools = tools
    request.tool_choice = params.toolChoice ?? "auto"
  }

  const stream: any = await client.chat.completions.create(request as any, {
    signal: params.signal,
  })
  for await (const chunk of stream) {
    const calls = chunk?.choices?.[0]?.delta?.tool_calls
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (call?.function?.name) {
          call.function.name = normalizeKnowledgeToolName(call.function.name)
        }
      }
    }
    yield chunk
  }
}
