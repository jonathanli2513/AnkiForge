import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileText, Package, ChevronRight, CheckCircle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { exportCsv, exportApkg } from '../api';
import CardBadge from '../components/CardBadge';
import AnkiConnectPanel from '../components/AnkiConnectPanel';

export default function ExportPage() {
  const navigate = useNavigate();
  const { cards, deckName, setDeckName } = useStore();
  const [format, setFormat] = useState<'tsv' | 'apkg'>('apkg');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState('');

  const approved = cards.filter(c => c.approvedForExport);
  const basicCount = approved.filter(c => c.cardType === 'basic').length;
  const clozeCount = approved.filter(c => c.cardType === 'cloze').length;
  const occlusionCount = approved.filter(c => c.cardType === 'image_occlusion').length;

  async function handleExport() {
    if (approved.length === 0) return;
    setExporting(true);
    setError('');
    try {
      if (format === 'tsv') {
        await exportCsv(approved, deckName);
      } else {
        await exportApkg(approved, deckName);
      }
      setExported(true);
    } catch (err: any) {
      setError(err.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <div className="text-5xl mb-4">📭</div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No cards to export</h2>
        <p className="text-slate-400 mb-6">Generate flashcards first, then come back to export.</p>
        <button onClick={() => navigate('/')} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
          Go to Upload
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Export Flashcards</h1>
      <p className="text-slate-500 mb-6">Download your deck for import into Anki.</p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Approved', count: approved.length, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Skipped', count: cards.length - approved.length, color: 'text-slate-500', bg: 'bg-slate-50' },
          { label: 'Total', count: cards.length, color: 'text-slate-700', bg: 'bg-white' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className={clsx('border border-slate-200 rounded-xl p-4 text-center', bg)}>
            <div className={clsx('text-2xl font-bold', color)}>{count}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Card type breakdown */}
      <div className="flex gap-2 mb-6">
        {[
          { type: 'basic' as const, count: basicCount },
          { type: 'cloze' as const, count: clozeCount },
          { type: 'image_occlusion' as const, count: occlusionCount },
        ].filter(x => x.count > 0).map(({ type, count }) => (
          <div key={type} className="flex items-center gap-1.5">
            <CardBadge type={type} />
            <span className="text-sm text-slate-600 font-medium">{count}</span>
          </div>
        ))}
      </div>

      {/* Deck name */}
      <div className="mb-5">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Deck name</label>
        <input
          value={deckName}
          onChange={e => setDeckName(e.target.value)}
          placeholder="My Study Deck"
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Format selector */}
      <div className="mb-6">
        <label className="text-sm font-medium text-slate-700 block mb-2">Export format</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              value: 'apkg',
              icon: Package,
              title: 'APKG Package (Recommended)',
              desc: 'ZIP with CrowdAnki JSON + TSV. Imports into Anki with card types, tags, and media preserved.',
            },
            {
              value: 'tsv',
              icon: FileText,
              title: 'TSV / CSV',
              desc: 'Simple tab-separated file. Import via Anki → File → Import. Universal compatibility.',
            },
          ].map(({ value, icon: Icon, title, desc }) => (
            <label
              key={value}
              className={clsx(
                'border-2 rounded-xl p-4 cursor-pointer transition-all',
                format === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
              )}
            >
              <input
                type="radio"
                name="format"
                value={value}
                checked={format === value}
                onChange={() => setFormat(value as any)}
                className="sr-only"
              />
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={format === value ? 'text-indigo-600' : 'text-slate-400'} />
                <span className="text-sm font-semibold text-slate-800">{title}</span>
              </div>
              <p className="text-xs text-slate-500">{desc}</p>
            </label>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Export button */}
      {exported ? (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl mb-4">
          <CheckCircle size={20} className="text-green-600" />
          <div>
            <p className="text-sm font-semibold text-green-800">Export complete!</p>
            <p className="text-xs text-green-600">Check your downloads folder.</p>
          </div>
          <button
            onClick={() => setExported(false)}
            className="ml-auto text-xs text-green-600 hover:text-green-800 underline"
          >
            Export again
          </button>
        </div>
      ) : (
        <button
          onClick={handleExport}
          disabled={approved.length === 0 || exporting}
          className={clsx(
            'w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all',
            approved.length > 0 && !exporting
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          )}
        >
          <Download size={18} />
          {exporting ? 'Exporting…' : `Export ${approved.length} card${approved.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {/* Import instructions */}
      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
          <Info size={15} /> How to import into Anki
        </h3>

        {format === 'apkg' ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Option A — CrowdAnki (best quality):</p>
              <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
                <li>In Anki, go to <strong>Tools → Add-ons → Get Add-ons</strong></li>
                <li>Install <strong>CrowdAnki</strong> (code: <code className="bg-slate-100 px-1 rounded">1788670778</code>)</li>
                <li>Extract the downloaded ZIP file</li>
                <li>Go to <strong>File → CrowdAnki Import from Disk</strong></li>
                <li>Select the extracted folder</li>
              </ol>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Option B — Direct TSV (inside the ZIP):</p>
              <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
                <li>Extract the ZIP → open <code className="bg-slate-100 px-1 rounded">cards.tsv</code></li>
                <li>In Anki, go to <strong>File → Import</strong></li>
                <li>Set separator to <strong>Tab</strong>, map Front/Back/Tags</li>
              </ol>
            </div>
          </div>
        ) : (
          <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
            <li>Open Anki</li>
            <li>Go to <strong>File → Import</strong></li>
            <li>Select the downloaded <code className="bg-slate-100 px-1 rounded">.tsv</code> file</li>
            <li>Set field separator to <strong>Tab</strong></li>
            <li>Map: Field 1 → Front, Field 2 → Back, Field 3 → Tags</li>
            <li>Click <strong>Import</strong></li>
          </ol>
        )}

        <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <ChevronRight size={12} className="mt-0.5 shrink-0" />
          Cloze cards: use the <strong>Cloze</strong> note type when importing TSV, or use CrowdAnki for automatic type detection.
        </div>
      </div>

      {/* AnkiConnect */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">or push directly</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <AnkiConnectPanel cards={cards} deckName={deckName} />
      </div>
    </div>
  );
}
