import { useCallback, useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, Image, AlertCircle, CheckCircle, Loader2, X, Zap } from 'lucide-react';
import clsx from 'clsx';
import { uploadFiles, pollJob } from '../api';
import { useStore } from '../store/useStore';
import type { Flashcard, GenerationJob } from '../types';

const ACCEPTED = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

interface FileEntry {
  file: File;
  status: 'pending' | 'done' | 'error';
}

export default function UploadPage() {
  const navigate = useNavigate();
  const { setCards, setCurrentJob } = useStore();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const monitoringJobId = useRef<string | null>(null);

  const monitorJob = useCallback(async (jobId: string) => {
    if (monitoringJobId.current === jobId) return;
    monitoringJobId.current = jobId;
    setProcessing(true);
    let consecutivePollFailures = 0;

    try {
      let done = false;
      while (!done) {
        await sleep(1500);

        let job: GenerationJob;
        try {
          job = await pollJob(jobId);
          consecutivePollFailures = 0;
        } catch (pollError) {
          consecutivePollFailures += 1;
          if (consecutivePollFailures < 3) continue;
          throw pollError;
        }

        setCurrentJob(job);
        setProgress(job.progress);
        setStatusMsg(job.message);

        const cards = (job.cards ?? []) as Flashcard[];
        if (cards.length > 0) setCards(cards);

        if (job.status === 'complete') {
          done = true;
          if (cards.length === 0) {
            setError('Processing completed but no flashcards were generated. Check that the file contains readable text.');
          } else {
            navigate('/preview');
          }
        } else if (job.status === 'error') {
          done = true;
          setError(job.error ?? 'Processing failed');
        }
      }
    } catch (err: any) {
      const savedJob = useStore.getState().currentJob;
      const recoveredCards = savedJob?.cards ?? [];
      if (savedJob?.jobId === jobId && recoveredCards.length > 0) {
        const recoveredJob: GenerationJob = {
          ...savedJob,
          status: 'complete',
          partial: true,
          warning: 'The processing connection ended, but all cards completed before that point were recovered.',
          message: `Recovered ${recoveredCards.length} completed cards`,
        };
        setCurrentJob(recoveredJob);
        setCards(recoveredCards);
        navigate('/preview');
      } else {
        setError(err.message ?? 'Processing connection failed');
      }
    } finally {
      if (monitoringJobId.current === jobId) monitoringJobId.current = null;
      setProcessing(false);
    }
  }, [navigate, setCards, setCurrentJob]);

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => {
      if (d.apiKeyConfigured === false) setApiKeyMissing(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const savedJob = useStore.getState().currentJob;
    if (!savedJob || !['pending', 'extracting', 'detecting', 'generating'].includes(savedJob.status)) return;

    setProgress(savedJob.progress);
    setStatusMsg(savedJob.message || 'Resuming flashcard generation…');
    if (savedJob.cards?.length) setCards(savedJob.cards);
    void monitorJob(savedJob.jobId);
  }, [monitorJob, setCards]);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(e => e.file.name));
      const newEntries = accepted
        .filter(f => !existing.has(f.name))
        .map(f => ({ file: f, status: 'pending' as const }));
      return [...prev, ...newEntries];
    });
    setError('');
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    onDropRejected: (rej) => setError(`Unsupported file type: ${rej[0]?.file?.name}`),
  });

  const removeFile = (name: string) =>
    setFiles(prev => prev.filter(e => e.file.name !== name));

  const handleGenerate = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError('');

    try {
      const result = await uploadFiles(files.map(e => e.file));
      setCurrentJob({
        jobId: result.jobId,
        status: 'pending',
        progress: 0,
        message: 'Upload complete · preparing your notes',
        files: result.files,
        cards: [],
      });
      await monitorJob(result.jobId);
    } catch (err: any) {
      setError(err.message ?? 'Upload failed');
      setProcessing(false);
    }
  };

  const formatSize = (bytes: number) =>
    bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) return Image;
    return FileText;
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Zap size={28} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">AnkiForge</h1>
        <p className="text-slate-500 text-lg">
          Upload your lecture notes, PDFs, or images and generate Anki flashcards instantly with AI.
        </p>
      </div>

      {/* API key warning */}
      {apiKeyMissing && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3.5 text-sm text-amber-800">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold mb-1">Groq API key not configured</p>
            <p className="text-amber-700">
              Cards can't be generated without it. Add your free key to <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">server/.env</code>:
            </p>
            <ol className="mt-2 space-y-1 text-amber-700 list-decimal list-inside text-xs">
              <li>Go to <strong>console.groq.com/keys</strong> → sign up free → Create API Key</li>
              <li>Open <code className="bg-amber-100 px-1 rounded font-mono">Documents/AnkiForge/server/.env</code></li>
              <li>Replace <code className="bg-amber-100 px-1 rounded font-mono">GROQ_API_KEY=</code> with your key (starts with <code className="bg-amber-100 px-1 rounded font-mono">gsk_</code>)</li>
              <li>Restart the server: <code className="bg-amber-100 px-1 rounded font-mono">bash ~/Documents/AnkiForge/start.sh</code></li>
            </ol>
          </div>
        </div>
      )}

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
          isDragActive
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50'
        )}
      >
        <input {...getInputProps()} />
        <Upload size={40} className={clsx('mx-auto mb-4', isDragActive ? 'text-indigo-500' : 'text-slate-400')} />
        <p className="text-slate-700 font-semibold text-lg mb-1">
          {isDragActive ? 'Drop your files here' : 'Drag & drop files here'}
        </p>
        <p className="text-slate-400 text-sm mb-4">or click to browse</p>
        <div className="flex flex-wrap justify-center gap-2 text-xs text-slate-400">
          {['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.docx'].map(ext => (
            <span key={ext} className="bg-slate-100 px-2 py-1 rounded font-mono">{ext}</span>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{files.length} file{files.length !== 1 ? 's' : ''} selected</span>
            <button
              onClick={() => setFiles([])}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Clear all
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {files.map(({ file, status }) => {
              const Icon = getFileIcon(file.name);
              return (
                <li key={file.name} className="flex items-center gap-3 px-4 py-3">
                  <Icon size={18} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
                    <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                  </div>
                  {status === 'done' && <CheckCircle size={16} className="text-green-500" />}
                  {status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                  {status === 'pending' && !processing && (
                    <button onClick={() => removeFile(file.name)} className="text-slate-300 hover:text-red-400 transition-colors">
                      <X size={16} />
                    </button>
                  )}
                  {processing && status === 'pending' && (
                    <Loader2 size={16} className="text-indigo-400 animate-spin" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Progress */}
      {processing && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 size={16} className="text-indigo-500 animate-spin" />
            <span className="text-sm font-medium text-slate-700">{statusMsg || 'Processing…'}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-right text-xs text-slate-400 mt-1">{progress}%</p>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={files.length === 0 || processing}
        className={clsx(
          'mt-6 w-full py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2',
          files.length > 0 && !processing
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        )}
      >
        {processing ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            Generating flashcards…
          </>
        ) : (
          <>
            <Zap size={20} />
            Generate Flashcards
          </>
        )}
      </button>

      {/* Feature highlights */}
      <div className="mt-10 grid grid-cols-3 gap-4">
        {[
          { icon: '📄', title: 'PDF & OCR', desc: 'Extracts text from typed PDFs, images & scanned documents' },
          { icon: '🤖', title: 'AI-Powered', desc: 'Free AI model fallbacks generate efficient basic and cloze cards' },
          { icon: '📦', title: 'Anki Export', desc: 'Export as TSV or APKG for direct Anki import' },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <div className="text-2xl mb-2">{icon}</div>
            <p className="text-sm font-semibold text-slate-800 mb-1">{title}</p>
            <p className="text-xs text-slate-400">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
