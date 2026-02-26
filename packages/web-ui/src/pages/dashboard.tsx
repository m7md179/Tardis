import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface HealthStatus {
  status: string;
  timestamp: number;
}

interface PluginSummary {
  name: string;
  displayName: string;
  version: string;
  tier: number;
  toolCount: number;
}

interface TraceStats {
  total: number;
}

interface MemoryStats {
  total: number;
}

export function DashboardPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [traceCount, setTraceCount] = useState(0);
  const [memoryCount, setMemoryCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [h, p, t, m] = await Promise.all([
          fetch('/api/health').then((r) => r.json() as Promise<HealthStatus>),
          apiFetch<PluginSummary[]>('/api/plugins'),
          apiFetch<TraceStats>('/api/traces?limit=1'),
          apiFetch<MemoryStats>('/api/memory?limit=1'),
        ]);
        setHealth(h);
        setPlugins(p);
        setTraceCount(t.total);
        setMemoryCount(m.total);
      } catch {
        // Individual fetches handle errors
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const stats = [
    { label: 'Status', value: health?.status === 'ok' ? 'Online' : 'Offline', color: health?.status === 'ok' ? 'text-green-400' : 'text-red-400' },
    { label: 'Plugins', value: String(plugins.length), color: 'text-blue-400' },
    { label: 'Thought Traces', value: String(traceCount), color: 'text-purple-400' },
    { label: 'Memories', value: String(memoryCount), color: 'text-amber-400' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Dashboard</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {plugins.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Loaded Plugins</h3>
          <div className="space-y-2">
            {plugins.map((p) => (
              <div key={p.name} className="bg-gray-900 border border-gray-800 rounded-md px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{p.displayName}</span>
                  <span className="text-xs text-gray-500 ml-2">v{p.version}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>Tier {p.tier}</span>
                  <span>{p.toolCount} tools</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
