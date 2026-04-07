"use client";

import { useState } from "react";

export default function PlanPreferenceCard({
  placeCount,
  onGenerate,
}: {
  placeCount: number;
  onGenerate: (duration: number, pace: "relaxed" | "balanced" | "packed") => void;
}) {
  const [duration, setDuration] = useState(3);
  const [pace, setPace] = useState<"relaxed" | "balanced" | "packed">("balanced");

  return (
    <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/20 editorial-shadow space-y-5">
      <div>
        <h3 className="font-headline text-xl text-on-surface">
          Let&apos;s plan your trip
        </h3>
        <p className="text-sm text-on-surface-variant mt-1">
          Using {placeCount} places from your collection
        </p>
      </div>

      {/* Duration */}
      <div>
        <label className="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant font-bold mb-2 block">
          Duration
        </label>
        <div className="flex bg-surface-container p-1 rounded-full w-fit">
          {[3, 5, 7].map((d) => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`px-5 py-2 rounded-full text-xs transition-all ${
                duration === d
                  ? "font-bold terracotta-gradient text-white shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* Pace */}
      <div>
        <label className="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant font-bold mb-2 block">
          Pace
        </label>
        <div className="flex bg-surface-container p-1 rounded-full w-fit">
          {(["relaxed", "balanced", "packed"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPace(p)}
              className={`px-5 py-2 rounded-full text-xs capitalize transition-all ${
                pace === p
                  ? "font-bold terracotta-gradient text-white shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onGenerate(duration, pace)}
        className="w-full py-3 terracotta-gradient text-white rounded-xl font-medium text-sm uppercase tracking-widest hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-lg">auto_awesome</span>
        Generate Itinerary
      </button>
    </div>
  );
}
