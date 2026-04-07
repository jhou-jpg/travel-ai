"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { APIProvider, Map as GoogleMap, Marker, useMap } from "@vis.gl/react-google-maps";
import CollectionSidebar from "./components/CollectionSidebar";
import PlanPreferenceCard from "./components/PlanPreferenceCard";
import ItineraryCard from "./components/ItineraryCard";
import ActionChips from "./components/ActionChips";

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

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

type ProcessingStep = {
  label: string;
  status: "done" | "running" | "pending";
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  places?: EnrichedPlace[];
  processing?: ProcessingStep[];
  itinerary?: Itinerary;
  attachment?: { type: "url" | "image"; value: string };
  planPrompt?: boolean;
  destinationPhoto?: string;
};

type TripSource = {
  id: string;
  type: "url" | "image";
  label: string;
  addedAt: number;
  placeCount: number;
  mode: string;
};

type CollectionPlace = EnrichedPlace & { sourceType?: string };

// ── Helpers ──

const STORAGE_KEY = "travel-ai-trip";
const CHAT_STORAGE_KEY = "travel-ai-chat-v2";
const URL_REGEX = /https?:\/\/[^\s]+/;
const PLAN_INTENT_REGEX = /\b(plan|itinerary|schedule|organize|generate|create|build|make)\b.*\b(trip|day|itinerary|travel|route|plan)\b/i;

function detectSourceType(url: string): "tiktok" | "instagram" | "link" {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "link";
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function placeKey(p: EnrichedPlace): string {
  if (p.place_id) return `pid:${p.place_id}`;
  const name = (p.canonical_name || p.name).toLowerCase().trim();
  const hint = (p.location_hint || "").toLowerCase().trim();
  return `name:${name}|${hint}`;
}

function mergePlaces(existing: EnrichedPlace[], incoming: EnrichedPlace[]): EnrichedPlace[] {
  const seen = new Map<string, EnrichedPlace>();
  for (const p of existing) seen.set(placeKey(p), p);
  for (const p of incoming) {
    const key = placeKey(p);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, p);
    } else {
      const combinedDetails = [prev.details, p.details].filter(Boolean).join(" | ");
      const combinedClues = [prev.source_clue, p.source_clue].filter(Boolean).join(" | ");
      seen.set(key, {
        ...prev,
        ...(p.verified && !prev.verified ? p : {}),
        ...(p.enrichment_status === "success" && prev.enrichment_status !== "success" ? p : {}),
        details: combinedDetails || prev.details,
        source_clue: combinedClues || prev.source_clue,
        photo_url: prev.photo_url || p.photo_url,
      });
    }
  }
  return Array.from(seen.values());
}

// ── Map Components ──

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

function RoutePolyline({ places }: { places: Array<{ lat?: number; lng?: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const path = places.filter((p) => p.lat && p.lng).map((p) => ({ lat: p.lat!, lng: p.lng! }));
    if (path.length < 2) return;
    const polyline = new google.maps.Polyline({
      path,
      strokeOpacity: 0,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeColor: "#8f482a", scale: 3 },
        offset: "0",
        repeat: "16px",
      }],
      geodesic: true,
    });
    polyline.setMap(map);
    return () => { polyline.setMap(null); };
  }, [map, places]);
  return null;
}

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

// ── Main Component ──

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [places, setPlaces] = useState<CollectionPlace[]>([]);
  const [sources, setSources] = useState<TripSource[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);
  const [activeItinerary, setActiveItinerary] = useState<Itinerary | null>(null);
  const [activeItineraryDay, setActiveItineraryDay] = useState(1);
  const initialized = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load state on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const trip = JSON.parse(raw);
        setPlaces(trip.places || []);
        setSources(trip.sources || []);
      }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        // Clear any stale processing states from previous sessions
        const loaded: ChatMessage[] = JSON.parse(raw);
        setMessages(loaded.map((m) =>
          m.processing
            ? { ...m, content: "This extraction was interrupted. Try again by pasting the link.", processing: undefined }
            : m
        ));
      }
    } catch { /* ignore */ }
  }, []);

  // Persist trip
  useEffect(() => {
    if (!initialized.current) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sources, places }));
  }, [sources, places]);

  // Persist chat
  useEffect(() => {
    if (!initialized.current || messages.length === 0) return;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Sync to Redis
  useEffect(() => {
    if (!initialized.current || places.length === 0) return;
    fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places }),
    }).catch(() => {});
  }, [places]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // URL detection in input
  useEffect(() => {
    const match = input.match(URL_REGEX);
    setDetectedUrl(match ? match[0] : null);
  }, [input]);

  // ── Ingestion (inline in chat) ──

  const ingestUrl = async (url: string) => {
    const msgId = generateId();
    const processingId = generateId();

    // Add user message with attachment
    setMessages((prev) => [...prev, {
      id: msgId, role: "user", content: url, timestamp: Date.now(),
      attachment: { type: "url", value: url },
    }]);

    // Add processing message
    setMessages((prev) => [...prev, {
      id: processingId, role: "assistant", content: "Analyzing your link...",
      timestamp: Date.now(),
      processing: [
        { label: "Fetching content", status: "running" },
        { label: "Extracting places", status: "pending" },
        { label: "Resolving on Google Maps", status: "pending" },
      ],
    }]);

    setInput("");
    setDetectedUrl(null);

    // Simulate progress steps while waiting
    const progressTimer = setTimeout(() => {
      setMessages((prev) => prev.map((m) =>
        m.id === processingId && m.processing
          ? { ...m, processing: [
              { label: "Fetching content", status: "done" },
              { label: "Extracting places", status: "running" },
              { label: "Resolving on Google Maps", status: "pending" },
            ]}
          : m
      ));
    }, 5000);
    const progressTimer2 = setTimeout(() => {
      setMessages((prev) => prev.map((m) =>
        m.id === processingId && m.processing
          ? { ...m, processing: [
              { label: "Fetching content", status: "done" },
              { label: "Extracting places", status: "done" },
              { label: "Resolving on Google Maps", status: "running" },
            ]}
          : m
      ));
    }, 15000);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      clearTimeout(progressTimer);
      clearTimeout(progressTimer2);

      if (!res.ok) {
        setMessages((prev) => prev.map((m) =>
          m.id === processingId
            ? { ...m, content: `Sorry, I couldn't process that link: ${data.error || "Unknown error"}`, processing: undefined }
            : m
        ));
        return;
      }

      const srcType = detectSourceType(url);
      const newPlaces: CollectionPlace[] = (data.enriched_places || []).map(
        (p: EnrichedPlace) => ({ ...p, sourceType: srcType })
      );
      setPlaces((prev) => mergePlaces(prev, newPlaces));
      setSources((prev) => [...prev, {
        id: generateId(), type: "url", label: url,
        addedAt: Date.now(), placeCount: newPlaces.length, mode: data.mode || "url",
      }]);

      // Replace processing message with results
      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? {
              ...m,
              content: newPlaces.length > 0
                ? `I found ${newPlaces.length} place${newPlaces.length !== 1 ? "s" : ""} from that link. Here's what I extracted:`
                : "I couldn't find any specific places in that link. Try sharing a different one, or tell me about your trip!",
              processing: undefined,
              places: newPlaces.length > 0 ? newPlaces : undefined,
            }
          : m
      ));
    } catch {
      clearTimeout(progressTimer);
      clearTimeout(progressTimer2);
      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? { ...m, content: "Sorry, something went wrong processing that link.", processing: undefined }
          : m
      ));
    }
  };

  const ingestImage = async (file: File) => {
    const msgId = generateId();
    const processingId = generateId();
    const preview = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

    setMessages((prev) => [...prev, {
      id: msgId, role: "user", content: file.name, timestamp: Date.now(),
      attachment: { type: "image", value: preview },
    }]);

    setMessages((prev) => [...prev, {
      id: processingId, role: "assistant", content: "Analyzing your screenshot...",
      timestamp: Date.now(),
      processing: [
        { label: "Processing image", status: "running" },
        { label: "Extracting places", status: "pending" },
        { label: "Resolving on Google Maps", status: "pending" },
      ],
    }]);

    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => prev.map((m) =>
          m.id === processingId
            ? { ...m, content: `Couldn't process that image: ${data.error || "Unknown error"}`, processing: undefined }
            : m
        ));
        return;
      }

      const newPlaces: CollectionPlace[] = (data.enriched_places || []).map(
        (p: EnrichedPlace) => ({ ...p, sourceType: "screenshot" as const })
      );
      setPlaces((prev) => mergePlaces(prev, newPlaces));
      setSources((prev) => [...prev, {
        id: generateId(), type: "image", label: file.name,
        addedAt: Date.now(), placeCount: newPlaces.length, mode: data.mode || "image",
      }]);

      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? {
              ...m,
              content: newPlaces.length > 0
                ? `Found ${newPlaces.length} place${newPlaces.length !== 1 ? "s" : ""} from your screenshot:`
                : "I couldn't find specific places in that image. Try another screenshot or tell me about your trip!",
              processing: undefined,
              places: newPlaces.length > 0 ? newPlaces : undefined,
            }
          : m
      ));
    } catch {
      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? { ...m, content: "Sorry, something went wrong processing that image.", processing: undefined }
          : m
      ));
    }
  };

  // ── Chat ──

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    // If URL detected, ingest instead of chatting
    if (detectedUrl && text === detectedUrl) {
      ingestUrl(detectedUrl);
      return;
    }

    // Check if it contains a URL — ingest and chat
    const urlMatch = text.match(URL_REGEX);
    if (urlMatch) {
      ingestUrl(urlMatch[0]);
      return;
    }

    // Check for plan intent — show preference picker
    if (places.length > 0 && PLAN_INTENT_REGEX.test(text)) {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "user", content: text, timestamp: Date.now() },
        { id: generateId(), role: "assistant", content: "Let me help you plan! Choose your preferences:", timestamp: Date.now(), planPrompt: true },
      ]);
      setInput("");
      return;
    }

    const userMsg: ChatMessage = {
      id: generateId(), role: "user", content: text, timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          places,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [...prev, {
          id: generateId(), role: "assistant",
          content: `Sorry, something went wrong: ${data.error || "Unknown error"}`,
          timestamp: Date.now(),
        }]);
        return;
      }
      setMessages((prev) => [...prev, {
        id: generateId(), role: "assistant", content: data.reply, timestamp: Date.now(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: generateId(), role: "assistant",
        content: "Sorry, I couldn't connect. Please try again.",
        timestamp: Date.now(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) ingestImage(f);
  }, []);

  const clearAll = () => {
    setMessages([]);
    setPlaces([]);
    setSources([]);
    setSelectedPlace(null);
    setActiveItinerary(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHAT_STORAGE_KEY);
  };

  const showPlanPrompt = () => {
    setMessages((prev) => [...prev, {
      id: generateId(), role: "assistant",
      content: "Let's build your itinerary! Choose your preferences:",
      timestamp: Date.now(), planPrompt: true,
    }]);
  };

  const generateItinerary = async (duration: number, pace: "relaxed" | "balanced" | "packed") => {
    const processingId = generateId();

    // Remove the plan prompt message, add processing
    setMessages((prev) => [
      ...prev.map((m) => m.planPrompt ? { ...m, planPrompt: false, content: `Planning a ${duration}-day ${pace} trip...` } : m),
      {
        id: processingId, role: "assistant" as const,
        content: "Building your itinerary...",
        timestamp: Date.now(),
        processing: [
          { label: "Analyzing places", status: "running" as const },
          { label: "Optimizing route", status: "pending" as const },
          { label: "Writing editorial notes", status: "pending" as const },
        ],
      },
    ]);

    const progressTimer = setTimeout(() => {
      setMessages((prev) => prev.map((m) =>
        m.id === processingId && m.processing
          ? { ...m, processing: [
              { label: "Analyzing places", status: "done" as const },
              { label: "Optimizing route", status: "running" as const },
              { label: "Writing editorial notes", status: "pending" as const },
            ]}
          : m
      ));
    }, 5000);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places, duration, pace }),
      });
      const data = await res.json();
      clearTimeout(progressTimer);

      if (!res.ok) {
        setMessages((prev) => prev.map((m) =>
          m.id === processingId
            ? { ...m, content: `Sorry, couldn't generate the itinerary: ${data.error || "Unknown error"}`, processing: undefined }
            : m
        ));
        return;
      }

      const itinerary: Itinerary = data.itinerary;
      setActiveItinerary(itinerary);
      setActiveItineraryDay(1);

      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? {
              ...m,
              content: `Here's your ${duration}-day itinerary for ${itinerary.destination}:`,
              processing: undefined,
              itinerary,
              destinationPhoto: data.destination_photo_url || undefined,
            }
          : m
      ));
    } catch {
      clearTimeout(progressTimer);
      setMessages((prev) => prev.map((m) =>
        m.id === processingId
          ? { ...m, content: "Sorry, something went wrong generating the itinerary.", processing: undefined }
          : m
      ));
    }
  };

  const shareTrip = async () => {
    if (!activeItinerary) return;
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itinerary: activeItinerary, places }),
      });
      const data = await res.json();
      if (res.ok && data.slug) {
        const shareUrl = `${window.location.origin}/trip/${data.slug}`;
        navigator.clipboard.writeText(shareUrl);
        setMessages((prev) => [...prev, {
          id: generateId(), role: "assistant",
          content: `Trip shared! Link copied to clipboard: ${shareUrl}`,
          timestamp: Date.now(),
        }]);
      }
    } catch { /* ignore */ }
  };

  const hasPlaces = places.length > 0;

  // Map shows itinerary day stops when active, otherwise all places
  const mapPlaces = useMemo(() => {
    if (activeItinerary) {
      const day = activeItinerary.days.find((d) => d.day === activeItineraryDay);
      if (day) {
        const placeMap = new Map<string, CollectionPlace>();
        for (const p of places) {
          if (p.place_id) placeMap.set(p.place_id, p);
          placeMap.set((p.canonical_name || p.name).toLowerCase(), p);
        }
        return day.stops
          .map((stop) =>
            (stop.place_id && placeMap.get(stop.place_id)) ||
            placeMap.get(stop.place_name.toLowerCase())
          )
          .filter((p): p is CollectionPlace => !!p && !!p.lat && !!p.lng);
      }
    }
    return places.filter((p) => p.lat && p.lng);
  }, [activeItinerary, activeItineraryDay, places]);

  return (
    <div className="h-screen flex flex-col">
      {/* Top Nav */}
      <nav className="flex justify-between items-center px-8 h-16 w-full bg-surface border-b border-outline-variant/10 flex-shrink-0 z-50">
        <div className="text-xl font-headline italic text-on-surface">Travel AI</div>
        <div className="flex items-center gap-4">
          {hasPlaces && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden flex items-center gap-2 px-4 py-2 text-xs font-medium uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-sm">auto_stories</span>
              {places.length} places
            </button>
          )}
          {hasPlaces && (
            <button
              onClick={clearAll}
              className="text-xs uppercase tracking-widest text-on-surface-variant/60 hover:text-error transition-colors"
            >
              New trip
            </button>
          )}
          <span className="material-symbols-outlined text-primary cursor-pointer">account_circle</span>
        </div>
      </nav>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Collection Sidebar — always visible on lg, toggle on mobile */}
        <div className="hidden lg:block">
          <CollectionSidebar
            places={places}
            selectedPlace={selectedPlace}
            onPlaceClick={(p) => {
              const match = places.find((pl) => pl.place_id === p.place_id);
              setSelectedPlace(selectedPlace?.place_id === p.place_id ? null : match || null);
            }}
            onGenerateItinerary={showPlanPrompt}
            onClose={() => setSidebarOpen(false)}
            isMobile={false}
          />
        </div>
        {sidebarOpen && (
          <div className="lg:hidden">
            <CollectionSidebar
              places={places}
              selectedPlace={selectedPlace}
              onPlaceClick={(p) => {
                const match = places.find((pl) => pl.place_id === p.place_id);
                setSelectedPlace(match || null);
                setSidebarOpen(false);
              }}
              onGenerateItinerary={() => { showPlanPrompt(); setSidebarOpen(false); }}
              onClose={() => setSidebarOpen(false)}
              isMobile={true}
            />
          </div>
        )}

        {/* Chat Panel */}
        <section
          className="flex-1 flex flex-col bg-surface relative"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {messages.length === 0 ? (
            /* ── Empty State ── */
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto px-6 text-center">
              <div className="mb-8">
                <h1 className="text-4xl md:text-5xl font-headline font-bold text-on-surface tracking-tight mb-4">
                  Where are we <span className="serif-italic text-primary">going?</span>
                </h1>
                <p className="text-on-surface-variant font-body leading-relaxed text-lg opacity-80">
                  Drop a link, upload a screenshot, or just start typing.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mb-12">
                {[
                  { icon: "video_library", label: "Add a TikTok" },
                  { icon: "image", label: "Upload a screenshot" },
                  { icon: "chat", label: "Plan from scratch" },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => {
                      if (chip.icon === "image") fileInputRef.current?.click();
                      else inputRef.current?.focus();
                    }}
                    className="px-5 py-2.5 bg-surface-container-high rounded-full text-sm font-medium hover:bg-surface-container-highest transition-colors flex items-center gap-2 text-on-surface"
                  >
                    <span className="material-symbols-outlined text-sm">{chip.icon}</span>
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Chat Messages ── */
            <div className="flex-1 overflow-y-auto px-6 md:px-12 py-8 custom-scrollbar">
              <div className="max-w-2xl mx-auto space-y-8">
                {messages.map((msg, idx) => {
                  const isLastAssistant = msg.role === "assistant" &&
                    !messages.slice(idx + 1).some((m) => m.role === "assistant");
                  return (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      allPlaces={places}
                      onPlaceClick={setSelectedPlace}
                      onGenerateItinerary={generateItinerary}
                      onDaySelect={(day) => setActiveItineraryDay(day)}
                      onShare={shareTrip}
                      onRegenerate={showPlanPrompt}
                      isLast={isLastAssistant}
                      hasPlaces={hasPlaces}
                      hasItinerary={!!activeItinerary}
                      onSetInput={(text) => { setInput(text); inputRef.current?.focus(); }}
                    />
                  );
                })}
                {sending && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full terracotta-gradient flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                    </div>
                    <div className="flex gap-1 items-center pt-2">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full pulsing-dot" />
                      <div className="w-1.5 h-1.5 bg-primary rounded-full pulsing-dot" style={{ animationDelay: "0.3s" }} />
                      <div className="w-1.5 h-1.5 bg-primary rounded-full pulsing-dot" style={{ animationDelay: "0.6s" }} />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="px-6 md:px-12 py-6 bg-gradient-to-t from-surface via-surface to-transparent">
            {/* URL detection chip */}
            {detectedUrl && (
              <div className="max-w-2xl mx-auto mb-3">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-fixed/30 border border-primary/20 rounded-full text-xs">
                  <span className="material-symbols-outlined text-primary text-sm">link</span>
                  <span className="text-on-surface-variant truncate max-w-xs">{detectedUrl}</span>
                  <span className="text-primary font-medium">Press Enter to extract places</span>
                </div>
              </div>
            )}
            <div className="max-w-2xl mx-auto glass-panel rounded-2xl px-4 py-3 flex items-end gap-3 border border-outline-variant/20 editorial-shadow">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-colors flex-shrink-0"
              >
                <span className="material-symbols-outlined">image</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) ingestImage(f);
                  e.target.value = "";
                }}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste a link, drop a screenshot, or describe your dream trip..."
                rows={1}
                className="flex-1 bg-transparent border-none focus:ring-0 text-on-surface text-sm font-body placeholder:text-on-surface-variant/40 resize-none max-h-32"
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                className="w-10 h-10 rounded-full terracotta-gradient text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-lg">arrow_upward</span>
              </button>
            </div>
          </div>
        </section>

        {/* Map Panel */}
        <section className="w-[36%] bg-on-surface relative overflow-hidden hidden lg:block border-l border-outline-variant/10 flex-shrink-0">
          {mapPlaces.length > 0 ? (
            MAPS_API_KEY ? (
              <APIProvider apiKey={MAPS_API_KEY}>
                <MapContent
                  places={mapPlaces}
                  selectedPlace={selectedPlace}
                  onMarkerClick={(p) => setSelectedPlace(selectedPlace?.place_id === p.place_id ? null : p)}
                />
              </APIProvider>
            ) : (
              <MapPlaceholder message="Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" />
            )
          ) : (
            /* Empty map state */
            <div className="h-full w-full flex items-center justify-center p-12 bg-surface-container-low">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center border border-outline/20 rounded-full">
                  <span className="material-symbols-outlined text-3xl text-outline-variant">map</span>
                </div>
                <h3 className="font-headline text-xl text-on-surface-variant italic">The canvas awaits.</h3>
                <p className="text-sm text-on-surface-variant/60 font-body mt-2 tracking-widest uppercase">
                  Start your journey to see the map
                </p>
              </div>
            </div>
          )}

          {/* Map overlay info */}
          {selectedPlace && (
            <div className="absolute bottom-6 left-6 right-6 z-10">
              <div className="glass-panel p-4 rounded-xl border border-outline-variant/20 editorial-shadow">
                <div className="flex items-center gap-3">
                  {selectedPlace.photo_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={selectedPlace.photo_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-headline text-sm font-bold text-on-surface">
                      {selectedPlace.canonical_name || selectedPlace.name}
                    </h4>
                    <p className="text-xs text-on-surface-variant truncate">
                      {selectedPlace.address || selectedPlace.google_maps_category}
                    </p>
                  </div>
                  {selectedPlace.rating && (
                    <span className="text-xs text-primary font-bold">★ {selectedPlace.rating}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── MapContent (renders inside APIProvider so google is available) ──

function MapContent({
  places,
  selectedPlace,
  onMarkerClick,
}: {
  places: EnrichedPlace[];
  selectedPlace: EnrichedPlace | null;
  onMarkerClick: (p: EnrichedPlace) => void;
}) {
  const map = useMap();
  if (!places.length) return null;

  return (
    <GoogleMap
      defaultCenter={{ lat: places[0].lat!, lng: places[0].lng! }}
      defaultZoom={12}
      styles={DARK_MAP_STYLES}
      disableDefaultUI={true}
      zoomControl={true}
      gestureHandling="greedy"
      className="w-full h-full"
    >
      <FitBounds places={selectedPlace?.lat ? [] : places} />
      {selectedPlace?.lat && selectedPlace?.lng && (
        <ZoomToPlace lat={selectedPlace.lat} lng={selectedPlace.lng} />
      )}
      <RoutePolyline places={places} />
      {places.map((place, i) => {
        const isSelected = selectedPlace?.place_id === place.place_id;
        return (
          <Marker
            key={place.place_id || `m-${i}`}
            position={{ lat: place.lat!, lng: place.lng! }}
            title={place.canonical_name || place.name}
            onClick={() => onMarkerClick(place)}
            label={{
              text: String(i + 1),
              color: "#fff",
              fontSize: "11px",
              fontWeight: "bold",
            }}
            icon={map && typeof google !== "undefined" ? {
              path: 0,
              scale: isSelected ? 14 : 11,
              fillColor: isSelected ? "#ffb598" : "#8f482a",
              fillOpacity: 1,
              strokeColor: "#1a1714",
              strokeWeight: 2,
              labelOrigin: new google.maps.Point(0, 0),
            } : undefined}
          />
        );
      })}
    </GoogleMap>
  );
}

// ── ZoomToPlace ──

function ZoomToPlace({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo({ lat, lng });
    map.setZoom(16);
  }, [map, lat, lng]);
  return null;
}

// ── Map Placeholder ──

function MapPlaceholder({ message }: { message: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-surface-container-low">
      <div className="text-center text-on-surface-variant/60">
        <span className="material-symbols-outlined text-4xl mb-2 block">map</span>
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({
  msg,
  allPlaces,
  onPlaceClick,
  onGenerateItinerary,
  onDaySelect,
  onShare,
  onRegenerate,
  isLast,
  hasPlaces,
  hasItinerary,
  onSetInput,
}: {
  msg: ChatMessage;
  allPlaces: EnrichedPlace[];
  onPlaceClick: (p: EnrichedPlace) => void;
  onGenerateItinerary?: (duration: number, pace: "relaxed" | "balanced" | "packed") => void;
  onDaySelect?: (day: number) => void;
  onShare?: () => void;
  onRegenerate?: () => void;
  isLast: boolean;
  hasPlaces: boolean;
  hasItinerary: boolean;
  onSetInput?: (text: string) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {msg.attachment?.type === "image" && (
          <div className="w-48 h-32 rounded-xl overflow-hidden border border-outline-variant/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={msg.attachment.value} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="bg-surface-container-highest text-on-surface px-5 py-3 rounded-2xl rounded-tr-none max-w-md">
          {msg.attachment?.type === "url" ? (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-outline">link</span>
              <span className="text-sm truncate">{msg.content}</span>
            </div>
          ) : (
            <p className="text-sm leading-relaxed">{msg.content}</p>
          )}
        </div>
        <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full terracotta-gradient flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
      </div>
      <div className="flex-1 space-y-4 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">AI Assistant</span>

        {/* Processing steps */}
        {msg.processing && (
          <div className="space-y-3 py-3 border-t border-outline-variant/10">
            {msg.processing.map((step, i) => (
              <div key={i} className="flex items-center justify-between text-xs uppercase tracking-widest">
                <div className="flex items-center gap-3">
                  {step.status === "done" && <span className="material-symbols-outlined text-sm text-primary">check_circle</span>}
                  {step.status === "running" && <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
                  {step.status === "pending" && <div className="w-3 h-3 rounded-full bg-outline-variant/30" />}
                  <span className={step.status === "pending" ? "text-on-surface-variant/40" : "text-on-surface"}>
                    {step.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Text content */}
        {!msg.processing && (
          <div className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
            <FormattedMessage content={msg.content} />
          </div>
        )}

        {/* Plan preference picker */}
        {msg.planPrompt && onGenerateItinerary && (
          <PlanPreferenceCard placeCount={allPlaces.length} onGenerate={onGenerateItinerary} />
        )}

        {/* Inline itinerary card */}
        {msg.itinerary && (
          <ItineraryCard
            itinerary={msg.itinerary}
            places={allPlaces}
            onDaySelect={onDaySelect}
            onShare={onShare}
            onRegenerate={onRegenerate}
          />
        )}

        {/* Inline place cards */}
        {msg.places && msg.places.length > 0 && (
          <div className="space-y-3 pt-2">
            {msg.places.map((place, i) => (
              <div
                key={`${msg.id}-place-${i}`}
                onClick={() => onPlaceClick(place)}
                className="group flex gap-4 p-4 rounded-xl bg-surface-container-low border-b border-outline-variant/20 hover:bg-surface-container transition-colors cursor-pointer"
              >
                {place.photo_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={place.photo_url} alt={place.canonical_name || place.name}
                    className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-widest text-outline font-bold">
                    {place.google_maps_category || place.category}
                  </span>
                  <h3 className="font-headline text-lg text-on-surface">
                    {place.canonical_name || place.name}
                  </h3>
                  <p className="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
                    {place.details || place.address}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-on-surface-variant">
                    {place.rating && <span className="text-primary">★ {place.rating}</span>}
                    {place.price_level && <span>{place.price_level}</span>}
                    {place.verified && (
                      <span className="text-[10px] uppercase tracking-widest text-primary/60">Verified</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <span className="material-symbols-outlined text-primary-container opacity-0 group-hover:opacity-100 transition-opacity">
                    arrow_forward_ios
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contextual action chips — only on last assistant message */}
        {isLast && !msg.processing && !msg.planPrompt && (
          <ActionChips chips={(() => {
            const chips: Array<{ label: string; icon: string; action: () => void }> = [];
            if (msg.places && msg.places.length > 0 && hasPlaces) {
              chips.push({ label: "Generate itinerary", icon: "route", action: () => onGenerateItinerary?.(3, "balanced") || onSetInput?.("plan my trip") });
              chips.push({ label: "Add more places", icon: "add", action: () => onSetInput?.("") });
            } else if (msg.itinerary) {
              if (onShare) chips.push({ label: "Share trip", icon: "share", action: onShare });
              if (onRegenerate) chips.push({ label: "Regenerate", icon: "refresh", action: onRegenerate });
            } else if (hasPlaces && !hasItinerary) {
              chips.push({ label: "Generate itinerary", icon: "route", action: () => onSetInput?.("plan my trip") });
              chips.push({ label: "What's nearby?", icon: "near_me", action: () => onSetInput?.("What else is nearby my saved places?") });
            }
            return chips;
          })()} />
        )}
      </div>
    </div>
  );
}

// ── Formatted Message ──

function FormattedMessage({ content }: { content: string }) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="text-primary font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
