"use client";

type Chip = {
  label: string;
  icon: string;
  action: () => void;
};

export default function ActionChips({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-3">
      {chips.map((chip) => (
        <button
          key={chip.label}
          onClick={chip.action}
          className="px-4 py-2 text-xs text-on-surface-variant border border-outline-variant/30 rounded-full hover:border-primary/40 hover:text-primary transition-all flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">{chip.icon}</span>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
