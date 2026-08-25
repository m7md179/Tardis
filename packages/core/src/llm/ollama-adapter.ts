import type { ToolDefinition } from '@tardis/shared';
import { LLMProviderError } from './provider.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './provider.js';

// ─── Internal OpenAI-format types used only in this adapter ─────────────────

interface OllamaToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string; // required on role: 'tool' messages
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaRequestBody {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream: false;
  temperature?: number;
  max_tokens?: number;
}

interface OllamaResponseBody {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OllamaToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ─── Conversion helpers ──────────────────────────────────────────────────────

/**
 * Ollama's chat API takes a plain string plus a separate `images` array, not
 * OpenAI-style content parts. TARDIS's multimodal path targets the
 * OpenAI-compatible endpoint, so rather than half-supporting images here we
 * flatten the text and refuse loudly if an image is present — silently dropping
 * a photo would produce an answer about nothing.
 */
function flattenContent(content: LLMMessage['content'], role: string): string | null {
  if (content === null || typeof content === 'string') return content;
  if (content.some((p) => p.type === 'image_url')) {
    throw new LLMProviderError(
      'ollama',
      'IMAGES_UNSUPPORTED',
      `The ollama adapter cannot send images (in a "${role}" message). ` +
        'Use an OpenAI-compatible provider for multimodal requests.'
    );
  }
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function toOllamaMessage(msg: LLMMessage): OllamaMessage {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      content: flattenContent(msg.content, msg.role),
      // Use name as tool_call_id — the agent loop sets name to the tool name.
      // Ollama is lenient about this matching exactly for local models.
      tool_call_id: msg.name ?? 'unknown',
    };
  }

  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    return {
      role: 'assistant',
      content: flattenContent(msg.content, msg.role),
      tool_calls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }

  return { role: msg.role, content: flattenContent(msg.content, msg.role) };
}

function toOllamaTool(tool: ToolDefinition): OllamaTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseOllamaResponse(body: OllamaResponseBody): LLMResponse {
  const choice = body.choices[0];
  if (!choice) {
    throw new LLMProviderError('ollama', 'EMPTY_RESPONSE', 'Ollama returned no choices');
  }

  const toolCalls = choice.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const tc = toolCalls[0];
    if (!tc) {
      throw new LLMProviderError('ollama', 'EMPTY_RESPONSE', 'Ollama returned empty tool_calls');
    }

    let toolArgs: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(tc.function.arguments);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object');
      }
      toolArgs = parsed as Record<string, unknown>;
    } catch {
      throw new LLMProviderError(
        'ollama',
        'INVALID_TOOL_ARGS',
        `Failed to parse tool arguments: ${tc.function.arguments}`
      );
    }

    const response: LLMResponse = {
      type: 'tool_call',
      toolName: tc.function.name,
      toolArgs,
      toolCallId: tc.id,
    };
    if (body.usage) {
      response.usage = {
        promptTokens: body.usage.prompt_tokens,
        completionTokens: body.usage.completion_tokens,
      };
    }
    return response;
  }

  const textResponse: LLMResponse = {
    type: 'text',
    text: choice.message.content ?? '',
  };
  if (body.usage) {
    textResponse.usage = {
      promptTokens: body.usage.prompt_tokens,
      completionTokens: body.usage.completion_tokens,
    };
  }
  return textResponse;
}

// ─── OllamaAdapter ───────────────────────────────────────────────────────────

export interface OllamaAdapterConfig {
  /** Base URL of the Ollama server. Defaults to http://localhost:11434 */
  baseUrl?: string;
  /** Model name to use, e.g. "qwen3:4b" */
  model: string;
  /** Default temperature (0–2). Defaults to 0.7 */
  temperature?: number;
}

export class OllamaAdapter implements LLMProvider {
  readonly name = 'ollama';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly defaultTemperature: number;

  constructor(config: OllamaAdapterConfig) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = config.model;
    this.defaultTemperature = config.temperature ?? 0.7;
  }

  async chat(params: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const body: OllamaRequestBody = {
      model: this.model,
      messages: params.messages.map(toOllamaMessage),
      stream: false,
      temperature: params.temperature ?? this.defaultTemperature,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map(toOllamaTool);
    }
    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const responseBody = await this.post(body);
    return parseOllamaResponse(responseBody);
  }

  async generate(params: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const body: OllamaRequestBody = {
      model: this.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      stream: false,
      temperature: params.temperature ?? this.defaultTemperature,
    };

    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const responseBody = await this.post(body);
    const choice = responseBody.choices[0];
    return choice?.message.content ?? '';
  }

  private async post(body: OllamaRequestBody): Promise<OllamaResponseBody> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMProviderError(
        'ollama',
        'CONNECTION_REFUSED',
        `Cannot connect to Ollama at ${this.baseUrl}: ${msg}`
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      throw new LLMProviderError(
        'ollama',
        `HTTP_${response.status}`,
        `Ollama returned ${response.status}: ${detail}`
      );
    }

    try {
      return (await response.json()) as OllamaResponseBody;
    } catch {
      throw new LLMProviderError('ollama', 'INVALID_JSON', 'Ollama returned non-JSON response');
    }
  }
}
