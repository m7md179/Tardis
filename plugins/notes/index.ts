import type { PluginAPI } from '@tardis/core';
import { fuzzyFind } from '@tardis/shared';

// ─── Types ───

interface Note {
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// Notes are stored under key `note:<title>` in plugin storage.
function noteKey(title: string): string {
  return `note:${title.toLowerCase().trim()}`;
}

// ─── Plugin state ───

let api: PluginAPI;

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  api.logger.info('Notes plugin activated');
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Notes plugin deactivated');
};

// ─── Helpers ───

async function getAllNotes(): Promise<Note[]> {
  const keys = await api.storage.list('note:');
  const notes: Note[] = [];
  for (const key of keys) {
    const note = await api.storage.get<Note>(key);
    if (note !== null) notes.push(note);
  }
  return notes;
}

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'notes.save-note': {
      const title = String(args['title'] ?? '').trim();
      const content = String(args['content'] ?? '').trim();
      const tags = Array.isArray(args['tags'])
        ? (args['tags'] as unknown[]).map(String)
        : [];

      if (!title) return { success: false, message: 'Title is required.' };
      if (!content) return { success: false, message: 'Content is required.' };

      const now = Date.now();
      const existing = await api.storage.get<Note>(noteKey(title));
      const note: Note = {
        title,
        content,
        tags,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await api.storage.set(noteKey(title), note);
      const verb = existing ? 'Updated' : 'Saved';
      return { success: true, message: `${verb} note "${title}"`, note };
    }

    case 'notes.get-note': {
      const title = String(args['title'] ?? '').trim();
      const note = await api.storage.get<Note>(noteKey(title));
      if (!note) return { success: false, message: `No note found with title "${title}".` };
      return { success: true, note };
    }

    case 'notes.search-notes': {
      const query = String(args['query'] ?? '').toLowerCase().trim();
      const tagFilter = typeof args['tag'] === 'string' ? args['tag'].toLowerCase() : null;

      const all = await getAllNotes();
      let filtered = all;

      if (tagFilter) {
        filtered = filtered.filter((n) => n.tags.some((t) => t.toLowerCase() === tagFilter));
      }

      // Fuzzy search over title + content + tags
      const results = fuzzyFind(
        query,
        filtered,
        (n) => `${n.title} ${n.content} ${n.tags.join(' ')}`
      );

      if (results.length === 0) return { notes: [], message: `No notes match "${query}".` };
      return { notes: results.map((r) => r.item) };
    }

    case 'notes.list-notes': {
      const tagFilter = typeof args['tag'] === 'string' ? args['tag'].toLowerCase() : null;
      const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 100) : 20;

      let all = await getAllNotes();
      if (tagFilter) {
        all = all.filter((n) => n.tags.some((t) => t.toLowerCase() === tagFilter));
      }

      // Sort by most recently updated
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      const page = all.slice(0, limit);

      if (page.length === 0) return { notes: [], message: 'No notes saved yet.' };
      return {
        notes: page.map((n) => ({
          title: n.title,
          tags: n.tags,
          updatedAt: n.updatedAt,
          preview: n.content.slice(0, 100) + (n.content.length > 100 ? '…' : ''),
        })),
        total: all.length,
      };
    }

    case 'notes.delete-note': {
      const title = String(args['title'] ?? '').trim();
      const note = await api.storage.get<Note>(noteKey(title));
      if (!note) return { success: false, message: `No note found with title "${title}".` };
      await api.storage.delete(noteKey(title));
      return { success: true, message: `Deleted note "${title}"` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
