"use client";

import { useState } from "react";

type EnrichedPlace = {
  name: string;
  canonical_name?: string;
  place_id?: string;
  photo_url?: string;
  rating?: number;
  price_level?: string;
  google_maps_category?: string;
  maps_url?: string;
  address?: string;
  website?: string;
};

type ItineraryStop = {
  place_name: string;
  place_id?: string;
  time: string;
  duration_minutes: number;
  editorial_note: string;
  label?: string;
};

type ItineraryDay = {
  day: number;
  title: string;
  description: string;
  stops: ItineraryStop[];
};

type Itinerary = {
  destination: string;
  days: ItineraryDay[];
};

export default function ItineraryCard({
  itinerary,
  places,
  onDaySelect,
  onShare,
  onRegenerate,
}: {
  itinerary: Itinerary;
  places: EnrichedPlace[];
  onDaySelect?: (day: number) => void;
  onShare?: () => void;
  onRegenerate?: () => void;
}) {
  const [activeDay, setActiveDay] = useState(1);

  const handleDayClick = (day: number) => {
    setActiveDay(day);
    onDaySelect?.(day);
  };

  // Build place lookup
  const placeMap = new Map<string, EnrichedPlace>();
  for (const p of places) {
    if (p.place_id) placeMap.set(p.place_id, p);
    placeMap.set((p.canonical_name || p.name).toLowerCase(), p);
    placeMap.set(p.name.toLowerCase(), p);
  }

  function findPlace(stop: ItineraryStop): EnrichedPlace | undefined {
    return (
      (stop.place_id && placeMap.get(stop.place_id)) ||
      placeMap.get(stop.place_name.toLowerCase())
    );
  }

  const currentDay = itinerary.days.find((d) => d.day === activeDay) || itinerary.days[0];

  return (
    <div className="bg-surface-container-low rounded-xl overflow-hidden border border-outline-variant/20 editorial-shadow">
      {/* Header */}
      <div className="p-6 pb-0">
        <h2 className="font-headline text-2xl font-bold text-on-surface tracking-tight leading-tight">
          {currentDay.title}
        </h2>
        <p className="text-sm text-on-surface-variant mt-1 italic font-serif">
          &ldquo;{currentDay.description}&rdquo;
        </p>
      </div>

      {/* Day tabs */}
      <div className="flex gap-1 px-6 pt-4 border-b border-outline-variant/10 overflow-x-auto no-scrollbar">
        {itinerary.days.map((day) => (
          <button
            key={day.day}
            onClick={() => handleDayClick(day.day)}
            className={`pb-3 px-4 text-xs uppercase tracking-widest whitespace-nowrap transition-all border-b-2 ${
              activeDay === day.day
                ? "text-primary border-primary font-bold"
                : "text-on-surface-variant/60 border-transparent hover:text-on-surface"
            }`}
          >
            Day {day.day}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="p-6 space-y-6 relative">
        {/* Vertical line */}
        <div className="absolute left-[30px] top-6 bottom-6 w-px bg-outline-variant/20" />

        {currentDay.stops.map((stop, i) => {
          const place = findPlace(stop);
          return (
            <div key={i} className="relative flex gap-5 pl-6">
              {/* Dot */}
              <div className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 z-10 ${
                i === 0 ? "bg-primary border-primary shadow-[0_0_0_4px_rgba(143,72,42,0.1)]" : "bg-surface border-outline-variant"
              }`} />

              <div className="flex-1 min-w-0">
                {/* Time + label */}
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs uppercase tracking-widest text-primary font-bold">{stop.time}</span>
                  {stop.label && (
                    <span className="text-[10px] px-2 py-0.5 bg-surface-container rounded-full text-on-surface-variant">
                      {stop.label}
                    </span>
                  )}
                </div>

                {/* Place name */}
                <h3 className="font-headline text-lg text-on-surface mb-2">
                  {place?.maps_url ? (
                    <a href={place.maps_url} target="_blank" rel="noopener noreferrer"
                      className="hover:text-primary transition-colors">
                      {stop.place_name}
                    </a>
                  ) : stop.place_name}
                </h3>

                {/* Photo + note */}
                <div className="flex gap-3">
                  {place?.photo_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={place.photo_url} alt={stop.place_name}
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    {stop.editorial_note}
                  </p>
                </div>

                {/* Meta */}
                {place && (
                  <div className="flex items-center gap-3 mt-2 text-xs text-on-surface-variant">
                    {place.rating && <span className="text-primary">★ {place.rating}</span>}
                    {place.price_level && <span>{place.price_level}</span>}
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">timer</span>
                      {stop.duration_minutes} min
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3">
        {onShare && (
          <button
            onClick={onShare}
            className="flex-1 py-2.5 text-[10px] uppercase tracking-widest font-bold text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">share</span>
            Share
          </button>
        )}
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            className="flex-1 py-2.5 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant border border-outline-variant/20 rounded-lg hover:bg-surface-container transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}
