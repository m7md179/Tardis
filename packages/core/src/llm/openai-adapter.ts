import type { ToolDefinition } from '@tardis/shared';
import { LLMProviderError } from './provider.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './provider.js';

// ─── Internal OpenAI-format types ────────────────────────────────────────────

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string; // required on role: 'tool' messages
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  max_tokens?: number;
}

interface OpenAIResponseBody {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OpenAIErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

// ─── Conversion helpers ──────────────────────────────────────────────────────

function toOpenAIMessage(msg: LLMMessage): OpenAIMessage {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      content: msg.content,
      tool_call_id: msg.name ?? 'unknown',
    };
  }

  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    return {
      role: 'assistant',
      content: msg.content,
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

  return { role: msg.role, content: msg.content };
}

function toOpenAITool(tool: ToolDefinition): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseResponse(body: OpenAIResponseBody, providerName: string): LLMResponse {
  const choice = body.choices[0];
  if (!choice) {
    throw new LLMProviderError(providerName, 'EMPTY_RESPONSE', `${providerName} returned no choices`);
  }

  const toolCalls = choice.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const tc = toolCalls[0];
    if (!tc) {
      throw new LLMProviderError(
        providerName,
        'EMPTY_RESPONSE',
        `${providerName} returned empty tool_calls`
      );
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
        providerName,
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

// ─── OpenAIAdapter ────────────────────────────────────────────────────────────

export interface OpenAIAdapterConfig {
  /**
   * Base URL of the OpenAI-compatible API.
   * Defaults to https://api.openai.com/v1
   *
   * Examples:
   *   - OpenAI:     https://api.openai.com/v1
   *   - Groq:       https://api.groq.com/openai/v1
   *   - Together:   https://api.together.xyz/v1
   *   - LM Studio:  http://localhost:1234/v1
   *   - Ollama:     http://localhost:11434/v1
   */
  baseUrl?: string;
  /** API key for authentication. Pass an empty string for local endpoints that don't require auth. */
  apiKey: string;
  /** Model name, e.g. "gpt-4o-mini", "llama-3.1-8b-instant" (Groq), "mistralai/Mixtral-8x7B" (Together) */
  model: string;
  /** Default temperature (0–2). Defaults to 0.7 */
  temperature?: number;
}

export class OpenAIAdapter implements LLMProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultTemperature: number;

  constructor(config: OpenAIAdapterConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultTemperature = config.temperature ?? 0.7;
    // Derive name from base URL for tracing (e.g. "openai", "groq", "together")
    this.name = deriveProviderName(this.baseUrl);
  }

  async chat(params: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const body: OpenAIRequestBody = {
      model: this.model,
      messages: params.messages.map(toOpenAIMessage),
      temperature: params.temperature ?? this.defaultTemperature,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map(toOpenAITool);
    }
    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const responseBody = await this.post(body);
    return parseResponse(responseBody, this.name);
  }

  async generate(params: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const body: OpenAIRequestBody = {
      model: this.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: params.temperature ?? this.defaultTemperature,
    };

    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const responseBody = await this.post(body);
    const choice = responseBody.choices[0];
    return choice?.message.content ?? '';
  }

  private async post(body: OpenAIRequestBody): Promise<OpenAIResponseBody> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMProviderError(
        this.name,
        'CONNECTION_REFUSED',
        `Cannot connect to ${this.name} at ${this.baseUrl}: ${msg}`
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = (await response.json()) as OpenAIErrorBody;
        detail = errorBody.error?.message ?? (await response.clone().text());
      } catch {
        try {
          detail = await response.text();
        } catch {
          // ignore
        }
      }
      throw new LLMProviderError(
        this.name,
        `HTTP_${response.status}`,
        `${this.name} returned ${response.status}: ${detail}`
      );
    }

    try {
      return (await response.json()) as OpenAIResponseBody;
    } catch {
      throw new LLMProviderError(this.name, 'INVALID_JSON', `${this.name} returned non-JSON response`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveProviderName(baseUrl: string): string {
  if (baseUrl.includes('openai.com')) return 'openai';
  if (baseUrl.includes('groq.com')) return 'groq';
  if (baseUrl.includes('together.xyz')) return 'together';
  if (baseUrl.includes('anthropic.com')) return 'anthropic';
  if (baseUrl.includes('googleapis.com') || baseUrl.includes('generativelanguage')) return 'google';
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'local';
  return 'openai-compatible';
}
