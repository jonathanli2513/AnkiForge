import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Upload, Eye, Download, Zap } from 'lucide-react';
import clsx from 'clsx';

const NAV = [
  { to: '/', label: 'Upload', icon: Upload },
  { to: '/preview', label: 'Preview & Edit', icon: Eye },
  { to: '/export', label: 'Export', icon: Download },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-indigo-600 text-lg shrink-0">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            AnkiForge
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  pathname === to
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <BookOpen size={13} />
            AI Flashcard Generator
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
