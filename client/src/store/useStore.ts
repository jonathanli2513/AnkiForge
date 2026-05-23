import { create } from 'zustand';
import type { Flashcard, GenerationJob } from '../types';

interface AppState {
  // Job tracking
  currentJob: GenerationJob | null;
  setCurrentJob: (job: GenerationJob | null) => void;

  // Cards
  cards: Flashcard[];
  setCards: (cards: Flashcard[]) => void;
  updateCard: (id: string, patch: Partial<Flashcard>) => void;
  deleteCard: (id: string) => void;
  addCard: (card: Partial<Flashcard>) => void;
  duplicateCard: (id: string) => void;
  toggleApproved: (id: string) => void;
  toggleAllApproved: (approved: boolean) => void;

  // Filters
  filterType: string;
  setFilterType: (t: string) => void;
  filterFile: string;
  setFilterFile: (f: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Export
  deckName: string;
  setDeckName: (n: string) => void;

  // Derived
  filteredCards: () => Flashcard[];
  uniqueFiles: () => string[];
}

export const useStore = create<AppState>((set, get) => ({
  currentJob: null,
  setCurrentJob: (job) => set({ currentJob: job }),

  cards: [],
  setCards: (cards) => set({ cards }),
  updateCard: (id, patch) =>
    set(s => ({
      cards: s.cards.map(c => c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c),
    })),
  deleteCard: (id) =>
    set(s => ({ cards: s.cards.filter(c => c.id !== id) })),
  addCard: (partial) => {
    const now = new Date().toISOString();
    const card: Flashcard = {
      id: uuidv4(),
      cardType: 'basic',
      front: '',
      back: '',
      tags: [],
      source: { fileName: 'manual' },
      confidenceScore: 1.0,
      approvedForExport: true,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    set(s => ({ cards: [...s.cards, card] }));
  },
  duplicateCard: (id) => {
    const s = get();
    const orig = s.cards.find(c => c.id === id);
    if (!orig) return;
    const now = new Date().toISOString();
    const copy = { ...orig, id: uuidv4(), createdAt: now, updatedAt: now };
    set(st => ({ cards: [...st.cards, copy] }));
  },
  toggleApproved: (id) =>
    set(s => ({
      cards: s.cards.map(c => c.id === id ? { ...c, approvedForExport: !c.approvedForExport } : c),
    })),
  toggleAllApproved: (approved) =>
    set(s => ({ cards: s.cards.map(c => ({ ...c, approvedForExport: approved })) })),

  filterType: 'all',
  setFilterType: (filterType) => set({ filterType }),
  filterFile: 'all',
  setFilterFile: (filterFile) => set({ filterFile }),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  deckName: 'My AnkiForge Deck',
  setDeckName: (deckName) => set({ deckName }),

  filteredCards: () => {
    const { cards, filterType, filterFile, searchQuery } = get();
    return cards.filter(c => {
      if (filterType !== 'all' && c.cardType !== filterType) return false;
      if (filterFile !== 'all' && c.source.fileName !== filterFile) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.front.toLowerCase().includes(q) && !c.back.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  },
  uniqueFiles: () => {
    const { cards } = get();
    return [...new Set(cards.map(c => c.source.fileName))];
  },
}));

// Need uuid on client too — add inline since uuid is not in client deps
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
