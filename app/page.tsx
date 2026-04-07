"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { APIProvider, Map as GoogleMap, Marker, useMap } from "@vis.gl/react-google-maps";

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#2a2520" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9a8a7c" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1714" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#1a1714" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#3a3530" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4a4540" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// ── Types ──

type EnrichedPlace = {
  name: string;
  location_hint?: string;
  category?: string;
  confidence: string;
  details?: string;
  source_clue?: string;
  place_id?: string;
  verified: boolean;
  canonical_name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  maps_url?: string;
  enrichment_status: "success" | "failed" | "skipped";
  rating?: number;
  review_count?: number;
  price_level?: string;
  phone?: string;
  website?: string;
  google_maps_category?: string;
  photo_url?: string;
  hours?: string[];
  open_now?: boolean;
};

type TripSource = {
  id: string;
  type: "url" | "image";
  label: string;
  addedAt: number;
  placeCount: number;
  mode: string;
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

type TripState = {
  sources: TripSource[];
  places: EnrichedPlace[];
};

type View = "ingestion" | "processing" | "review" | "itinerary";

const STORAGE_KEY = "travel-ai-trip";

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function placeKey(p: EnrichedPlace): string {
  if (p.place_id) return `pid:${p.place_id}`;
  const name = (p.canonical_name || p.name).toLowerCase().trim();
  const hint = (p.location_hint || "").toLowerCase().trim();
  return `name:${name}|${hint}`;
}

function mergePlaces(
  existing: EnrichedPlace[],
  incoming: EnrichedPlace[]
): EnrichedPlace[] {
  const seen = new Map<string, EnrichedPlace>();
  for (const p of existing) seen.set(placeKey(p), p);
  for (const p of incoming) {
    const key = placeKey(p);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, p);
    } else {
      // Combine insights from duplicate sources
      const combinedDetails = [prev.details, p.details]
        .filter(Boolean)
        .join(" | ");
      const combinedClues = [prev.source_clue, p.source_clue]
        .filter(Boolean)
        .join(" | ");
      seen.set(key, {
        ...prev,
        // Prefer richer data (verified > unverified, success > failed)
        ...(p.verified && !prev.verified ? p : {}),
        ...(p.enrichment_status === "success" && prev.enrichment_status !== "success" ? p : {}),
        details: combinedDetails || prev.details,
        source_clue: combinedClues || prev.source_clue,
        // Keep the better photo
        photo_url: prev.photo_url || p.photo_url,
      });
    }
  }
  return Array.from(seen.values());
}

function loadTrip(): TripState {
  if (typeof window === "undefined") return { sources: [], places: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { sources: [], places: [] };
}

function saveTrip(state: TripState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ── Sidebar ──

const NAV_ITEMS: { key: View; icon: string; label: string }[] = [
  { key: "ingestion", icon: "input", label: "Ingestion" },
  { key: "processing", icon: "settings_suggest", label: "Processing" },
  { key: "review", icon: "rate_review", label: "Review" },
  { key: "itinerary", icon: "map", label: "Itinerary" },
];

function Sidebar({
  activeView,
  onNavigate,
  onNewTrip,
  hasPlaces,
}: {
  activeView: View;
  onNavigate: (v: View) => void;
  onNewTrip: () => void;
  hasPlaces: boolean;
}) {
  return (
    <aside className="h-screen w-64 sticky left-0 top-0 bg-stone-900 flex flex-col py-10 gap-8 flex-shrink-0">
      <div className="px-8">
        <h1 className="font-headline text-lg text-stone-50">Trip Planner</h1>
        <p className="text-[10px] tracking-widest uppercase text-stone-400 mt-1">
          Crafting your journey
        </p>
      </div>

      <nav className="flex flex-col flex-grow">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.key;
          const isDisabled =
            (item.key === "review" || item.key === "itinerary") && !hasPlaces;
          return (
            <button
              key={item.key}
              onClick={() => !isDisabled && onNavigate(item.key)}
              disabled={isDisabled}
              className={`flex items-center px-8 py-4 gap-4 text-left transition-all duration-200 ${
                isActive
                  ? "text-primary-fixed-dim font-bold border-r-4 border-primary-fixed-dim bg-stone-950/30"
                  : isDisabled
                    ? "text-stone-700 cursor-not-allowed"
                    : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-200 cursor-pointer"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {item.icon}
              </span>
              <span className="text-xs tracking-widest uppercase">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="px-6">
        <button
          onClick={onNewTrip}
          className="w-full py-4 rounded-xl terracotta-gradient text-white font-medium tracking-wide transition-opacity hover:opacity-90 text-sm"
        >
          New Expedition
        </button>
      </div>
    </aside>
  );
}

// ── Place Card ──

function PlaceCard({
  place,
  onRemove,
}: {
  place: EnrichedPlace;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`glass-panel p-5 rounded-xl border group transition-all hover:border-primary/30 ${
        place.verified ? "border-stone-800/30" : "border-yellow-800/30"
      }`}
    >
      <div className="flex items-start gap-4">
        {place.photo_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={place.photo_url}
            alt={place.canonical_name || place.name}
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              {place.location_hint && (
                <span className="text-[10px] uppercase tracking-widest text-primary-fixed-dim font-bold block mb-1">
                  {place.location_hint}
                </span>
              )}
              <h4 className="font-headline text-lg text-stone-100">
                {place.maps_url ? (
                  <a
                    href={place.maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary-fixed-dim transition-colors"
                  >
                    {place.canonical_name || place.name}
                  </a>
                ) : (
                  place.name
                )}
              </h4>
              {place.address && (
                <p className="text-xs text-stone-500 truncate mt-0.5">
                  {place.address}
                </p>
              )}
            </div>
            {onRemove && (
              <button
                onClick={onRemove}
                className="text-stone-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {place.rating && (
              <span className="text-xs text-yellow-400">
                {"★".repeat(Math.round(place.rating))} {place.rating}
                {place.review_count && (
                  <span className="text-stone-500">
                    {" "}
                    ({place.review_count.toLocaleString()})
                  </span>
                )}
              </span>
            )}
            {place.price_level && (
              <span className="text-xs text-stone-400">
                {place.price_level}
              </span>
            )}
            {place.open_now !== undefined && (
              <span
                className={`text-xs ${place.open_now ? "text-green-400" : "text-red-400"}`}
              >
                {place.open_now ? "Open now" : "Closed"}
              </span>
            )}
            {(place.google_maps_category || place.category) && (
              <span className="text-[10px] uppercase tracking-widest bg-stone-800/60 px-2 py-0.5 rounded text-stone-400">
                {place.google_maps_category || place.category}
              </span>
            )}
            <span
              className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                place.verified
                  ? "bg-green-900/30 text-green-400"
                  : "bg-yellow-900/30 text-yellow-400"
              }`}
            >
              {place.verified ? "verified" : "unverified"}
            </span>
          </div>

          {place.details && (
            <p className="text-sm text-stone-400 mt-2 line-clamp-2">
              {place.details}
            </p>
          )}

          {/* Links */}
          <div className="flex gap-4 mt-3 text-xs">
            {place.maps_url && (
              <a
                href={place.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-fixed-dim hover:text-primary-fixed transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  map
                </span>
                Maps
              </a>
            )}
            {place.website && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-fixed-dim hover:text-primary-fixed transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  language
                </span>
                Website
              </a>
            )}
            {place.phone && (
              <span className="text-stone-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">
                  call
                </span>
                {place.phone}
              </span>
            )}
          </div>

          {/* Hours */}
          {place.hours && place.hours.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="text-stone-500 cursor-pointer hover:text-stone-300">
                <span className="material-symbols-outlined text-[14px] align-text-bottom mr-1">
                  schedule
                </span>
                Hours
              </summary>
              <ul className="mt-1 space-y-0.5 text-stone-500 pl-5">
                {place.hours.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function Home() {
  const [view, setView] = useState<View>("ingestion");
  const [mode, setMode] = useState<"url" | "image">("url");
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trip, setTrip] = useState<TripState>({ sources: [], places: [] });
  const [processingLabel, setProcessingLabel] = useState("");
  const [duration, setDuration] = useState<number>(3);
  const [pace, setPace] = useState<"relaxed" | "balanced" | "packed">("balanced");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [destinationPhoto, setDestinationPhoto] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setTrip(loadTrip());
    }
  }, []);

  useEffect(() => {
    if (initialized.current) saveTrip(trip);
  }, [trip]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const addSource = async () => {
    setLoading(true);
    setError(null);
    setView("processing");

    try {
      let response: Response;
      let label: string;

      if (mode === "image" && file) {
        label = file.name;
        setProcessingLabel(label);
        const formData = new FormData();
        formData.append("image", file);
        response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });
      } else if (mode === "url" && url.trim()) {
        label = url.trim();
        setProcessingLabel(label);
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
      } else {
        setError(mode === "image" ? "Upload an image first" : "Enter a URL");
        setLoading(false);
        setView("ingestion");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Analysis failed");
        setView("ingestion");
        return;
      }

      const newPlaces: EnrichedPlace[] = data.enriched_places || [];

      const source: TripSource = {
        id: generateId(),
        type: mode,
        label,
        addedAt: Date.now(),
        placeCount: newPlaces.length,
        mode: data.mode || mode,
      };

      setTrip((prev) => ({
        sources: [...prev.sources, source],
        places: mergePlaces(prev.places, newPlaces),
      }));

      setUrl("");
      setFile(null);
      setPreview(null);
      // Go to review if we have places, otherwise back to ingestion
      setView(newPlaces.length > 0 ? "review" : "ingestion");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setView("ingestion");
    } finally {
      setLoading(false);
    }
  };

  const removePlace = (index: number) => {
    setTrip((prev) => ({
      ...prev,
      places: prev.places.filter((_, i) => i !== index),
    }));
  };

  const removeSource = (sourceId: string) => {
    setTrip((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== sourceId),
    }));
  };

  const clearTrip = () => {
    setTrip({ sources: [], places: [] });
    setItinerary(null);
    setDestinationPhoto(null);
    localStorage.removeItem(STORAGE_KEY);
    setView("ingestion");
  };

  const generateItinerary = async () => {
    setGenerating(true);
    setError(null);
    setView("processing");
    setProcessingLabel("Generating your itinerary...");

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places: trip.places, duration, pace }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Itinerary generation failed");
        setView("review");
        return;
      }

      setItinerary(data.itinerary);
      setDestinationPhoto(data.destination_photo_url || null);
      setView("itinerary");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setView("review");
    } finally {
      setGenerating(false);
    }
  };

  const hasPlaces = trip.places.length > 0;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        activeView={view}
        onNavigate={setView}
        onNewTrip={clearTrip}
        hasPlaces={hasPlaces}
      />

      <main className="flex-grow overflow-y-auto custom-scrollbar">
        {view === "ingestion" && (
          <IngestionView
            mode={mode}
            setMode={setMode}
            url={url}
            setUrl={setUrl}
            file={file}
            preview={preview}
            dragOver={dragOver}
            setDragOver={setDragOver}
            handleFile={handleFile}
            handleDrop={handleDrop}
            addSource={addSource}
            loading={loading}
            error={error}
            trip={trip}
            removeSource={removeSource}
          />
        )}
        {view === "processing" && (
          <ProcessingView label={processingLabel} />
        )}
        {view === "review" && (
          <ReviewView
            trip={trip}
            removePlace={removePlace}
            onAddMore={() => setView("ingestion")}
            onGenerate={generateItinerary}
            generating={generating}
            duration={duration}
            setDuration={setDuration}
            pace={pace}
            setPace={setPace}
          />
        )}
        {view === "itinerary" && (
          <ItineraryView
            trip={trip}
            itinerary={itinerary}
            onBack={() => setView("review")}
          />
        )}
      </main>
    </div>
  );
}

// ── Ingestion View ──

function IngestionView({
  mode,
  setMode,
  url,
  setUrl,
  file,
  preview,
  dragOver,
  setDragOver,
  handleFile,
  handleDrop,
  addSource,
  loading,
  error,
  trip,
  removeSource,
}: {
  mode: "url" | "image";
  setMode: (m: "url" | "image") => void;
  url: string;
  setUrl: (u: string) => void;
  file: File | null;
  preview: string | null;
  dragOver: boolean;
  setDragOver: (d: boolean) => void;
  handleFile: (f: File) => void;
  handleDrop: (e: React.DragEvent) => void;
  addSource: () => void;
  loading: boolean;
  error: string | null;
  trip: TripState;
  removeSource: (id: string) => void;
}) {
  return (
    <div className="p-12 max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-12">
        <div className="flex items-baseline gap-4 mb-2">
          <span className="text-primary-fixed-dim font-bold tracking-[0.2em] text-xs uppercase">
            Source Ingestion
          </span>
          <div className="h-px flex-grow bg-stone-800"></div>
        </div>
        <h2 className="text-5xl font-headline font-bold text-stone-50 italic tracking-tight">
          Feed your inspiration
        </h2>
        <p className="mt-4 text-stone-400 max-w-xl text-lg font-light leading-relaxed">
          Drop TikToks, Instagram reels, screenshots, or any travel link.
          We&apos;ll extract every place and verify it on Google Maps.
        </p>
      </header>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode("url")}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            mode === "url"
              ? "terracotta-gradient text-white"
              : "bg-stone-800/60 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          }`}
        >
          <span className="material-symbols-outlined text-[16px] align-text-bottom mr-1">
            link
          </span>
          Paste URL
        </button>
        <button
          onClick={() => setMode("image")}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            mode === "image"
              ? "terracotta-gradient text-white"
              : "bg-stone-800/60 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          }`}
        >
          <span className="material-symbols-outlined text-[16px] align-text-bottom mr-1">
            image
          </span>
          Upload Image
        </button>
      </div>

      {/* Input */}
      {mode === "url" ? (
        <div className="flex gap-3">
          <input
            type="url"
            placeholder="Paste a TikTok, Instagram, or travel blog URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && addSource()}
            className="flex-1 bg-stone-900/60 border border-stone-700/50 rounded-xl px-5 py-4 text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-primary/50 transition-colors"
          />
          <button
            onClick={addSource}
            disabled={loading || !url.trim()}
            className="px-8 terracotta-gradient text-white font-medium rounded-xl transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin text-[20px]">
                progress_activity
              </span>
            ) : (
              "Add"
            )}
          </button>
        </div>
      ) : (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-stone-700/50 hover:border-stone-600"
            }`}
          >
            <input
              id="file-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {preview ? (
              <div className="flex flex-col items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-48 rounded-lg"
                />
                <p className="text-sm text-stone-500">
                  Click or drag to replace
                </p>
              </div>
            ) : (
              <div>
                <div className="w-16 h-16 bg-stone-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-primary-fixed-dim text-2xl">
                    add_photo_alternate
                  </span>
                </div>
                <p className="text-stone-300 mb-1">
                  Drop a screenshot here or click to upload
                </p>
                <p className="text-sm text-stone-600">
                  Screenshots from TikTok, Instagram, or travel content
                </p>
              </div>
            )}
          </div>
          {file && (
            <button
              onClick={addSource}
              disabled={loading}
              className="mt-4 w-full terracotta-gradient text-white font-medium py-4 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Analyzing..." : "Add screenshot"}
            </button>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-900/20 border border-red-800/30 rounded-xl text-red-300 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      {/* Sources list */}
      {trip.sources.length > 0 && (
        <div className="mt-12">
          <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-stone-500 mb-4">
            Sources Added ({trip.sources.length})
          </h3>
          <div className="space-y-2">
            {trip.sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between px-5 py-3 glass-panel rounded-xl border border-stone-800/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="material-symbols-outlined text-primary-fixed-dim text-[16px]">
                    {source.mode === "tiktok" || source.mode === "instagram"
                      ? "videocam"
                      : source.type === "image"
                        ? "image"
                        : "link"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-stone-800 text-stone-400 uppercase tracking-widest">
                    {source.mode}
                  </span>
                  <span className="text-sm text-stone-300 truncate">
                    {source.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-stone-500">
                    {source.placeCount} place
                    {source.placeCount !== 1 && "s"}
                  </span>
                  <button
                    onClick={() => removeSource(source.id)}
                    className="text-stone-700 hover:text-red-400 transition"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      close
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Processing View ──

function ProcessingView({ label }: { label: string }) {
  return (
    <div className="p-12 max-w-3xl mx-auto">
      <header className="mb-16">
        <div className="flex items-baseline gap-4 mb-2">
          <span className="text-primary-fixed-dim font-bold tracking-[0.2em] text-xs uppercase">
            Pipeline Active
          </span>
          <div className="h-px flex-grow bg-stone-800"></div>
        </div>
        <h2 className="text-5xl font-headline font-bold text-stone-50 italic tracking-tight">
          The Magic Moment
        </h2>
        <p className="mt-4 text-stone-400 max-w-xl text-lg font-light leading-relaxed">
          Analyzing your source and resolving places on Google Maps...
        </p>
      </header>

      <div className="glass-panel p-8 rounded-xl border-b border-primary/20 mb-8">
        <h3 className="text-primary-fixed-dim font-bold uppercase tracking-widest text-[10px] mb-8">
          System Telemetry
        </h3>
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-primary-fixed-dim pulsing-dot"></div>
              <span className="text-sm font-medium tracking-wide text-stone-200">
                Fetching Content
              </span>
            </div>
            <span className="text-xs font-mono text-primary-fixed-dim">
              RUNNING
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-primary-fixed-dim pulsing-dot"></div>
              <span className="text-sm font-medium tracking-wide text-stone-200">
                Extracting Places
              </span>
            </div>
            <span className="text-xs font-mono text-primary-fixed-dim">
              RUNNING
            </span>
          </div>
          <div className="flex items-center justify-between opacity-50">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-stone-600"></div>
              <span className="text-sm font-medium tracking-wide">
                Resolving on Google Maps
              </span>
            </div>
            <span className="text-xs font-mono text-stone-500">PENDING</span>
          </div>
          <div className="flex items-center justify-between opacity-50">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-stone-600"></div>
              <span className="text-sm font-medium tracking-wide">
                Enriching Place Details
              </span>
            </div>
            <span className="text-xs font-mono text-stone-500">QUEUE</span>
          </div>
        </div>
      </div>

      <div className="p-6 border border-stone-800/30 rounded-xl bg-stone-900/40">
        <div className="flex items-center gap-3 mb-3">
          <span
            className="material-symbols-outlined text-primary-fixed-dim text-sm"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
          <span className="text-xs uppercase tracking-[0.15em] font-bold text-stone-300">
            Processing
          </span>
        </div>
        <p className="text-sm text-stone-400 leading-relaxed italic truncate">
          {label}
        </p>
      </div>
    </div>
  );
}

// ── Interactive Map ──

function FitBounds({ places }: { places: Array<{ lat?: number; lng?: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const coords = places.filter((p) => p.lat && p.lng);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.panTo({ lat: coords[0].lat!, lng: coords[0].lng! });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    coords.forEach((p) => bounds.extend({ lat: p.lat!, lng: p.lng! }));
    map.fitBounds(bounds, { top: 60, bottom: 60, left: 40, right: 40 });
  }, [map, places]);
  return null;
}

function ZoomToPlace({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo({ lat, lng });
    map.setZoom(16);
  }, [map, lat, lng]);
  return null;
}

function RoutePolyline({ places }: { places: Array<{ lat?: number; lng?: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const path = places
      .filter((p) => p.lat && p.lng)
      .map((p) => ({ lat: p.lat!, lng: p.lng! }));
    if (path.length < 2) return;
    const polyline = new google.maps.Polyline({
      path,
      strokeOpacity: 0,
      icons: [
        {
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.5, strokeColor: "#ad603f", scale: 3 },
          offset: "0",
          repeat: "16px",
        },
      ],
      geodesic: true,
    });
    polyline.setMap(map);
    return () => { polyline.setMap(null); };
  }, [map, places]);
  return null;
}

function TripMap({
  places,
  selectedPlace,
  onMarkerClick,
  numbered,
  showRoute,
}: {
  places: EnrichedPlace[];
  selectedPlace?: EnrichedPlace | null;
  onMarkerClick?: (place: EnrichedPlace) => void;
  numbered?: boolean;
  showRoute?: boolean;
}) {
  const coords = places.filter((p) => p.lat && p.lng);
  if (!MAPS_API_KEY || coords.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-stone-900">
        <div className="text-center text-stone-600">
          <span className="material-symbols-outlined text-4xl mb-2 block">map</span>
          <p className="text-sm">{coords.length === 0 ? "No coordinates yet" : "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"}</p>
        </div>
      </div>
    );
  }

  const center = coords[0];

  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <GoogleMap
        defaultCenter={{ lat: center.lat!, lng: center.lng! }}
        defaultZoom={12}
        styles={DARK_MAP_STYLES}
        disableDefaultUI={true}
        zoomControl={true}
        gestureHandling="greedy"
        className="w-full h-full"
      >
        <FitBounds places={selectedPlace?.lat ? [] : coords} />
        {selectedPlace?.lat && selectedPlace?.lng && (
          <ZoomToPlace lat={selectedPlace.lat} lng={selectedPlace.lng} />
        )}
        {showRoute && <RoutePolyline places={coords} />}
        {coords.map((place, i) => {
          const isSelected = selectedPlace?.place_id === place.place_id;
          return (
            <Marker
              key={place.place_id || `m-${i}`}
              position={{ lat: place.lat!, lng: place.lng! }}
              title={place.canonical_name || place.name}
              onClick={() => onMarkerClick?.(place)}
              label={numbered ? {
                text: String(i + 1),
                color: "#fff",
                fontSize: "11px",
                fontWeight: "bold",
              } : undefined}
              icon={numbered ? {
                path: 0,
                scale: isSelected ? 14 : 11,
                fillColor: isSelected ? "#ffb598" : "#ad603f",
                fillOpacity: 1,
                strokeColor: "#1a1714",
                strokeWeight: 2,
                labelOrigin: new google.maps.Point(0, 0),
              } : {
                path: 0,
                scale: isSelected ? 10 : 7,
                fillColor: isSelected ? "#ffb598" : "#ad603f",
                fillOpacity: 1,
                strokeColor: "#1a1714",
                strokeWeight: 2,
              }}
            />
          );
        })}
      </GoogleMap>
    </APIProvider>
  );
}

// ── Review View ──

function ReviewView({
  trip,
  removePlace,
  onAddMore,
  onGenerate,
  generating,
  duration,
  setDuration,
  pace,
  setPace,
}: {
  trip: TripState;
  removePlace: (i: number) => void;
  onAddMore: () => void;
  onGenerate: () => void;
  generating: boolean;
  duration: number;
  setDuration: (d: number) => void;
  pace: "relaxed" | "balanced" | "packed";
  setPace: (p: "relaxed" | "balanced" | "packed") => void;
}) {
  const verified = trip.places.filter((p) => p.verified);
  const unverified = trip.places.filter((p) => !p.verified);
  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);

  return (
    <div className="flex flex-1 h-[calc(100vh)] overflow-hidden">
      {/* Left column: places + constraints */}
      <section className="w-2/5 flex flex-col overflow-y-auto custom-scrollbar p-8 gap-6">
        {/* Header */}
        <header>
          <h2 className="text-3xl font-headline font-bold text-stone-50 italic tracking-tight">
            Place Review
          </h2>
          <p className="text-stone-500 text-xs uppercase tracking-widest mt-1">
            {trip.places.length} places from {trip.sources.length} sources
          </p>
        </header>

        {/* Source groups */}
        {trip.sources.map((source) => (
          <div key={source.id} className="space-y-3">
            <div className="flex items-center gap-3 border-b border-stone-800/30 pb-2">
              <span className="material-symbols-outlined text-primary-fixed-dim text-[16px]">
                {source.mode === "tiktok" || source.mode === "instagram"
                  ? "videocam"
                  : source.type === "image"
                    ? "image"
                    : "link"}
              </span>
              <h3 className="font-headline text-sm italic font-bold text-stone-400">
                {source.mode === "tiktok"
                  ? "TikTok"
                  : source.mode === "instagram"
                    ? "Instagram"
                    : source.type === "image"
                      ? "Screenshot"
                      : "URL"}{" "}
                &mdash; {source.placeCount} places
              </h3>
            </div>
          </div>
        ))}

        {/* All places */}
        {verified.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 border-b border-stone-800/30 pb-2">
              <span className="material-symbols-outlined text-green-400 text-[16px]">
                verified
              </span>
              <h3 className="font-headline text-sm italic font-bold text-stone-300">
                Verified ({verified.length})
              </h3>
            </div>
            {verified.map((place, i) => {
              const globalIndex = trip.places.indexOf(place);
              return (
                <div
                  key={place.place_id || `v-${i}`}
                  onClick={() => setSelectedPlace(selectedPlace?.place_id === place.place_id ? null : place)}
                  className={`group glass-panel p-4 rounded-lg flex gap-4 border transition-all cursor-pointer ${
                    selectedPlace?.place_id === place.place_id
                      ? "border-primary/50 bg-primary/5"
                      : "border-stone-800/20 hover:border-primary/30"
                  }`}
                >
                  {place.photo_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={place.photo_url}
                      alt={place.canonical_name || place.name}
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-headline text-base text-stone-100">
                      {place.maps_url ? (
                        <a href={place.maps_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary-fixed-dim transition-colors">
                          {place.canonical_name || place.name}
                        </a>
                      ) : place.name}
                    </h4>
                    <p className="text-stone-500 text-xs line-clamp-2 mt-0.5">
                      {place.details || place.address}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {place.rating && (
                        <span className="text-[10px] text-yellow-400">★ {place.rating}</span>
                      )}
                      {(place.google_maps_category || place.category) && (
                        <span className="text-[10px] uppercase tracking-widest bg-stone-800/60 px-2 py-0.5 rounded text-stone-400">
                          {place.google_maps_category || place.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removePlace(globalIndex)}
                    className="text-stone-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100 self-start"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {unverified.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 border-b border-stone-800/30 pb-2">
              <span className="material-symbols-outlined text-yellow-400 text-[16px]">help</span>
              <h3 className="font-headline text-sm italic font-bold text-stone-300">
                Unverified ({unverified.length})
              </h3>
            </div>
            {unverified.map((place, i) => {
              const globalIndex = trip.places.indexOf(place);
              return (
                <div
                  key={`u-${i}`}
                  className="group glass-panel p-4 rounded-lg flex gap-4 border border-yellow-800/20 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-headline text-base text-stone-100">{place.name}</h4>
                    <p className="text-stone-500 text-xs line-clamp-2 mt-0.5">{place.details}</p>
                  </div>
                  <button
                    onClick={() => removePlace(globalIndex)}
                    className="text-stone-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100 self-start"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Constraints */}
        <div className="mt-auto pt-6 border-t border-stone-800/30 space-y-5">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-stone-500 font-bold mb-2 block">
              Duration
            </label>
            <div className="flex bg-stone-800/60 p-1 rounded-full w-fit">
              {[3, 5, 7].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`px-5 py-1.5 rounded-full text-xs transition-colors ${
                    duration === d
                      ? "font-bold bg-stone-700 text-stone-200 shadow-sm"
                      : "text-stone-500 hover:text-stone-300"
                  }`}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-stone-500 font-bold mb-2 block">
              Pace
            </label>
            <div className="flex bg-stone-800/60 p-1 rounded-full w-fit">
              {(["relaxed", "balanced", "packed"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPace(p)}
                  className={`px-5 py-1.5 rounded-full text-xs capitalize transition-colors ${
                    pace === p
                      ? "font-bold bg-stone-700 text-stone-200 shadow-sm"
                      : "text-stone-500 hover:text-stone-300"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onAddMore}
              className="flex-1 py-3 rounded-xl border border-stone-700/50 text-stone-400 text-sm hover:border-primary/50 hover:text-primary-fixed-dim transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add more
            </button>
            <button
              onClick={onGenerate}
              disabled={generating}
              className="flex-1 py-3 rounded-xl terracotta-gradient text-white font-bold text-sm tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "..." : "Generate"}
            </button>
          </div>
        </div>
      </section>

      {/* Right column: Interactive Map */}
      <section className="w-3/5 relative overflow-hidden bg-stone-900 border-l border-stone-800/30">
        <TripMap
          places={trip.places}
          selectedPlace={selectedPlace}
          onMarkerClick={(p) => setSelectedPlace(selectedPlace?.place_id === p.place_id ? null : p)}
        />
        {/* Bottom info bar */}
        <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
          <div className="glass-panel p-4 rounded-xl border border-stone-700/30 flex justify-between items-center">
            <div className="flex gap-4 items-center">
              <div className="bg-primary/10 p-2 rounded-lg">
                <span className="material-symbols-outlined text-primary-fixed-dim">explore</span>
              </div>
              <div>
                <h5 className="font-headline text-sm font-bold text-stone-200">
                  {selectedPlace ? (selectedPlace.canonical_name || selectedPlace.name) : "All Places"}
                </h5>
                <p className="text-xs text-stone-400">
                  {selectedPlace
                    ? (selectedPlace.address || "Click map to deselect")
                    : `${verified.length} verified locations`}
                </p>
              </div>
            </div>
            {selectedPlace && (
              <button
                onClick={() => setSelectedPlace(null)}
                className="pointer-events-auto text-[10px] uppercase tracking-widest font-bold text-primary-fixed-dim hover:text-primary-fixed transition-colors"
              >
                Show all
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Itinerary View ──

function ItineraryView({
  trip,
  itinerary,
  onBack,
}: {
  trip: TripState;
  itinerary: Itinerary | null;
  onBack: () => void;
}) {
  const [activeDay, setActiveDay] = useState(1);
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);

  // Reset selection when switching days
  useEffect(() => { setSelectedStopIndex(null); }, [activeDay]);

  // Build a map from place name/id → enriched place for photos + links
  const placeMap = new Map<string, EnrichedPlace>();
  for (const p of trip.places) {
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

  if (!itinerary) {
    return (
      <div className="p-12 max-w-4xl mx-auto">
        <p className="text-stone-400">No itinerary generated yet.</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-3 rounded-xl border border-stone-700/50 text-stone-400 text-sm hover:text-primary-fixed-dim transition-all"
        >
          Back to Review
        </button>
      </div>
    );
  }

  const currentDay = itinerary.days.find((d) => d.day === activeDay) || itinerary.days[0];
  const selectedPlace = selectedStopIndex !== null ? findPlace(currentDay.stops[selectedStopIndex]) ?? null : null;

  // Scroll to selected stop when marker is clicked
  useEffect(() => {
    if (selectedStopIndex === null) return;
    document.getElementById(`stop-${selectedStopIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedStopIndex]);

  return (
    <div className="flex h-[calc(100vh)] overflow-hidden">
      {/* Day Nav Column */}
      <div className="w-24 border-r border-stone-800/30 flex flex-col items-center py-12 gap-6 flex-shrink-0">
        {/* Destination label */}
        <div className="mb-4 text-center">
          <span className="text-[9px] uppercase tracking-widest text-stone-600 leading-tight block">
            {itinerary.destination}
          </span>
        </div>

        {itinerary.days.map((day) => (
          <button
            key={day.day}
            onClick={() => setActiveDay(day.day)}
            className={`flex flex-col items-center group cursor-pointer transition-opacity ${
              activeDay === day.day ? "" : "opacity-40 hover:opacity-100"
            }`}
          >
            <span className="text-[10px] tracking-widest uppercase text-stone-500 mb-1">
              Day
            </span>
            <span
              className={`w-10 h-10 flex items-center justify-center rounded-full font-bold text-sm ${
                activeDay === day.day
                  ? "terracotta-gradient text-white"
                  : "border border-stone-700 text-stone-400"
              }`}
            >
              {String(day.day).padStart(2, "0")}
            </span>
          </button>
        ))}

        <div className="mt-auto">
          <button
            onClick={onBack}
            className="text-stone-600 hover:text-stone-300 transition-colors"
            title="Back to review"
          >
            <span className="material-symbols-outlined text-[20px]">
              arrow_back
            </span>
          </button>
        </div>
      </div>

      {/* Day Detail Column */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-12 py-12 max-w-2xl mx-auto">
          <header className="mb-14">
            <p className="text-[10px] uppercase tracking-[0.2em] text-primary-fixed-dim font-bold mb-4">
              Day {String(currentDay.day).padStart(2, "0")} &middot;{" "}
              {itinerary.destination}
            </p>
            <h1 className="font-headline text-4xl md:text-5xl text-stone-50 italic tracking-tight leading-tight mb-6">
              {currentDay.title}
            </h1>
            <p className="font-serif italic text-lg text-stone-400 leading-relaxed">
              &ldquo;{currentDay.description}&rdquo;
            </p>
            <div className="flex items-center gap-4 mt-4">
              <div className="w-12 h-px bg-outline-variant opacity-30"></div>
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                {currentDay.stops.length} stop{currentDay.stops.length !== 1 && "s"}
              </span>
            </div>
          </header>

          {/* Stops feed */}
          <div className="space-y-20 relative pl-6">
            {currentDay.stops.map((stop, i) => {
              const place = findPlace(stop);
              const isSelected = selectedStopIndex === i;
              return (
                <div
                  key={i}
                  id={`stop-${i}`}
                  className={`relative group cursor-pointer transition-colors rounded-lg ${isSelected ? "bg-stone-800/30" : ""}`}
                  onClick={() => setSelectedStopIndex(isSelected ? null : i)}
                >
                  {/* Timeline line */}
                  <div className={`absolute -left-6 top-0 h-full w-px transition-colors ${isSelected ? "bg-primary/40" : "bg-stone-800 group-hover:bg-primary/40"}`}></div>
                  <div className={`absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-[#1a1714] border-2 transition-all ${isSelected ? "border-[#ffb598] scale-125" : "border-primary-fixed-dim"}`}></div>

                  <div className="space-y-5">
                    {/* Time + Name + Label */}
                    <div className="flex justify-between items-baseline gap-4">
                      <h3 className="font-headline text-2xl text-stone-100">
                        <span className="text-primary-fixed-dim">{stop.time}</span>
                        {" — "}
                        {place?.maps_url ? (
                          <a
                            href={place.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary-fixed-dim transition-colors"
                          >
                            {stop.place_name}
                          </a>
                        ) : (
                          stop.place_name
                        )}
                      </h3>
                      {stop.label && (
                        <span className="text-[10px] uppercase tracking-widest text-stone-500 flex-shrink-0">
                          {stop.label}
                        </span>
                      )}
                    </div>

                    {/* Photo */}
                    {place?.photo_url && (
                      <div className="w-full h-[220px] overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={place.photo_url}
                          alt={stop.place_name}
                          className="w-full h-full object-cover grayscale-[20%] hover:grayscale-0 hover:scale-105 transition-all duration-700"
                        />
                      </div>
                    )}

                    {/* Editorial note */}
                    <blockquote className="font-serif italic text-stone-400 pl-5 border-l-2 border-primary/20 py-1 leading-relaxed">
                      {stop.editorial_note}
                    </blockquote>

                    {/* Meta row */}
                    {place && (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        {place.rating && (
                          <span className="text-yellow-400">
                            {"★".repeat(Math.round(place.rating))}{" "}
                            <span className="text-stone-500">{place.rating}</span>
                          </span>
                        )}
                        {place.price_level && <span>{place.price_level}</span>}
                        {place.google_maps_category && (
                          <span className="uppercase tracking-widest text-[10px] bg-stone-800/60 px-2 py-0.5 rounded">
                            {place.google_maps_category}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">
                            timer
                          </span>
                          {stop.duration_minutes} min
                        </span>
                        {place.maps_url && (
                          <a
                            href={place.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-fixed-dim hover:text-primary-fixed flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              map
                            </span>
                            Open in Maps
                          </a>
                        )}
                        {place.website && (
                          <a
                            href={place.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-fixed-dim hover:text-primary-fixed flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              language
                            </span>
                            Website
                          </a>
                        )}
                      </div>
                    )}

                    {/* Combined insights from multiple sources */}
                    {place?.details && (
                      <p className="text-xs text-stone-500 bg-stone-900/40 px-4 py-2 rounded-lg">
                        <span className="material-symbols-outlined text-[12px] text-primary-fixed-dim align-text-bottom mr-1">
                          tips_and_updates
                        </span>
                        {place.details}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Map Column (right) */}
      <div className="w-80 border-l border-stone-800/30 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-stone-800/30 glass-panel">
          <h4 className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">
            Route Perspective
          </h4>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary-fixed-dim text-sm">explore</span>
            <span className="text-xs font-medium text-stone-200">{itinerary.destination}</span>
          </div>
        </div>
        <div className="flex-1">
          <TripMap
            places={currentDay.stops
              .map((s) => findPlace(s))
              .filter((p): p is EnrichedPlace => !!p)}
            selectedPlace={selectedPlace}
            onMarkerClick={(place) => {
              const idx = currentDay.stops.findIndex((s) => findPlace(s)?.place_id === place.place_id);
              setSelectedStopIndex(idx >= 0 ? (idx === selectedStopIndex ? null : idx) : null);
            }}
            numbered
            showRoute
          />
        </div>
        <div className="p-6 glass-panel border-t border-stone-800/30">
          <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-stone-500 mb-3">
            <span>Stops</span>
            <span className="text-stone-200">{currentDay.stops.length}</span>
          </div>
          <button className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-fixed-dim border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors">
            <span className="material-symbols-outlined text-sm">share</span>
            Share Trip
          </button>
        </div>
      </div>
    </div>
  );
}

