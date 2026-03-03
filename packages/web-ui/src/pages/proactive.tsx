import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Trigger {
  pluginName: string;
  triggerName: string;
  description?: string;
  enabled: boolean;
  schedule: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

interface ProactiveLog {
  id: string;
  pluginName: string;
  triggerName: string;
  status: 'success' | 'error';
  message: string | null;
  timestamp: number;
  durationMs: number | null;
}

// ─── Cron presets ─────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 9am', value: '0 9 * * *' },
  { label: 'Every Monday 9am', value: '0 9 * * 1' },
] as const;

// ─── Cron → human-readable ───────────────────────────────────────────────────

function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const everyHour =
    min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*';
  if (everyHour) return 'Every hour (on the hour)';

  const everyNHours =
    min === '0' && hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*';
  if (everyNHours) {
    const n = hour.slice(2);
    return `Every ${n} hours`;
  }

  const dailyAt =
    dom === '*' &&
    month === '*' &&
    dow === '*' &&
    !/[*\/,\-]/.test(hour) &&
    !/[*\/,\-]/.test(min);
  if (dailyAt) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
    return `Every day at ${h12}${mStr}${ampm}`;
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyAt =
    dom === '*' &&
    month === '*' &&
    !/[*\/,\-]/.test(dow) &&
    !/[*\/,\-]/.test(hour) &&
    !/[*\/,\-]/.test(min);
  if (weeklyAt) {
    const day = DAYS[parseInt(dow, 10)] ?? dow;
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
    return `Every ${day} at ${h12}${mStr}${ampm}`;
  }

  return expr;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProactivePage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [editingQuiet, setEditingQuiet] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');

  const [logs, setLogs] = useState<ProactiveLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  function triggerKey(t: Trigger) {
    return `${t.pluginName}:${t.triggerName}`;
  }

  async function loadTriggers() {
    try {
      const res = await apiFetch<{ data: Trigger[] }>('/api/proactive/triggers');
      setTriggers(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load triggers');
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    try {
      const res = await apiFetch<{ data: ProactiveLog[] }>('/api/proactive/logs?limit=20');
      setLogs(res.data);
    } catch {
      // Non-fatal
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    void loadTriggers();
    void loadLogs();
  }, []);

  async function handleToggle(t: Trigger) {
    try {
      await apiFetch('/api/proactive/triggers/toggle', {
        method: 'PUT',
        body: JSON.stringify({
          pluginName: t.pluginName,
          triggerName: t.triggerName,
          enabled: !t.enabled,
        }),
      });
      setTriggers((prev) =>
        prev.map((tr) =>
          triggerKey(tr) === triggerKey(t) ? { ...tr, enabled: !tr.enabled } : tr
        )
      );
    } catch {
      void loadTriggers();
    }
  }

  async function handleScheduleSave(t: Trigger) {
    try {
      await apiFetch('/api/proactive/triggers/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          pluginName: t.pluginName,
          triggerName: t.triggerName,
          schedule: scheduleInput,
        }),
      });
      setTriggers((prev) =>
        prev.map((tr) =>
          triggerKey(tr) === triggerKey(t) ? { ...tr, schedule: scheduleInput } : tr
        )
      );
      setEditingSchedule(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update schedule');
    }
  }

  async function handleQuietSave(t: Trigger) {
    try {
      await apiFetch('/api/proactive/triggers/quiet-hours', {
        method: 'PUT',
        body: JSON.stringify({
          pluginName: t.pluginName,
          triggerName: t.triggerName,
          start: quietStart || null,
          end: quietEnd || null,
        }),
      });
      setTriggers((prev) =>
        prev.map((tr) =>
          triggerKey(tr) === triggerKey(t)
            ? { ...tr, quietHoursStart: quietStart || null, quietHoursEnd: quietEnd || null }
            : tr
        )
      );
      setEditingQuiet(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update quiet hours');
    }
  }

  if (loading) return <p className="text-gray-500">Loading triggers...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Proactive Triggers</h2>

      {triggers.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500">No proactive triggers registered.</p>
          <p className="text-xs text-gray-600 mt-1">
            Plugins with proactive handlers will appear here after loading.
          </p>
        </div>
      ) : (
        <div className="space-y-4 mb-8">
          {triggers.map((t) => {
            const key = triggerKey(t);
            const isEditingThis = editingSchedule === key;

            return (
              <div key={key} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-medium">{t.triggerName}</h3>
                    <p className="text-xs text-gray-500">{t.pluginName}</p>
                  </div>
                  <button
                    onClick={() => handleToggle(t)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      t.enabled ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        t.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {t.description && (
                  <p className="text-sm text-gray-400 mb-3">{t.description}</p>
                )}

                <div className="flex flex-wrap gap-6 text-xs text-gray-500">
                  {/* Schedule */}
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-600">Schedule:</span>{' '}
                    {isEditingThis ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {CRON_PRESETS.map((p) => (
                            <button
                              key={p.value}
                              onClick={() => setScheduleInput(p.value)}
                              className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                                scheduleInput === p.value
                                  ? 'border-blue-500 text-blue-400 bg-blue-600/10'
                                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="text"
                            value={scheduleInput}
                            onChange={(e) => setScheduleInput(e.target.value)}
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-36 font-mono"
                            placeholder="cron expression"
                          />
                          <span className="text-gray-500 italic">
                            {cronToHuman(scheduleInput)}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleScheduleSave(t)}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingSchedule(null)}
                            className="text-gray-500 hover:text-gray-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingSchedule(key);
                          setScheduleInput(t.schedule);
                        }}
                        className="text-gray-300 hover:text-blue-400 font-mono"
                      >
                        {t.schedule}
                        <span className="ml-2 text-gray-600 font-sans normal-case not-italic">
                          ({cronToHuman(t.schedule)})
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Quiet Hours */}
                  <div>
                    <span className="text-gray-600">Quiet Hours:</span>{' '}
                    {editingQuiet === key ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          value={quietStart}
                          onChange={(e) => setQuietStart(e.target.value)}
                          placeholder="22:00"
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-16"
                        />
                        <span>-</span>
                        <input
                          type="text"
                          value={quietEnd}
                          onChange={(e) => setQuietEnd(e.target.value)}
                          placeholder="08:00"
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-16"
                        />
                        <button
                          onClick={() => handleQuietSave(t)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingQuiet(null)}
                          className="text-gray-500 hover:text-gray-400"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingQuiet(key);
                          setQuietStart(t.quietHoursStart ?? '');
                          setQuietEnd(t.quietHoursEnd ?? '');
                        }}
                        className="text-gray-300 hover:text-blue-400"
                      >
                        {t.quietHoursStart && t.quietHoursEnd
                          ? `${t.quietHoursStart} - ${t.quietHoursEnd}`
                          : 'Not set'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Executions */}
      <div>
        <h3 className="text-base font-semibold mb-3">Recent Executions</h3>
        {logsLoading ? (
          <p className="text-gray-500 text-sm">Loading logs...</p>
        ) : logs.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
            <p className="text-gray-500 text-sm">No executions recorded yet.</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Trigger</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Message</th>
                  <th className="px-4 py-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-800 last:border-0">
                    <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                      {new Intl.DateTimeFormat('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(log.timestamp))}
                    </td>
                    <td className="px-4 py-2 text-gray-300 text-xs">
                      <span className="text-gray-500">{log.pluginName}/</span>
                      {log.triggerName}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          log.status === 'success'
                            ? 'bg-green-600/20 text-green-400'
                            : 'bg-red-600/20 text-red-400'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs max-w-xs truncate">
                      {log.message ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs text-right whitespace-nowrap">
                      {log.durationMs != null ? `${log.durationMs}ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
