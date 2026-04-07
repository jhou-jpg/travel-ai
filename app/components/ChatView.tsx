"use client";

import { useState, useEffect, useRef } from "react";

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
  location_hint?: string;
  hours?: string[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function ChatView({
  places,
  messages,
  setMessages,
}: {
  places: EnrichedPlace[];
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          places,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: "assistant" as const, content: `Sorry, something went wrong: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "assistant" as const, content: data.reply, timestamp: Date.now() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "assistant" as const, content: "Sorry, I couldn't connect. Please try again.", timestamp: Date.now() },
      ]);
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

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="px-8 py-6 border-b border-stone-800/30 flex-shrink-0">
        <div className="flex items-baseline gap-4 mb-1">
          <span className="text-primary-fixed-dim font-bold tracking-[0.2em] text-xs uppercase">
            Trip Assistant
          </span>
          <div className="h-px flex-grow bg-stone-800"></div>
          <span className="text-[10px] text-stone-600 uppercase tracking-widest">
            {places.length} saved places
          </span>
        </div>
        <h2 className="text-2xl font-headline font-bold text-stone-50 italic tracking-tight">
          Let&apos;s plan your trip
        </h2>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-stone-800/60 rounded-full flex items-center justify-center mx-auto mb-6">
                <span
                  className="material-symbols-outlined text-primary-fixed-dim text-2xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  auto_awesome
                </span>
              </div>
              <h3 className="font-headline text-xl text-stone-200 italic mb-2">
                Your travel assistant
              </h3>
              <p className="text-stone-500 text-sm max-w-md mx-auto leading-relaxed mb-8">
                I can see your {places.length} saved places. Ask me anything — how to
                group them by neighborhood, what order to visit, where to eat nearby,
                or help filling gaps in your trip.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  "How should I group these places?",
                  "What's missing from my trip?",
                  "Help me plan a food-focused day",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="px-4 py-2 text-xs text-stone-400 border border-stone-700/50 rounded-full hover:border-primary/40 hover:text-primary-fixed-dim transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  msg.role === "user"
                    ? "terracotta-gradient text-white"
                    : "glass-panel border border-stone-800/30 text-stone-200"
                }`}
              >
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.role === "assistant" ? (
                    <FormattedMessage content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
                <p className={`text-[10px] mt-2 ${msg.role === "user" ? "text-white/50" : "text-stone-600"}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="glass-panel border border-stone-800/30 rounded-2xl px-5 py-3">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-primary-fixed-dim pulsing-dot" />
                  <div className="w-2 h-2 rounded-full bg-primary-fixed-dim pulsing-dot" style={{ animationDelay: "0.3s" }} />
                  <div className="w-2 h-2 rounded-full bg-primary-fixed-dim pulsing-dot" style={{ animationDelay: "0.6s" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-stone-800/30 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your trip..."
            rows={1}
            className="flex-1 bg-stone-900/60 border border-stone-700/50 rounded-xl px-5 py-3 text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-primary/50 transition-colors resize-none text-sm"
          />
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            className="px-5 terracotta-gradient text-white rounded-xl transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]">
              {sending ? "progress_activity" : "send"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="text-primary-fixed-dim font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
