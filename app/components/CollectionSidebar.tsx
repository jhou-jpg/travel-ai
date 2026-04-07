"use client";

type EnrichedPlace = {
  name: string;
  canonical_name?: string;
  category?: string;
  location_hint?: string;
  place_id?: string;
  verified: boolean;
  address?: string;
  rating?: number;
  photo_url?: string;
  google_maps_category?: string;
  lat?: number;
  lng?: number;
};

type CollectionPlace = EnrichedPlace & { sourceType?: string };

const SOURCE_GROUPS: { key: string; icon: string; label: string }[] = [
  { key: "tiktok", icon: "video_library", label: "TikTok" },
  { key: "instagram", icon: "photo_camera", label: "Instagram" },
  { key: "screenshot", icon: "image", label: "Screenshots" },
  { key: "link", icon: "link", label: "Links" },
];

export default function CollectionSidebar({
  places,
  selectedPlace,
  onPlaceClick,
  onGenerateItinerary,
  onClose,
  isMobile,
}: {
  places: CollectionPlace[];
  selectedPlace: EnrichedPlace | null;
  onPlaceClick: (place: EnrichedPlace) => void;
  onGenerateItinerary: () => void;
  onClose: () => void;
  isMobile: boolean;
}) {
  // Group places by sourceType
  const groups = new Map<string, CollectionPlace[]>();
  for (const p of places) {
    const key = p.sourceType || "link";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  return (
    <aside className={`${isMobile ? "fixed inset-0 z-50 bg-surface" : "w-72"} bg-surface-container-low border-r border-outline-variant/10 flex flex-col overflow-hidden flex-shrink-0`}>
      {/* Header */}
      <div className="p-6 border-b border-outline-variant/10">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold">My Collection</span>
            <h2 className="font-headline text-lg mt-1">{places.length} places</h2>
          </div>
          {isMobile && (
            <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-primary">close</button>
          )}
        </div>
      </div>

      {/* Place groups */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-6">
        {places.length === 0 && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-3xl text-outline-variant/40 block mb-3">explore</span>
            <p className="text-sm text-on-surface-variant/60">
              Drop a link or screenshot to start collecting places.
            </p>
          </div>
        )}

        {SOURCE_GROUPS.map((group) => {
          const items = groups.get(group.key);
          if (!items || items.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-sm text-outline">{group.icon}</span>
                <h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
                  {group.label}
                </h3>
                <span className="text-[10px] text-outline-variant">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((place, i) => (
                  <div
                    key={`${place.place_id || group.key}-${i}`}
                    className={`flex gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      selectedPlace?.place_id === place.place_id
                        ? "bg-primary-fixed/30 border border-primary/20"
                        : "hover:bg-surface-container-high"
                    }`}
                    onClick={() => onPlaceClick(place)}
                  >
                    {place.photo_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={place.photo_url} alt={place.canonical_name || place.name}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-headline text-sm text-on-surface leading-tight">
                        {place.canonical_name || place.name}
                      </h4>
                      <p className="text-[10px] text-outline uppercase tracking-wider mt-0.5">
                        {place.location_hint || place.google_maps_category || place.category}
                      </p>
                      {place.rating && (
                        <span className="text-[10px] text-primary">★ {place.rating}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Generate Itinerary CTA */}
      {places.length > 0 && (
        <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low">
          <button
            onClick={onGenerateItinerary}
            className="w-full py-3 terracotta-gradient text-white rounded-xl font-medium text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-lg">route</span>
            Generate Itinerary
          </button>
          <p className="text-[10px] text-on-surface-variant/60 text-center mt-2 uppercase tracking-widest">
            Plan with {places.length} places
          </p>
        </div>
      )}
    </aside>
  );
}
