import { useState, useEffect } from 'react';
import { Zap, CheckCircle, XCircle, Loader2, RefreshCw, ChevronDown, Send } from 'lucide-react';
import clsx from 'clsx';
import type { Flashcard } from '../types';

interface Props {
  cards: Flashcard[];
  deckName: string;
}

type Status = 'idle' | 'checking' | 'available' | 'unavailable' | 'pushing' | 'done' | 'error';

interface PushResult {
  added: number;
  skipped: number;
  errors: string[];
}

export default function AnkiConnectPanel({ cards, deckName }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [version, setVersion] = useState<number | undefined>();
  const [decks, setDecks] = useState<string[]>([]);
  const [selectedDeck, setSelectedDeck] = useState(deckName);
  const [result, setResult] = useState<PushResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => { setSelectedDeck(deckName); }, [deckName]);

  async function checkConnection() {
    setStatus('checking');
    setResult(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/anki/status');
      const data = await res.json();
      if (data.available) {
        setStatus('available');
        setVersion(data.version);
        const deckRes = await fetch('/api/anki/decks');
        if (deckRes.ok) {
          const { decks: d } = await deckRes.json();
          setDecks(d ?? []);
        }
      } else {
        setStatus('unavailable');
      }
    } catch {
      setStatus('unavailable');
    }
  }

  async function pushToAnki() {
    setStatus('pushing');
    setResult(null);
    setErrorMsg('');
    try {
      const approved = cards.filter(c => c.approvedForExport !== false);
      const res = await fetch('/api/anki/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: approved, deckName: selectedDeck }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Push failed');
      setResult(data);
      setStatus('done');
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  const approved = cards.filter(c => c.approvedForExport !== false);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-slate-200">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">AnkiConnect — Direct Push</p>
          <p className="text-xs text-slate-500">Push cards directly into Anki without downloading a file</p>
        </div>
        {status === 'idle' && (
          <button onClick={checkConnection}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors shrink-0">
            <Zap size={12} /> Connect
          </button>
        )}
        {(status === 'available' || status === 'unavailable') && (
          <button onClick={checkConnection}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {status === 'idle' && (
          <div className="text-center py-4">
            <p className="text-sm text-slate-500 mb-1">Requires Anki to be open with the AnkiConnect add-on installed.</p>
            <p className="text-xs text-slate-400">
              Install AnkiConnect: Anki → Tools → Add-ons → Get Add-ons → code{' '}
              <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">2055492159</code>
            </p>
          </div>
        )}

        {status === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Connecting to AnkiConnect…
          </div>
        )}

        {status === 'unavailable' && (
          <div className="flex items-start gap-3 py-2">
            <XCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">AnkiConnect not found</p>
              <p className="text-xs text-slate-500 mt-0.5">Make sure Anki is open and AnkiConnect is installed and enabled. Then click Retry.</p>
            </div>
            <button onClick={checkConnection}
              className="ml-auto flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 shrink-0">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {(status === 'available' || status === 'pushing' || status === 'done' || status === 'error') && (
          <div className="space-y-4">
            {/* Connection status */}
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle size={15} className="text-green-500" />
              Connected to AnkiConnect {version && `v${version}`}
            </div>

            {/* Deck selector */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Target deck</label>
              <div className="relative">
                <select
                  value={selectedDeck}
                  onChange={e => setSelectedDeck(e.target.value)}
                  disabled={status === 'pushing'}
                  className="w-full appearance-none border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                >
                  <option value={deckName}>{deckName} (new)</option>
                  {decks.filter(d => d !== deckName).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              <p className="text-xs text-slate-400 mt-1">Choose an existing deck or type a new name above to create one.</p>
            </div>

            {/* Push button */}
            {status !== 'done' && (
              <button
                onClick={pushToAnki}
                disabled={status === 'pushing' || approved.length === 0}
                className={clsx(
                  'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all',
                  approved.length > 0 && status !== 'pushing'
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                )}
              >
                {status === 'pushing'
                  ? <><Loader2 size={15} className="animate-spin" /> Pushing to Anki…</>
                  : <><Send size={14} /> Push {approved.length} cards to Anki</>
                }
              </button>
            )}

            {/* Result */}
            {status === 'done' && result && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
                  <CheckCircle size={16} className="text-green-600" /> Cards pushed successfully!
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-white rounded-lg p-2.5 text-center border border-green-100">
                    <div className="text-xl font-bold text-green-700">{result.added}</div>
                    <div className="text-xs text-green-600">Added</div>
                  </div>
                  <div className="bg-white rounded-lg p-2.5 text-center border border-green-100">
                    <div className="text-xl font-bold text-slate-500">{result.skipped}</div>
                    <div className="text-xs text-slate-400">Skipped (duplicates)</div>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">
                    {result.errors.length} error(s): {result.errors[0]}
                  </div>
                )}
                <button onClick={() => setStatus('available')}
                  className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1">
                  Push again
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
