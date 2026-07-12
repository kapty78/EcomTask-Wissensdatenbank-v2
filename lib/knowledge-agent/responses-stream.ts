/**
 * responses-stream.ts — Adapter Chat-Completions → /v1/responses
 * =============================================================================
 * gpt-5.6-terra ist ein Reasoning-Modell und lehnt Function-Tools auf
 * /v1/chat/completions ab ("Function tools with reasoning_effort are not
 * supported ... use /v1/responses or set reasoning_effort to 'none'").
 *
 * Damit der Knowledge-Agent Tools UND Reasoning behaelt, laeuft der tool-
 * fuehrende Haupt-Stream jetzt ueber /v1/responses. Dieser Adapter kapselt den
 * Endpoint-Unterschied an EINER Stelle: er nimmt die bestehenden Chat-Parameter
 * (messages/tools im Chat-Format) entgegen und emittiert SYNTHETISCHE
 * Chat-Completion-Chunks — exakt die Form, die der Stream-Loop schon liest
 * (`chunk.choices[0].delta.content` + `delta.tool_calls[].index` +
 * `chunk.usage`). So bleibt die Loop-Logik unveraendert; pro Call-Site aendert
 * sich nur der eine `create()`-Aufruf.
 */
import type OpenAI from "openai"

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high"

export interface StreamAgentParams {
  model: string
  messages: any[]
  tools?: any[]
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>
  /** Default: env KNOWLEDGE_AGENT_REASONING_EFFORT ?? AGENT_REASONING_EFFORT ?? "medium". */
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
}

const DEFAULT_EFFORT: ReasoningEffort =
  ((process.env.KNOWLEDGE_AGENT_REASONING_EFFORT || process.env.AGENT_REASONING_EFFORT || "")
    .trim() as ReasoningEffort) || "medium"

/** Nur die gpt-5.x- und o-Serie unterstuetzen den reasoning-Parameter. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model)
}

/** Chat-Tools `{type,function:{...}}` → Responses-Tools `{type:"function",name,...}`. */
export function toResponsesTools(tools?: any[]): any[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => {
    const fn = t?.function ?? t
    return {
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
      ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
    }
  })
}

/** Chat-content-Teil → Responses-content-Teil (Rolle entscheidet input_/output_). */
function mapContentPart(part: any, role: string): any {
  if (typeof part === "string") {
    return { type: role === "assistant" ? "output_text" : "input_text", text: part }
  }
  if (part?.type === "text") {
    return { type: role === "assistant" ? "output_text" : "input_text", text: part.text }
  }
  if (part?.type === "image_url") {
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url
    return { type: "input_image", image_url: url }
  }
  return part
}

/**
 * Chat-messages → Responses-input-Items.
 * - assistant.tool_calls → je ein {type:"function_call",call_id,name,arguments}
 * - role:"tool"          → {type:"function_call_output",call_id,output}
 * - sonst                → {role,content} (String bleibt String)
 */
export function toResponsesInput(messages: any[]): any[] {
  const input: any[] = []
  for (const msg of messages) {
    if (!msg) continue
    if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output:
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      })
      continue
    }

    const hasText =
      msg.content != null &&
      !(typeof msg.content === "string" && msg.content.length === 0)
    if (hasText) {
      const content = Array.isArray(msg.content)
        ? msg.content.map((p: any) => mapContentPart(p, msg.role))
        : msg.content
      input.push({ role: msg.role, content })
    }

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments ?? "",
        })
      }
    }
  }
  return input
}

/** Responses-usage → Chat-usage (die Loops/Telemetry lesen prompt_/completion_tokens). */
export function mapUsage(u: any): any {
  if (!u) return undefined
  return {
    prompt_tokens: u.input_tokens ?? 0,
    completion_tokens: u.output_tokens ?? 0,
    total_tokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    ...(u.input_tokens_details ? { prompt_tokens_details: u.input_tokens_details } : {}),
    ...(u.output_tokens_details ? { completion_tokens_details: u.output_tokens_details } : {}),
  }
}

/**
 * Streamt /v1/responses und yieldet Chat-Completion-Chunk-kompatible Objekte.
 * Aufruf ersetzt `await openai.chat.completions.create({...,stream:true})`
 * 1:1 — der `for await`-Loop dahinter bleibt unveraendert.
 */
export async function* streamAgentResponses(
  openai: OpenAI,
  params: StreamAgentParams
): AsyncGenerator<any> {
  const effort = params.reasoningEffort ?? DEFAULT_EFFORT
  const request: Record<string, any> = {
    model: params.model,
    input: toResponsesInput(params.messages),
    stream: true,
  }
  const tools = toResponsesTools(params.tools)
  if (tools) {
    request.tools = tools
    request.tool_choice = params.toolChoice ?? "auto"
  }
  if (isReasoningModel(params.model) && effort !== "none") {
    request.reasoning = { effort }
  }

  const stream: any = await openai.responses.create(request as any, {
    signal: params.signal,
  })

  const idxByItem = new Map<string, number>()
  let nextIdx = 0

  for await (const ev of stream) {
    switch (ev.type) {
      case "response.output_text.delta":
        if (ev.delta) yield { choices: [{ delta: { content: ev.delta } }] }
        break

      case "response.output_item.added":
        if (ev.item?.type === "function_call") {
          const idx = nextIdx++
          idxByItem.set(ev.item.id, idx)
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: idx,
                      id: ev.item.call_id,
                      type: "function",
                      function: { name: ev.item.name, arguments: ev.item.arguments || "" },
                    },
                  ],
                },
              },
            ],
          }
        }
        break

      case "response.function_call_arguments.delta": {
        const idx = idxByItem.get(ev.item_id)
        if (idx === undefined || !ev.delta) break
        yield {
          choices: [
            { delta: { tool_calls: [{ index: idx, function: { arguments: ev.delta } }] } },
          ],
        }
        break
      }

      case "response.completed":
        yield { choices: [{ delta: {} }], usage: mapUsage(ev.response?.usage) }
        break

      case "response.failed":
      case "response.incomplete":
        throw new Error(
          ev.response?.error?.message ||
            `Responses-Stream endete mit Status ${ev.response?.status || ev.type}`
        )
      case "error":
        throw new Error(ev.message || "Responses-Stream-Fehler")
    }
  }
}
