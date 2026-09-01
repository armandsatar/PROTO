'use client';

type ScoreColor = 'green' | 'amber' | 'red';

const colorClasses: Record<ScoreColor, { badge: string; bar: string }> = {
  green: {
    badge: 'bg-green-100 text-green-800',
    bar: 'bg-green-500',
  },
  amber: {
    badge: 'bg-amber-100 text-amber-800',
    bar: 'bg-amber-500',
  },
  red: {
    badge: 'bg-red-100 text-red-800',
    bar: 'bg-red-500',
  },
};

interface ScoreBadgeProps {
  score: number;
  color: ScoreColor;
  label?: string;
}

export function ScoreBadge({ score, color, label }: ScoreBadgeProps) {
  const classes = colorClasses[color];

  return (
    <div className="inline-flex items-center gap-2">
      {label && <span className="text-sm font-medium text-gray-700">{label}:</span>}
      <span className={`rounded px-2 py-0.5 text-sm font-semibold ${classes.badge}`}>
        {score}/10
      </span>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full ${classes.bar}`} style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );
}
