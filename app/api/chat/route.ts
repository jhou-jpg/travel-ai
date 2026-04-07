import { CHAT_SYSTEM_PROMPT, buildCollectionContext } from "@/lib/prompts/chat";
import type { EnrichedPlace } from "@/lib/data/schemas";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "qwen/qwen3.5-flash-02-23";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatRequest = {
  messages: ChatMessage[];
  places: EnrichedPlace[];
};

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY not set" },
      { status: 500 }
    );
  }

  try {
    const body: ChatRequest = await request.json();
    const { messages, places } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "messages array required" },
        { status: 400 }
      );
    }

    // Build context-aware system prompt
    const collectionContext = buildCollectionContext(places || []);
    const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\n## User's saved collection\n${collectionContext}`;

    // Only send the last 20 messages to stay within context limits
    const recentMessages = messages.slice(-20);

    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Travel AI Chat",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...recentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "";

    return Response.json({
      reply,
      tokens_used: data.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
