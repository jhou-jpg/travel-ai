"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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

type EnrichedPlace = {
  name: string;
  canonical_name?: string;
  category?: string;
  address?: string;
  lat?: number;
  lng?: number;
  maps_url?: string;
  rating?: number;
  review_count?: number;
  price_level?: string;
  photo_url?: string;
  google_maps_category?: string;
  place_id?: string;
  verified: boolean;
  details?: string;
  website?: string;
  hours?: string[];
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

type SharedTrip = {
  itinerary: Itinerary;
  places: EnrichedPlace[];
  destinationPhoto?: string | null;
  createdAt: number;
};

// ── Map helpers ──

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

export default function SharedTripPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(1);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/share/${slug}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Trip not found");
          return;
        }
        const data: SharedTrip = await res.json();
        setTrip(data);
      } catch {
        setError("Failed to load trip");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-primary-fixed-dim text-4xl animate-spin block mb-4">
            progress_activity
          </span>
          <p className="text-stone-400 text-sm">Loading shared trip...</p>
        </div>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <span className="material-symbols-outlined text-stone-600 text-5xl block mb-4">
            explore_off
          </span>
          <h1 className="font-headline text-2xl text-stone-200 italic mb-2">
            Trip not found
          </h1>
          <p className="text-stone-500 text-sm mb-6">
            {error || "This trip may have expired or the link is invalid."}
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 terracotta-gradient text-white rounded-xl text-sm font-medium"
          >
            Plan your own trip
          </Link>
        </div>
      </div>
    );
  }

  const { itinerary, places } = trip;
  const currentDay = itinerary.days.find((d) => d.day === activeDay) || itinerary.days[0];

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

  const dayPlaces = currentDay.stops
    .map((s) => findPlace(s))
    .filter((p): p is EnrichedPlace => !!p);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <header className="relative h-64 overflow-hidden">
        {trip.destinationPhoto && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={trip.destinationPhoto}
            alt={itinerary.destination}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-[#1a1714]" />
        <div className="relative z-10 h-full flex flex-col justify-end p-8 max-w-4xl mx-auto">
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary-fixed-dim font-bold mb-2">
            Shared Itinerary
          </p>
          <h1 className="font-headline text-4xl md:text-5xl text-white italic tracking-tight">
            {itinerary.destination}
          </h1>
          <p className="text-stone-300 text-sm mt-2">
            {itinerary.days.length} days &middot; {places.length} places
          </p>
        </div>
      </header>

      {/* Day tabs */}
      <div className="border-b border-stone-800/30 sticky top-0 z-20 bg-[#1a1714]/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-8 flex gap-1 overflow-x-auto">
          {itinerary.days.map((day) => (
            <button
              key={day.day}
              onClick={() => setActiveDay(day.day)}
              className={`px-5 py-3 text-xs tracking-widest uppercase whitespace-nowrap transition-all border-b-2 ${
                activeDay === day.day
                  ? "text-primary-fixed-dim border-primary-fixed-dim font-bold"
                  : "text-stone-500 border-transparent hover:text-stone-300"
              }`}
            >
              Day {day.day}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-12">
        {/* Day header */}
        <div className="mb-12">
          <h2 className="font-headline text-3xl text-stone-50 italic tracking-tight mb-3">
            {currentDay.title}
          </h2>
          <p className="font-serif italic text-stone-400 leading-relaxed">
            &ldquo;{currentDay.description}&rdquo;
          </p>
        </div>

        <div className="flex gap-8">
          {/* Stops */}
          <div className="flex-1 space-y-12 pl-6 relative">
            {currentDay.stops.map((stop, i) => {
              const place = findPlace(stop);
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-0 h-full w-px bg-stone-800" />
                  <div className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-[#1a1714] border-2 border-primary-fixed-dim" />

                  <div className="space-y-4">
                    <div className="flex justify-between items-baseline gap-4">
                      <h3 className="font-headline text-xl text-stone-100">
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

                    {place?.photo_url && (
                      <div className="w-full h-48 overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={place.photo_url}
                          alt={stop.place_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    <blockquote className="font-serif italic text-stone-400 pl-5 border-l-2 border-primary/20 py-1 leading-relaxed text-sm">
                      {stop.editorial_note}
                    </blockquote>

                    {place && (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        {place.rating && (
                          <span className="text-yellow-400">
                            {"★".repeat(Math.round(place.rating))} {place.rating}
                          </span>
                        )}
                        {place.price_level && <span>{place.price_level}</span>}
                        {place.google_maps_category && (
                          <span className="uppercase tracking-widest text-[10px] bg-stone-800/60 px-2 py-0.5 rounded">
                            {place.google_maps_category}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">timer</span>
                          {stop.duration_minutes} min
                        </span>
                        {place.maps_url && (
                          <a
                            href={place.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-fixed-dim hover:text-primary-fixed flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">map</span>
                            Maps
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mini map */}
          {MAPS_API_KEY && dayPlaces.length > 0 && (
            <div className="w-72 flex-shrink-0 sticky top-16 h-[400px] rounded-xl overflow-hidden border border-stone-800/30">
              <APIProvider apiKey={MAPS_API_KEY}>
                <GoogleMap
                  defaultCenter={{ lat: dayPlaces[0].lat!, lng: dayPlaces[0].lng! }}
                  defaultZoom={13}
                  styles={DARK_MAP_STYLES}
                  disableDefaultUI={true}
                  zoomControl={true}
                  className="w-full h-full"
                >
                  <FitBounds places={dayPlaces} />
                  <RoutePolyline places={dayPlaces} />
                  {dayPlaces.map((place, i) => (
                    <Marker
                      key={place.place_id || `m-${i}`}
                      position={{ lat: place.lat!, lng: place.lng! }}
                      title={place.canonical_name || place.name}
                      label={{
                        text: String(i + 1),
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: "bold",
                      }}
                      icon={{
                        path: 0,
                        scale: 11,
                        fillColor: "#ad603f",
                        fillOpacity: 1,
                        strokeColor: "#1a1714",
                        strokeWeight: 2,
                        labelOrigin: new google.maps.Point(0, 0),
                      }}
                    />
                  ))}
                </GoogleMap>
              </APIProvider>
            </div>
          )}
        </div>
      </div>

      {/* CTA footer */}
      <div className="border-t border-stone-800/30 py-8 text-center">
        <p className="text-stone-500 text-sm mb-4">Want to plan your own trip?</p>
        <Link
          href="/"
          className="inline-block px-8 py-3 terracotta-gradient text-white rounded-xl text-sm font-medium tracking-wide"
        >
          Start Planning
        </Link>
      </div>
    </div>
  );
}
