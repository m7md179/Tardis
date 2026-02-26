import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface Memory {
  id: string;
  type: string;
  key: string;
  value: string;
  source: string | null;
  pluginName: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MemoryListResponse {
  data: Memory[];
  total: number;
  page: number;
  limit: number;
}

const MEMORY_TYPES = ['user_fact', 'project', 'preference', 'plugin'] as const;

export function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formType, setFormType] = useState<string>('user_fact');
  const [formKey, setFormKey] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formSource, setFormSource] = useState('web-ui');

  const limit = 20;

  async function loadMemories() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), page: String(page) });
      if (typeFilter) params.set('type', typeFilter);
      if (searchQuery) params.set('search', searchQuery);
      const res = await apiFetch<MemoryListResponse>(`/api/memory?${params.toString()}`);
      setMemories(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMemories();
  }, [page, typeFilter]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    void loadMemories();
  }

  function resetForm() {
    setFormType('user_fact');
    setFormKey('');
    setFormValue('');
    setFormSource('web-ui');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(m: Memory) {
    setEditingId(m.id);
    setFormType(m.type);
    setFormKey(m.key);
    setFormValue(m.value);
    setFormSource(m.source ?? '');
    setShowForm(true);
  }

  async function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    try {
      if (editingId) {
        // Update existing
        await apiFetch(`/api/memory/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            type: formType,
            key: formKey,
            value: formValue,
            source: formSource || undefined,
          }),
        });
      } else {
        // Create new
        await apiFetch('/api/memory', {
          method: 'POST',
          body: JSON.stringify({
            id: crypto.randomUUID(),
            type: formType,
            key: formKey,
            value: formValue,
            source: formSource || 'web-ui',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        });
      }
      resetForm();
      void loadMemories();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save memory');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this memory?')) return;
    try {
      await apiFetch(`/api/memory/${id}`, { method: 'DELETE' });
      void loadMemories();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete memory');
    }
  }

  async function handleExport() {
    try {
      const res = await apiFetch<{ markdown: string }>('/api/memory/export');
      const blob = new Blob([res.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tardis-memories.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export');
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Memories</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
          >
            Export
          </button>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
          >
            Add Memory
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-sm border bg-red-900/30 border-red-800 text-red-400">
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {editingId ? 'Edit Memory' : 'New Memory'}
          </h3>
          <form onSubmit={handleFormSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Source</label>
                <input
                  type="text"
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                  placeholder="web-ui"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Key</label>
              <input
                type="text"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                placeholder="e.g. user_name"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Value</label>
              <textarea
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500 resize-y"
                placeholder="Memory content..."
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-md transition-colors"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
          >
            Search
          </button>
        </form>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : memories.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500">No memories found.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {memories.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                        {m.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">{m.key}</td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{m.value}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(m.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(m)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
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
                Page {page} of {totalPages} ({total} total)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-50 hover:bg-gray-700"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-50 hover:bg-gray-700"
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
