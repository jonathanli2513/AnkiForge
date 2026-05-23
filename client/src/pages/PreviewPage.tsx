import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Download, ChevronRight,
  Trash2, Copy, RefreshCw, Check, Edit3, X, Tag, FileText, Layers, ImagePlus, Loader2
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import type { Flashcard, OcclusionMask } from '../types';
import CardBadge from '../components/CardBadge';
import OcclusionEditorModal from '../components/OcclusionEditorModal';
import { regenerateCard, uploadOcclusionImage } from '../api';

const CARD_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'basic', label: 'Basic' },
  { value: 'cloze', label: 'Cloze' },
  { value: 'image_occlusion', label: 'Image Occlusion' },
];

export default function PreviewPage() {
  const navigate = useNavigate();
  const {
    filteredCards, cards, updateCard, deleteCard, duplicateCard,
    addCard, toggleApproved, toggleAllApproved,
    filterType, setFilterType, filterFile, setFilterFile,
    searchQuery, setSearchQuery, uniqueFiles,
  } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Flashcard>>({});
  const [regenerating, setRegenerating] = useState<string | null>(null);

  // Occlusion editor state
  const [occlusionCardId, setOcclusionCardId] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const visible = filteredCards();
  const allFiles = uniqueFiles();
  const approvedCount = cards.filter(c => c.approvedForExport).length;
  const selectedCard = selectedId ? cards.find(c => c.id === selectedId) : null;
  const occlusionCard = occlusionCardId ? cards.find(c => c.id === occlusionCardId) : null;

  function startEdit(card: Flashcard) {
    setEditingId(card.id);
    setEditDraft({ front: card.front, back: card.back, clozeText: card.clozeText, tags: [...card.tags] });
  }

  function saveEdit(id: string) {
    updateCard(id, editDraft);
    setEditingId(null);
    setEditDraft({});
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  async function handleRegenerate(card: Flashcard) {
    setRegenerating(card.id);
    try {
      const improved = await regenerateCard(card.front, card.back, card.source.sectionTitle || '');
      updateCard(card.id, improved);
    } catch { /* silently ignore */ }
    finally { setRegenerating(null); }
  }

  function handleAddCard() {
    addCard({});
    setTimeout(() => {
      const all = useStore.getState().cards;
      const newest = all[all.length - 1];
      if (newest) { setSelectedId(newest.id); startEdit(newest); }
    }, 50);
  }

  // Open file picker to select image for a new occlusion card
  async function handleAddOcclusionCard(file: File) {
    setUploadingImage(true);
    try {
      const { url, fileName } = await uploadOcclusionImage(file);
      addCard({ cardType: 'image_occlusion', front: 'Image Occlusion', back: '', image: url, occlusionMasks: [], tags: ['Image_Occlusion'], source: { fileName } });
      setTimeout(() => {
        const all = useStore.getState().cards;
        const newest = all[all.length - 1];
        if (newest) {
          setSelectedId(newest.id);
          setOcclusionCardId(newest.id);
        }
      }, 50);
    } catch (e: any) {
      alert('Image upload failed: ' + e.message);
    } finally {
      setUploadingImage(false);
    }
  }

  function handleOcclusionSave(masks: OcclusionMask[]) {
    if (occlusionCardId) {
      updateCard(occlusionCardId, { occlusionMasks: masks, back: masks.map((m, i) => `${i + 1}. ${m.answer}`).join('\n') });
    }
    setOcclusionCardId(null);
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <div className="text-5xl mb-4">📭</div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No flashcards yet</h2>
        <p className="text-slate-400 mb-6">Upload study materials to generate flashcards.</p>
        <button onClick={() => navigate('/')} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
          Go to Upload
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Occlusion editor modal */}
      {occlusionCard && occlusionCard.image && (
        <OcclusionEditorModal
          imageUrl={occlusionCard.image}
          masks={occlusionCard.occlusionMasks ?? []}
          onChange={masks => updateCard(occlusionCard.id, { occlusionMasks: masks })}
          onClose={() => handleOcclusionSave(occlusionCard.occlusionMasks ?? [])}
        />
      )}

      {/* Hidden image input */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleAddOcclusionCard(f);
          e.target.value = '';
        }}
      />

      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search cards…"
              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="pl-3 pr-7 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
            {CARD_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {allFiles.length > 1 && (
            <select value={filterFile} onChange={e => setFilterFile(e.target.value)}
              className="pl-3 pr-7 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-48">
              <option value="all">All files</option>
              {allFiles.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-slate-500">{visible.length} shown · {approvedCount} approved</span>
            <button onClick={handleAddCard}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
              <Plus size={14} /> Basic
            </button>
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
              Occlusion
            </button>
            <button onClick={() => navigate('/export')}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900">
              <Download size={14} /> Export
            </button>
          </div>
        </div>

        {/* Approve all */}
        <div className="flex items-center gap-3 mb-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
            <input type="checkbox" checked={approvedCount === cards.length} onChange={e => toggleAllApproved(e.target.checked)} className="rounded" />
            Select all for export
          </label>
          <span className="text-slate-300">|</span>
          <span className="text-slate-400">{visible.length} shown</span>
        </div>

        {/* Content */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Card list */}
          <div className="w-80 shrink-0 bg-white border border-slate-200 rounded-xl overflow-auto">
            {visible.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No cards match your filters</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map(card => (
                  <li key={card.id} onClick={() => setSelectedId(card.id)}
                    className={clsx('px-3 py-3 cursor-pointer hover:bg-slate-50 transition-colors',
                      selectedId === card.id && 'bg-indigo-50 border-l-2 border-indigo-500')}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={card.approvedForExport} onChange={() => toggleApproved(card.id)}
                        onClick={e => e.stopPropagation()} className="mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <CardBadge type={card.cardType} />
                          <span className="text-xs text-slate-400 truncate">{card.source.fileName}</span>
                        </div>
                        {card.cardType === 'image_occlusion' && card.image ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <img src={card.image} alt="" className="w-12 h-8 object-cover rounded border border-slate-200" />
                            <span className="text-xs text-slate-500">{card.occlusionMasks?.length ?? 0} mask{(card.occlusionMasks?.length ?? 0) !== 1 ? 's' : ''}</span>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-slate-800 line-clamp-2 font-medium">{card.front}</p>
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{card.back}</p>
                          </>
                        )}
                      </div>
                      <ChevronRight size={14} className="text-slate-300 shrink-0 mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-auto">
            {selectedCard ? (
              <CardDetail
                card={selectedCard}
                editing={editingId === selectedCard.id}
                draft={editDraft}
                setDraft={setEditDraft}
                regenerating={regenerating === selectedCard.id}
                onEdit={() => startEdit(selectedCard)}
                onSave={() => saveEdit(selectedCard.id)}
                onCancel={cancelEdit}
                onDelete={() => { deleteCard(selectedCard.id); setSelectedId(null); }}
                onDuplicate={() => duplicateCard(selectedCard.id)}
                onRegenerate={() => handleRegenerate(selectedCard)}
                onToggleApproved={() => toggleApproved(selectedCard.id)}
                onOpenOcclusion={() => setOcclusionCardId(selectedCard.id)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                <div className="text-4xl mb-3">👆</div>
                Select a card to preview and edit
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CardDetail({ card, editing, draft, setDraft, regenerating, onEdit, onSave, onCancel, onDelete, onDuplicate, onRegenerate, onToggleApproved, onOpenOcclusion }: {
  card: Flashcard; editing: boolean; draft: Partial<Flashcard>; setDraft: (d: Partial<Flashcard>) => void;
  regenerating: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void; onDelete: () => void;
  onDuplicate: () => void; onRegenerate: () => void; onToggleApproved: () => void; onOpenOcclusion: () => void;
}) {
  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <CardBadge type={card.cardType} />
        {card.source.pageNumber && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <FileText size={11} /> {card.source.fileName} · p.{card.source.pageNumber}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!editing && (
            <>
              {card.cardType !== 'image_occlusion' && (
                <button onClick={onRegenerate} disabled={regenerating} title="Regenerate with AI"
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                  <RefreshCw size={15} className={clsx(regenerating && 'animate-spin')} />
                </button>
              )}
              {card.cardType === 'image_occlusion' && (
                <button onClick={onOpenOcclusion} title="Edit occlusion masks"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-medium transition-colors">
                  <Layers size={13} /> Edit masks
                </button>
              )}
              <button onClick={onDuplicate} title="Duplicate"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <Copy size={15} />
              </button>
              {card.cardType !== 'image_occlusion' && (
                <button onClick={onEdit} title="Edit"
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Edit3 size={15} />
                </button>
              )}
              <button onClick={onDelete} title="Delete"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={15} />
              </button>
            </>
          )}
          {editing && (
            <>
              <button onClick={onSave}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700">
                <Check size={13} /> Save
              </button>
              <button onClick={onCancel}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200">
                <X size={13} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Approved + confidence */}
      <label className="flex items-center gap-2 text-sm text-slate-600 mb-5 cursor-pointer">
        <input type="checkbox" checked={card.approvedForExport} onChange={onToggleApproved} className="rounded" />
        Approved for export
        <span className={clsx('ml-auto text-xs px-2 py-0.5 rounded-full',
          card.confidenceScore > 0.85 ? 'bg-green-50 text-green-700' :
          card.confidenceScore > 0.6 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700')}>
          {Math.round(card.confidenceScore * 100)}% confidence
        </span>
      </label>

      {/* Image Occlusion card body */}
      {card.cardType === 'image_occlusion' ? (
        <div className="flex-1 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Diagram</label>
            {card.image ? (
              <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block">
                <img src={card.image} alt="Diagram" className="max-w-full max-h-64 object-contain" />
                {(card.occlusionMasks ?? []).length > 0 && (
                  <div className="absolute inset-0 pointer-events-none">
                    <svg className="absolute inset-0 w-full h-full" style={{ position: 'absolute' }}>
                      {card.occlusionMasks?.map(m => (
                        <rect key={m.id} x={`${(m.x / 600) * 100}%`} y={`${(m.y / 400) * 100}%`}
                          width={`${(m.width / 600) * 100}%`} height={`${(m.height / 400) * 100}%`}
                          fill="rgba(79,70,229,0.5)" rx="4" />
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic">No image</div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
              Masks ({card.occlusionMasks?.length ?? 0})
            </label>
            {(card.occlusionMasks ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 italic">No masks yet — click "Edit masks" to add them.</p>
            ) : (
              <ul className="space-y-1">
                {card.occlusionMasks?.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">#{i + 1}</span>
                    <span className="text-slate-700">{m.answer || <span className="text-slate-300 italic">No answer set</span>}</span>
                    <span className="text-xs text-slate-300 ml-auto">{Math.round(m.width)}×{Math.round(m.height)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={onOpenOcclusion}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors">
            <Layers size={15} /> Open Occlusion Editor
          </button>
          {/* Tags */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-2"><Tag size={11} /> Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {card.tags.map(tag => <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{tag}</span>)}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4">
          {card.cardType === 'cloze' && (
            <Field label="Cloze Text" value={editing ? (draft.clozeText ?? '') : (card.clozeText ?? '')} editing={editing} rows={4}
              onChange={v => setDraft({ ...draft, clozeText: v })} />
          )}
          <Field label="Front" value={editing ? (draft.front ?? '') : card.front} editing={editing} rows={3}
            onChange={v => setDraft({ ...draft, front: v })} />
          <Field label="Back" value={editing ? (draft.back ?? '') : card.back} editing={editing} rows={4}
            onChange={v => setDraft({ ...draft, back: v })} />
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-2"><Tag size={11} /> Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {card.tags.map(tag => <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{tag}</span>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, editing, rows, onChange }: {
  label: string; value: string; editing: boolean; rows: number; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">{label}</label>
      {editing ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
          className="w-full border border-slate-200 rounded-lg p-3 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      ) : (
        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-800 min-h-[3rem] whitespace-pre-wrap border border-slate-100">
          {value || <span className="text-slate-300 italic">Empty</span>}
        </div>
      )}
    </div>
  );
}
