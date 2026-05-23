import clsx from 'clsx';
import type { CardType } from '../types';

const LABELS: Record<CardType, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  image_occlusion: 'Image Occlusion',
};

const COLORS: Record<CardType, string> = {
  basic: 'bg-blue-50 text-blue-700 border-blue-200',
  cloze: 'bg-violet-50 text-violet-700 border-violet-200',
  image_occlusion: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function CardBadge({ type }: { type: CardType }) {
  return (
    <span className={clsx('text-xs font-medium px-1.5 py-0.5 rounded border', COLORS[type])}>
      {LABELS[type]}
    </span>
  );
}
