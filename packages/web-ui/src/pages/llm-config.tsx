import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

interface ModelDiscoveryResponse {
  success: boolean;
  provider: string;
  baseUrl: string;
  models?: string[];
  error?: string;
}

const PROVIDER_PRESETS = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
] as const;

const PROVIDER_PRESET_IDS = new Set<string>(PROVIDER_PRESETS.map((provider) => provider.id));

function getPresetBaseUrl(provider: string): string | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === provider)?.baseUrl;
}

function getProviderMode(provider: string): string {
  return PROVIDER_PRESET_IDS.has(provider) ? provider : 'custom';
}

export function LLMConfigPage() {
  const [config, setConfig] = useState<LLMConfig>({
    provider: 'ollama',
    model: '',
    baseUrl: getPresetBaseUrl('ollama'),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsStatus, setModelsStatus] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<LLMConfig>('/api/config/llm')
      .then(async (data) => {
        if (cancelled) return;
        const nextConfig: LLMConfig = {
          provider: data.provider,
          model: data.model,
          ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
          apiKey: '',
          ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
        };
        setConfig(nextConfig);
        await loadModels(nextConfig, false);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setMessage({ type: 'error', text: e.message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadModels(nextConfig: LLMConfig, clearMessage = true) {
    setLoadingModels(true);
    setModelsStatus('');
    if (clearMessage) setMessage(null);

    try {
      const body: Record<string, unknown> = {
        provider: nextConfig.provider,
      };
      if (nextConfig.model) body['model'] = nextConfig.model;
      if (nextConfig.baseUrl) body['baseUrl'] = nextConfig.baseUrl;
      if (nextConfig.apiKey) body['apiKey'] = nextConfig.apiKey;
      if (nextConfig.temperature !== undefined) body['temperature'] = nextConfig.temperature;

      const result = await apiFetch<ModelDiscoveryResponse>('/api/config/llm/models', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const models = result.models ?? [];
      setAvailableModels(models);
      setModelsStatus(
        models.length > 0
          ? `Found ${models.length} model${models.length === 1 ? '' : 's'} from ${result.provider}.`
          : `No models were returned by ${result.provider}. You can still type a model manually.`
      );
    } catch (e) {
      setAvailableModels([]);
      setModelsStatus(
        e instanceof Error
          ? `${e.message}. You can still type a model manually.`
          : 'Failed to load models. You can still type a model manually.'
      );
    } finally {
      setLoadingModels(false);
    }
  }

  function updateConfig(patch: Partial<LLMConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function handleProviderModeChange(value: string) {
    const nextProvider = value === 'custom' ? 'openai-compatible' : value;
    const nextBaseUrl = value === 'custom' ? config.baseUrl : getPresetBaseUrl(value);
    const nextConfig: LLMConfig = {
      ...config,
      provider: nextProvider,
      ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
    };
    if (!nextBaseUrl) {
      delete nextConfig.baseUrl;
    }
    setConfig(nextConfig);
    void loadModels(nextConfig);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const body: Record<string, unknown> = {
        provider: config.provider,
        model: config.model,
      };
      if (config.baseUrl) body['baseUrl'] = config.baseUrl;
      if (config.apiKey) body['apiKey'] = config.apiKey;
      if (config.temperature !== undefined) body['temperature'] = config.temperature;

      await apiFetch('/api/config/llm', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setMessage({ type: 'success', text: 'Configuration saved.' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);

    try {
      const result = await apiFetch<{ success: boolean; response?: string; error?: string }>(
        '/api/config/llm/test',
        { method: 'POST' }
      );
      if (result.success) {
        setMessage({ type: 'success', text: `Connection OK: ${result.response ?? 'LLM responded'}` });
      } else {
        setMessage({ type: 'error', text: `Test failed: ${result.error ?? 'Unknown error'}` });
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading LLM config...</p>;

  const providerMode = getProviderMode(config.provider);

  return (
    <div className="max-w-xl">
      <h2 className="mb-6 text-xl font-semibold">LLM Configuration</h2>

      {message && (
        <div
          className={`mb-4 rounded border px-3 py-2 text-sm ${
            message.type === 'success'
              ? 'border-green-800 bg-green-900/30 text-green-400'
              : 'border-red-800 bg-red-900/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div>
          <label className="mb-1 block text-sm text-gray-400">Provider</label>
          <select
            value={providerMode}
            onChange={(event) => handleProviderModeChange(event.currentTarget.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {PROVIDER_PRESETS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
            <option value="custom">Custom OpenAI-compatible</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Anything except `ollama` is treated as an OpenAI-compatible endpoint.
          </p>
        </div>

        {providerMode === 'custom' && (
          <div>
            <label className="mb-1 block text-sm text-gray-400">Provider ID</label>
            <input
              type="text"
              value={config.provider}
              onChange={(event) => updateConfig({ provider: event.currentTarget.value })}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="openai-compatible"
              required
            />
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <label className="block text-sm text-gray-400">Model</label>
            <button
              type="button"
              onClick={() => void loadModels(config)}
              disabled={loadingModels}
              className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300 disabled:opacity-50"
            >
              {loadingModels ? 'Loading models...' : 'Refresh models'}
            </button>
          </div>
          <input
            type="text"
            list="llm-models"
            value={config.model}
            onChange={(event) => updateConfig({ model: event.currentTarget.value })}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            placeholder="Pick a discovered model or type one manually"
            required
          />
          <datalist id="llm-models">
            {availableModels.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-gray-500">
            {modelsStatus || 'Discovered models will appear here when the provider responds.'}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-400">Base URL</label>
          <input
            type="url"
            value={config.baseUrl ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value.trim();
              updateConfig(value ? { baseUrl: value } : { baseUrl: undefined });
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            placeholder={providerMode === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
          />
          <p className="mt-1 text-xs text-gray-500">
            Presets fill this automatically, but you can override it for self-hosted or proxy endpoints.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-400">API Key (optional)</label>
          <input
            type="password"
            value={config.apiKey ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value.trim();
              updateConfig(value ? { apiKey: value } : { apiKey: undefined });
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            placeholder="Leave blank to keep the existing key"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-400">Temperature (0 - 2)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={config.temperature ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateConfig({ temperature: value ? parseFloat(value) : undefined });
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            placeholder="0.7"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>
    </div>
  );
}
