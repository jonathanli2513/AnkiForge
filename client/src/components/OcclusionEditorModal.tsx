import { useRef, useState, useCallback, useEffect } from 'react';
import { X, Trash2, Eye, EyeOff, Check, Move, Wand2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { OcclusionMask } from '../types';

interface Props {
  imageUrl: string;
  masks: OcclusionMask[];
  onChange: (masks: OcclusionMask[]) => void;
  onClose: () => void;
}

type DragMode = { kind: 'none' } | { kind: 'drawing'; startX: number; startY: number } | { kind: 'moving'; maskId: string; offsetX: number; offsetY: number } | { kind: 'resizing'; maskId: string; handle: 'se' | 'sw' | 'ne' | 'nw' };

function uuidMini() {
  return Math.random().toString(36).slice(2, 10);
}

const HANDLE_SIZE = 8;
const MIN_SIZE = 20;

export default function OcclusionEditorModal({ imageUrl, masks, onChange, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalW, setNaturalW] = useState(600);
  const [naturalH, setNaturalH] = useState(400);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [drag, setDrag] = useState<DragMode>({ kind: 'none' });
  const [draft, setDraft] = useState<OcclusionMask | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoError, setAutoError] = useState('');

  const onImgLoad = () => {
    if (imgRef.current) {
      setNaturalW(imgRef.current.naturalWidth || 600);
      setNaturalH(imgRef.current.naturalHeight || 400);
    }
  };

  // Convert screen coords to SVG viewBox coords
  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = naturalW / rect.width;
    const scaleY = naturalH / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }, [naturalW, naturalH]);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (preview) return;
    e.preventDefault();
    const { x, y } = toSvgCoords(e.clientX, e.clientY);
    // Start drawing new mask
    setSelectedId(null);
    const newDraft: OcclusionMask = { id: uuidMini(), x, y, width: 0, height: 0, answer: '' };
    setDraft(newDraft);
    setDrag({ kind: 'drawing', startX: x, startY: y });
  }, [preview, toSvgCoords]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (drag.kind === 'none') return;
    e.preventDefault();
    const { x, y } = toSvgCoords(e.clientX, e.clientY);

    if (drag.kind === 'drawing' && draft) {
      const nx = Math.min(drag.startX, x);
      const ny = Math.min(drag.startY, y);
      const nw = Math.abs(x - drag.startX);
      const nh = Math.abs(y - drag.startY);
      setDraft({ ...draft, x: nx, y: ny, width: nw, height: nh });
    } else if (drag.kind === 'moving') {
      onChange(masks.map(m => m.id === drag.maskId
        ? { ...m, x: x - drag.offsetX, y: y - drag.offsetY }
        : m));
    } else if (drag.kind === 'resizing') {
      onChange(masks.map(m => {
        if (m.id !== drag.maskId) return m;
        const h = drag.handle;
        let { x: mx, y: my, width: mw, height: mh } = m;
        if (h === 'se') { mw = Math.max(MIN_SIZE, x - mx); mh = Math.max(MIN_SIZE, y - my); }
        if (h === 'sw') { mw = Math.max(MIN_SIZE, mx + mw - x); mx = Math.min(x, mx + m.width - MIN_SIZE); mh = Math.max(MIN_SIZE, y - my); }
        if (h === 'ne') { mw = Math.max(MIN_SIZE, x - mx); mh = Math.max(MIN_SIZE, my + mh - y); my = Math.min(y, my + m.height - MIN_SIZE); }
        if (h === 'nw') { mw = Math.max(MIN_SIZE, mx + mw - x); mx = Math.min(x, mx + m.width - MIN_SIZE); mh = Math.max(MIN_SIZE, my + mh - y); my = Math.min(y, my + m.height - MIN_SIZE); }
        return { ...m, x: mx, y: my, width: mw, height: mh };
      }));
    }
  }, [drag, draft, masks, onChange, toSvgCoords]);

  const handleMouseUp = useCallback(() => {
    if (drag.kind === 'drawing' && draft && draft.width > MIN_SIZE && draft.height > MIN_SIZE) {
      onChange([...masks, draft]);
      setSelectedId(draft.id);
    }
    setDraft(null);
    setDrag({ kind: 'none' });
  }, [drag, draft, masks, onChange]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const startMove = (e: React.MouseEvent, mask: OcclusionMask) => {
    e.stopPropagation();
    if (preview) return;
    const { x, y } = toSvgCoords(e.clientX, e.clientY);
    setSelectedId(mask.id);
    setDrag({ kind: 'moving', maskId: mask.id, offsetX: x - mask.x, offsetY: y - mask.y });
  };

  const startResize = (e: React.MouseEvent, maskId: string, handle: 'se' | 'sw' | 'ne' | 'nw') => {
    e.stopPropagation();
    setDrag({ kind: 'resizing', maskId, handle });
  };

  const deleteMask = (id: string) => {
    onChange(masks.filter(m => m.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateAnswer = (id: string, answer: string) => {
    onChange(masks.map(m => m.id === id ? { ...m, answer } : m));
  };

  const selectedMask = masks.find(m => m.id === selectedId);

  const handleAutoDetect = async () => {
    setAutoDetecting(true);
    setAutoError('');
    try {
      const res = await fetch('/api/upload/auto-occlude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Auto-detect failed');
      }
      const { masks: detected } = await res.json() as { masks: OcclusionMask[]; imageWidth: number; imageHeight: number };
      if (detected.length === 0) {
        setAutoError('No regions detected — try drawing masks manually.');
      } else {
        onChange([...masks, ...detected]);
      }
    } catch (err: any) {
      setAutoError(err.message ?? 'Auto-detect failed');
    } finally {
      setAutoDetecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-900">Image Occlusion Editor</h2>
            <p className="text-xs text-slate-400 mt-0.5">Draw rectangles over labels or regions you want to hide. Click a mask to set its answer.</p>
          </div>
          <button
            onClick={handleAutoDetect}
            disabled={autoDetecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Use AI to auto-detect labeled regions"
          >
            {autoDetecting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Auto-detect
          </button>
          <button onClick={() => setPreview(p => !p)}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              preview ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {preview ? <Eye size={14} /> : <EyeOff size={14} />}
            {preview ? 'Preview on' : 'Preview off'}
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Canvas */}
          <div className="flex-1 bg-slate-100 overflow-auto flex items-center justify-center p-4">
            <div className="relative inline-block select-none">
              <img
                ref={imgRef}
                src={imageUrl}
                onLoad={onImgLoad}
                alt="Diagram"
                draggable={false}
                className="block max-w-full max-h-[60vh] object-contain"
                style={{ userSelect: 'none' }}
              />
              <svg
                ref={svgRef}
                viewBox={`0 0 ${naturalW} ${naturalH}`}
                className="absolute inset-0 w-full h-full"
                style={{ cursor: preview ? 'default' : drag.kind !== 'none' ? 'crosshair' : 'crosshair' }}
                onMouseDown={handleMouseDown}
              >
                {/* Existing masks */}
                {masks.map(mask => {
                  const isSelected = selectedId === mask.id;
                  return (
                    <g key={mask.id}>
                      <rect
                        x={mask.x} y={mask.y} width={mask.width} height={mask.height}
                        fill={preview ? '#4f46e5' : isSelected ? 'rgba(79,70,229,0.3)' : 'rgba(79,70,229,0.2)'}
                        stroke={isSelected ? '#4f46e5' : '#818cf8'}
                        strokeWidth={isSelected ? 2 : 1.5}
                        rx={4}
                        style={{ cursor: preview ? 'default' : 'move' }}
                        onMouseDown={e => startMove(e, mask)}
                      />
                      {!preview && (
                        <text
                          x={mask.x + mask.width / 2} y={mask.y + mask.height / 2}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={Math.min(14, mask.height * 0.4)}
                          fill={isSelected ? '#3730a3' : '#6366f1'}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {mask.answer || '?'}
                        </text>
                      )}
                      {isSelected && !preview && (
                        <>
                          {(['nw', 'ne', 'sw', 'se'] as const).map(h => {
                            const hx = h.includes('e') ? mask.x + mask.width - HANDLE_SIZE / 2 : mask.x - HANDLE_SIZE / 2;
                            const hy = h.includes('s') ? mask.y + mask.height - HANDLE_SIZE / 2 : mask.y - HANDLE_SIZE / 2;
                            const cursor = h === 'se' || h === 'nw' ? 'nwse-resize' : 'nesw-resize';
                            return (
                              <rect key={h} x={hx} y={hy} width={HANDLE_SIZE} height={HANDLE_SIZE}
                                fill="white" stroke="#4f46e5" strokeWidth={1.5} rx={2}
                                style={{ cursor }}
                                onMouseDown={e => startResize(e, mask.id, h)}
                              />
                            );
                          })}
                        </>
                      )}
                    </g>
                  );
                })}
                {/* Draft mask while drawing */}
                {draft && draft.width > 0 && draft.height > 0 && (
                  <rect x={draft.x} y={draft.y} width={draft.width} height={draft.height}
                    fill="rgba(79,70,229,0.15)" stroke="#4f46e5" strokeWidth={2} strokeDasharray="6 3" rx={4} />
                )}
              </svg>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-64 shrink-0 border-l border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Masks ({masks.length})</span>
              <span className="text-xs text-slate-400">Click image to draw</span>
            </div>
            {autoError && (
              <div className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{autoError}</div>
            )}

            <div className="flex-1 overflow-y-auto">
              {masks.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs mt-4">
                  <div className="text-2xl mb-2">✏️</div>
                  Click and drag on the image to create your first mask
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {masks.map((mask, i) => (
                    <li key={mask.id}
                      onClick={() => setSelectedId(mask.id)}
                      className={clsx('px-4 py-3 cursor-pointer transition-colors',
                        selectedId === mask.id ? 'bg-indigo-50' : 'hover:bg-slate-50')}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">#{i + 1}</span>
                        <span className="text-xs text-slate-400 flex-1">{Math.round(mask.width)}×{Math.round(mask.height)}px</span>
                        <button onClick={e => { e.stopPropagation(); deleteMask(mask.id); }}
                          className="text-slate-300 hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <input
                        value={mask.answer}
                        onChange={e => updateAnswer(mask.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Answer (what's hidden)…"
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-4 py-3 border-t border-slate-100 space-y-2 shrink-0">
              {selectedMask && (
                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-medium">Selected:</span> Mask #{masks.indexOf(selectedMask) + 1}
                  {selectedMask.answer && <div className="text-indigo-600 mt-0.5 font-medium truncate">"{selectedMask.answer}"</div>}
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <Check size={14} /> Save masks ({masks.length})
              </button>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50 flex items-center gap-4 text-xs text-slate-400 shrink-0">
          <span className="flex items-center gap-1"><Move size={11} /> Drag to draw new mask</span>
          <span>· Click existing mask to select · Drag corners to resize</span>
          <span className="ml-auto">{naturalW} × {naturalH} px</span>
        </div>
      </div>
    </div>
  );
}
