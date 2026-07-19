/** @jest-environment node */
import {
  normalizeKnowledgeToolName,
  normalizeKnowledgeTools,
  streamScalewayKnowledgeAgent,
} from '@/lib/knowledge-agent/scaleway-stream';

describe('Scaleway Knowledge-Agent stream', () => {
  it('normalisiert Tool-Schemas auf den GLM-sicheren Kern', () => {
    const [tool] = normalizeKnowledgeTools([{
      type: 'function',
      function: {
        name: 'get_chunk_details',
        strict: true,
        parameters: {
          type: 'object',
          properties: { chunk_ids: { type: 'array', items: { type: 'string' } } },
          required: ['chunk_ids'],
          anyOf: [{ required: ['chunk_ids'] }],
        },
      },
    }])!;

    expect(tool.function.strict).toBeUndefined();
    expect(tool.function.parameters.required).toEqual(['chunk_ids']);
    expect(tool.function.parameters.anyOf).toBeUndefined();
  });

  it('entfernt den gelegentlichen functions.-Namespace', () => {
    expect(normalizeKnowledgeToolName('functions.search_kb_text')).toBe('search_kb_text');
  });

  it('nutzt Chat Completions mit glm-5.2 und normalisierten Tools', async () => {
    async function* chunks() {
      yield {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'functions.search_kb_text', arguments: '{}' } }] } }],
      };
    }
    const create = jest.fn().mockResolvedValue(chunks());
    const client = { chat: { completions: { create } } } as any;

    const received: any[] = [];
    for await (const chunk of streamScalewayKnowledgeAgent(client, {
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'Suche' }],
      tools: [{ type: 'function', function: { name: 'search_kb_text', parameters: { type: 'object', properties: {} } } }],
    })) received.push(chunk);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'glm-5.2', stream: true, tool_choice: 'auto' }),
      expect.any(Object)
    );
    expect(received[0].choices[0].delta.tool_calls[0].function.name).toBe('search_kb_text');
  });
});
