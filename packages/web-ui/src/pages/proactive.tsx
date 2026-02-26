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

export function ProactivePage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [editingQuiet, setEditingQuiet] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');

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

  useEffect(() => {
    void loadTriggers();
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
      // Reload on error
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
        <div className="space-y-4">
          {triggers.map((t) => {
            const key = triggerKey(t);
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

                {t.description && <p className="text-sm text-gray-400 mb-3">{t.description}</p>}

                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  {/* Schedule */}
                  <div>
                    <span className="text-gray-600">Schedule:</span>{' '}
                    {editingSchedule === key ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          value={scheduleInput}
                          onChange={(e) => setScheduleInput(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-32"
                        />
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
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingSchedule(key);
                          setScheduleInput(t.schedule);
                        }}
                        className="text-gray-300 hover:text-blue-400 font-mono"
                      >
                        {t.schedule}
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
    </div>
  );
}
