import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Plugin {
  name: string;
  displayName: string;
  version: string;
  tier: number;
  summary: string;
  toolCount: number;
}

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Tier 1 — Core', color: 'bg-green-900/40 text-green-400 border-green-800' },
  2: { label: 'Tier 2 — Extended', color: 'bg-blue-900/40 text-blue-400 border-blue-800' },
  3: { label: 'Tier 3 — External', color: 'bg-amber-900/40 text-amber-400 border-amber-800' },
};

export function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Plugin[]>('/api/plugins')
      .then(setPlugins)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading plugins...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Plugins</h2>

      {plugins.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500">No plugins loaded.</p>
          <p className="text-xs text-gray-600 mt-1">
            Add plugins to your data directory&apos;s plugins/ folder and restart the server.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => {
            const tier = TIER_LABELS[p.tier] ?? { label: `Tier ${p.tier}`, color: 'bg-gray-900 text-gray-400 border-gray-700' };
            return (
              <div key={p.name} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium">{p.displayName}</h3>
                    <p className="text-xs text-gray-500">{p.name} v{p.version}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border ${tier.color}`}>
                    {tier.label}
                  </span>
                </div>
                <p className="text-sm text-gray-400 flex-1">{p.summary}</p>
                <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  {p.toolCount} tool{p.toolCount !== 1 ? 's' : ''} registered
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
