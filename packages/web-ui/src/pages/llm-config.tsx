import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

const PROVIDERS = ['ollama', 'openai', 'anthropic', 'google'] as const;

export function LLMConfigPage() {
  const [config, setConfig] = useState<LLMConfig>({
    provider: 'ollama',
    model: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<LLMConfig>('/api/config/llm')
      .then((data) => setConfig({ ...data, apiKey: '' }))
      .catch((e: Error) => setMessage({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-6">LLM Configuration</h2>

      {message && (
        <div
          className={`mb-4 px-3 py-2 rounded text-sm border ${
            message.type === 'success'
              ? 'bg-green-900/30 border-green-800 text-green-400'
              : 'bg-red-900/30 border-red-800 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Provider</label>
          <select
            value={config.provider}
            onChange={(e) => setConfig({ ...config, provider: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Model</label>
          <input
            type="text"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="e.g. neural-chat, gpt-4, claude-3-sonnet"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Base URL (optional)</label>
          <input
            type="url"
            value={config.baseUrl ?? ''}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value || undefined })}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="http://localhost:11434"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">API Key (optional)</label>
          <input
            type="password"
            value={config.apiKey ?? ''}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value || undefined })}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="Leave blank to keep existing key"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Temperature (0 - 2)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={config.temperature ?? ''}
            onChange={(e) =>
              setConfig({
                ...config,
                temperature: e.target.value ? parseFloat(e.target.value) : undefined,
              })
            }
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="0.7"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>
    </div>
  );
}
