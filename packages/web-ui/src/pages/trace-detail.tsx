import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { apiFetch } from '../lib/api';

interface AgentStep {
  type: 'reasoning' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  timestamp: number;
  durationMs: number;
}

interface TraceDetail {
  id: string;
  userMessage: string;
  finalResponse: string | null;
  steps: AgentStep[];
  totalDurationMs: number | null;
  modelUsed: string | null;
  tokenCount: number | null;
  timestamp: number;
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(ts));
}

function JsonBlock({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = JSON.stringify(value, null, 2);
  const isLong = text.length > 300;

  return (
    <div className="relative">
      <pre
        className={`text-xs font-mono bg-gray-950 border border-gray-800 rounded p-3 overflow-x-auto text-gray-300 ${
          isLong && !expanded ? 'max-h-32 overflow-hidden' : ''
        }`}
      >
        {text}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs text-blue-400 hover:text-blue-300"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  );
}

const STEP_COLORS: Record<AgentStep['type'], string> = {
  reasoning: 'border-blue-600/40 bg-blue-950/20',
  tool_call: 'border-amber-600/40 bg-amber-950/20',
  tool_result: 'border-green-600/40 bg-green-950/20',
};

const STEP_LABELS: Record<AgentStep['type'], string> = {
  reasoning: 'Reasoning',
  tool_call: 'Tool Call',
  tool_result: 'Tool Result',
};

const STEP_BADGE: Record<AgentStep['type'], string> = {
  reasoning: 'bg-blue-600/20 text-blue-400',
  tool_call: 'bg-amber-600/20 text-amber-400',
  tool_result: 'bg-green-600/20 text-green-400',
};

export function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    apiFetch<TraceDetail>(`/api/traces/${id}`)
      .then((t) => setTrace(t))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load trace'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-gray-500">Loading trace...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;
  if (!trace) return <p className="text-gray-500">Trace not found.</p>;

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <button
        onClick={() => void navigate('/traces')}
        className="text-sm text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1"
      >
        ← Back to traces
      </button>

      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-base font-semibold text-gray-200 leading-snug">
            {trace.userMessage}
          </h2>
          <div className="text-xs text-gray-500 whitespace-nowrap shrink-0">
            {formatDate(trace.timestamp)}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          {trace.modelUsed && <span>Model: <span className="text-gray-300 font-mono">{trace.modelUsed}</span></span>}
          {trace.totalDurationMs != null && (
            <span>Duration: <span className="text-gray-300">{(trace.totalDurationMs / 1000).toFixed(2)}s</span></span>
          )}
          {trace.tokenCount != null && (
            <span>Tokens: <span className="text-gray-300">{trace.tokenCount.toLocaleString()}</span></span>
          )}
          <span>Steps: <span className="text-gray-300">{trace.steps.length}</span></span>
        </div>
      </div>

      {/* Final response */}
      {trace.finalResponse && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Final Response</p>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{trace.finalResponse}</p>
        </div>
      )}

      {/* Steps timeline */}
      <div>
        <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Steps</p>
        <div className="space-y-3">
          {trace.steps.map((step, i) => (
            <div
              key={i}
              className={`border rounded-lg p-4 ${STEP_COLORS[step.type]}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${STEP_BADGE[step.type]}`}>
                  {STEP_LABELS[step.type]}
                  {step.toolName && `: ${step.toolName}`}
                </span>
                <span className="text-xs text-gray-600">{step.durationMs}ms</span>
              </div>

              {step.type === 'reasoning' && (
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{step.content}</p>
              )}

              {step.type === 'tool_call' && step.toolArgs && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Arguments:</p>
                  <JsonBlock value={step.toolArgs} />
                </div>
              )}

              {step.type === 'tool_result' && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Result:</p>
                  <JsonBlock value={step.toolResult} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
