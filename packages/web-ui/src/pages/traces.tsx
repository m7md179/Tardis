import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/api';

interface TraceRow {
  id: string;
  userMessage: string;
  finalResponse: string | null;
  modelUsed: string | null;
  totalDurationMs: number | null;
  tokenCount: number | null;
  timestamp: number;
  stepCount: number;
}

interface TracesResponse {
  data: TraceRow[];
  total: number;
  page: number;
  limit: number;
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export function TracesPage() {
  const navigate = useNavigate();
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const limit = 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  async function loadTraces(p: number) {
    setLoading(true);
    try {
      const res = await apiFetch<TracesResponse>(`/api/traces?limit=${limit}&page=${p}`);
      setTraces(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTraces(page);
  }, [page]);

  if (loading) return <p className="text-gray-500">Loading traces...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Thought Traces</h2>

      {traces.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500">No traces yet.</p>
          <p className="text-xs text-gray-600 mt-1">
            Traces are recorded each time the agent processes a message.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3 text-right">Steps</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => void navigate(`/traces/${t.id}`)}
                    className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(t.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-gray-200 max-w-xs">
                      {truncate(t.userMessage, 80)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                      {t.modelUsed ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-right">{t.stepCount}</td>
                    <td className="px-4 py-3 text-gray-400 text-right">
                      {t.tokenCount != null ? t.tokenCount.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-right whitespace-nowrap">
                      {t.totalDurationMs != null ? `${(t.totalDurationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>
                {total} trace{total !== 1 ? 's' : ''} total
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-3 py-1">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
