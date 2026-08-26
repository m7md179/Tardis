import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The mascot bench.
 *
 * The TARDIS sprite carries agent state — the lamp and windows change instead
 * of a spinner — and each state is a two-frame blink between the main sprite
 * and the state sprite. Whether that reads as "thinking" or as "broken" comes
 * down to two numbers, and no amount of describing them settles it. So this
 * page exists to run the animation at real size with the numbers exposed.
 *
 * Sprites are dropped in rather than committed. Deciding the timing should not
 * cost a commit and a deploy per attempt, and the art is not final — once it is,
 * the files go in `web-ui/public/sprites/` and load automatically.
 */

// ─── Slots ───────────────────────────────────────────────────────────────────

interface Slot {
  key: string;
  label: string;
  hint: string;
  /** Fired by the agent when… — kept here so the art and the trigger stay together. */
  trigger: string;
}

const SLOTS: Slot[] = [
  { key: 'main', label: 'Main', hint: 'lit windows — the resting sprite every state blinks against', trigger: 'answer delivered, nothing pending' },
  { key: 'thinking', label: 'Thinking', hint: 'scattered panes', trigger: 'plugin selection → first tool call' },
  { key: 'working', label: 'Working', hint: 'optional — reuse thinking if you have no fourth', trigger: 'a tool is running' },
  { key: 'error', label: 'Error', hint: 'red panes', trigger: 'a tool failed, or the turn threw' },
  { key: 'idle', label: 'Idle', hint: 'dark panes', trigger: 'no turn in flight' },
];

const STORAGE_KEY = 'tardis-sprite-lab-v1';

type Sprites = Record<string, string>;

function loadStored(): Sprites {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Sprites) : {};
  } catch {
    // Private windows and blocked site data both throw here. An empty bench is
    // a fine outcome; a page that refuses to render is not.
    return {};
  }
}

function store(sprites: Sprites): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sprites));
  } catch {
    /* over quota or blocked — the bench still works for this session */
  }
}

/** Guesses which slot a dropped file belongs to from its name. */
function slotForFilename(name: string, taken: Set<string>): string | null {
  const n = name.toLowerCase();
  for (const slot of SLOTS) {
    if (n.includes(slot.key)) return slot.key;
  }
  if (/base|main|normal|default|lit/.test(n)) return 'main';
  if (/think|load|glitch|scatter/.test(n)) return 'thinking';
  if (/err|fail|red/.test(n)) return 'error';
  if (/idle|off|dark|dim/.test(n)) return 'idle';
  return SLOTS.find((s) => !taken.has(s.key))?.key ?? null;
}

async function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ─── Sprite rendering ────────────────────────────────────────────────────────

/**
 * Nearest-neighbour, always.
 *
 * The browser smooths an upscaled image by default, which turns crisp pixel art
 * into mush and looks like the sprite is at fault. Every preview here scales
 * with `pixelated` so what you judge is what the art actually is.
 */
function Sprite({ src, scale, alt }: { src: string; scale: number; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      style={{
        imageRendering: 'pixelated',
        width: `${scale * 32}px`,
        height: 'auto',
        display: 'block',
      }}
    />
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function SpritesPage() {
  const [sprites, setSprites] = useState<Sprites>({});
  const [cycleMs, setCycleMs] = useState(900);
  const [duty, setDuty] = useState(50);
  const [scale, setScale] = useState(3);
  const [bg, setBg] = useState('#0f1115');
  const [now, setNow] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSprites(loadStored());
  }, []);

  // Committed art wins over nothing, but never over what you just dropped in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const slot of SLOTS) {
        const url = `/sprites/tardis-${slot.key}.png`;
        try {
          const res = await fetch(url, { method: 'HEAD' });
          if (!res.ok || cancelled) continue;
          setSprites((current) => (current[slot.key] ? current : { ...current, [slot.key]: url }));
        } catch {
          /* not committed yet — expected */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One clock for every preview, so the states blink in lockstep and you are
  // comparing the animations rather than their phase offsets.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(id);
  }, []);

  const accept = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        setNote('Those were not images.');
        return;
      }
      const next: Sprites = { ...sprites };
      const taken = new Set(Object.keys(next));
      const assigned: string[] = [];
      for (const file of list) {
        const slot = slotForFilename(file.name, taken);
        if (!slot) continue;
        next[slot] = await readAsDataUri(file);
        taken.add(slot);
        assigned.push(`${file.name} → ${slot}`);
      }
      setSprites(next);
      store(next);
      setNote(assigned.join(' · '));
    },
    [sprites]
  );

  const clearSlot = (key: string): void => {
    const next = { ...sprites };
    delete next[key];
    setSprites(next);
    store(next);
  };

  const main = sprites['main'];
  const showState = (now % cycleMs) < (cycleMs * duty) / 100;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void accept(e.dataTransfer.files);
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-semibold">Mascot</h2>
        <button
          onClick={() => fileInput.current?.click()}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          Add sprites
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Drop your PNGs anywhere on this page. They stay in this browser — nothing is uploaded
        and nothing is committed until you are happy with them.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && void accept(e.target.files)}
      />

      {dragging && (
        <div className="fixed inset-0 z-50 bg-blue-600/20 border-4 border-dashed border-blue-400 flex items-center justify-center pointer-events-none">
          <p className="text-lg text-blue-200">Drop to load</p>
        </div>
      )}

      {note && <p className="text-xs text-gray-500 mb-4 font-mono">{note}</p>}

      {/* ─── Controls ─────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs text-gray-400">Cycle · {cycleMs}ms</span>
          <input
            type="range"
            min={200}
            max={2400}
            step={50}
            value={cycleMs}
            onChange={(e) => setCycleMs(Number(e.target.value))}
            className="w-full mt-1"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">
            State showing · {duty}%
            <span className="text-gray-600"> (rest is Main)</span>
          </span>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={duty}
            onChange={(e) => setDuty(Number(e.target.value))}
            className="w-full mt-1"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">Scale · {scale}×</span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-full mt-1"
          />
        </label>

        <div>
          <span className="text-xs text-gray-400">Background</span>
          <div className="flex gap-2 mt-2">
            {['#0f1115', '#161a21', '#ffffff', '#1e293b'].map((colour) => (
              <button
                key={colour}
                onClick={() => setBg(colour)}
                style={{ background: colour }}
                className={`h-6 w-6 rounded border ${
                  bg === colour ? 'border-blue-400' : 'border-gray-700'
                }`}
                aria-label={`Background ${colour}`}
              />
            ))}
          </div>
        </div>
      </div>

      {!main && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center mb-6">
          <p className="text-gray-400">Drop the four PNGs to begin.</p>
          <p className="text-xs text-gray-600 mt-2">
            Named with <span className="font-mono">main</span>,{' '}
            <span className="font-mono">thinking</span>, <span className="font-mono">error</span> or{' '}
            <span className="font-mono">idle</span> in the filename and they sort themselves.
          </p>
        </div>
      )}

      {/* ─── The animations ───────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
        {SLOTS.filter((s) => s.key !== 'main').map((slot) => {
          const stateSrc = sprites[slot.key];
          const frame = showState && stateSrc ? stateSrc : (main ?? stateSrc);
          return (
            <div key={slot.key} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-medium">{slot.label}</h3>
                {stateSrc && (
                  <button
                    onClick={() => clearSlot(slot.key)}
                    className="text-xs text-gray-600 hover:text-red-400"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-1">{slot.hint}</p>
              <p className="text-[11px] text-gray-600 mb-3">{slot.trigger}</p>

              <div
                className="rounded flex items-center justify-center py-4 min-h-[120px]"
                style={{ background: bg }}
              >
                {frame ? (
                  <Sprite src={frame} scale={scale} alt={`${slot.label} animation`} />
                ) : (
                  <span className="text-xs text-gray-700">no sprite</span>
                )}
              </div>

              {stateSrc && main && (
                <div className="flex items-end gap-3 mt-3 pt-3 border-t border-gray-800">
                  <div>
                    <p className="text-[10px] text-gray-600 mb-1">main</p>
                    <Sprite src={main} scale={1} alt="main frame" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-600 mb-1">{slot.key}</p>
                    <Sprite src={stateSrc} scale={1} alt={`${slot.label} frame`} />
                  </div>
                  <p className="text-[10px] text-gray-600 ml-auto">1× — as shipped</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── In context ───────────────────────────────────────────── */}
      {main && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="font-medium mb-1">Beside a message</h3>
          <p className="text-xs text-gray-500 mb-4">
            A sprite that looks good on its own can still be the wrong weight next to text. This
            is roughly what it sits at in the chat.
          </p>
          <div className="rounded p-4 space-y-4" style={{ background: bg }}>
            {[
              { state: 'thinking', line: 'picking plugins…' },
              { state: 'error', line: "That tool failed — I couldn't reach Todoist." },
              { state: 'idle', line: 'Ask me anything.' },
            ].map(({ state, line }) => {
              const stateSrc = sprites[state];
              const frame = showState && stateSrc ? stateSrc : main;
              return (
                <div key={state} className="flex items-center gap-3">
                  <Sprite src={frame} scale={1.5} alt={state} />
                  <p className="text-sm" style={{ color: '#dde3ec' }}>
                    {line}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
