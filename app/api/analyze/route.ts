import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import * as cheerio from "cheerio";
import {
  SCREENSHOT_PARSE_PROMPT,
  URL_CONTENT_PARSE_PROMPT,
} from "@/lib/prompts/screenshot-parse";
import { ExtractionResultSchema, type ExtractedPlace } from "@/lib/data/schemas";
import { resolvePlaces } from "@/lib/data/place-resolver";
import { enrichPlaces } from "@/lib/data/enricher";

const execFileAsync = promisify(execFile);

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SCRAPECREATORS_TIKTOK_URL = "https://api.scrapecreators.com/v2/tiktok/video";
const SCRAPECREATORS_IG_POST_URL = "https://api.scrapecreators.com/v1/instagram/post";
const SCRAPECREATORS_IG_TRANSCRIPT_URL = "https://api.scrapecreators.com/v2/instagram/media/transcript";

// Cheap models — prices per 1M tokens
// Vision: qwen/qwen3.5-flash-02-23 — $0.065 in / $0.26 out
// Text:   qwen/qwen3.5-flash-02-23 — $0.065 in / $0.26 out
const VISION_MODEL = "qwen/qwen3.5-flash-02-23";
const TEXT_MODEL = "qwen/qwen3.5-flash-02-23";

// Frame extraction: ~1 frame every 2 seconds
const FRAMES_PER_SECOND = 0.5;
const MAX_FRAMES = 60; // cap for very long videos

// Pricing per token (for cost estimation)
const PRICING = {
  "qwen/qwen3.5-flash-02-23": { input: 0.065 / 1_000_000, output: 0.26 / 1_000_000 },
} as Record<string, { input: number; output: number }>;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

function estimateCost(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number }
) {
  const price = PRICING[model];
  if (!price || !usage) return null;
  const inputCost = (usage.prompt_tokens || 0) * price.input;
  const outputCost = (usage.completion_tokens || 0) * price.output;
  return {
    input_cost: inputCost,
    output_cost: outputCost,
    total_cost: inputCost + outputCost,
    formatted: `$${(inputCost + outputCost).toFixed(6)}`,
  };
}

async function callOpenRouter(model: string, messages: ChatMessage[]) {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Travel AI Vision Test",
    },
    body: JSON.stringify({ model, messages, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  return res.json();
}

// ── Platform detection ──

function isTikTokURL(url: string): boolean {
  return /tiktok\.com/i.test(url);
}

function isInstagramURL(url: string): boolean {
  return /instagram\.com|instagr\.am/i.test(url);
}

// ── ScrapCreators helpers ──

async function scrapCreatorsGet(endpoint: string, params: Record<string, string>) {
  const apiUrl = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) {
    apiUrl.searchParams.set(k, v);
  }

  const res = await fetch(apiUrl.toString(), {
    headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY || "" },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ScrapCreators error (${res.status}): ${err}`);
  }

  return res.json();
}

async function fetchTikTokData(url: string) {
  return scrapCreatorsGet(SCRAPECREATORS_TIKTOK_URL, { url, get_transcript: "true" });
}

async function fetchInstagramData(url: string) {
  return scrapCreatorsGet(SCRAPECREATORS_IG_POST_URL, { url });
}

async function fetchInstagramTranscript(url: string) {
  try {
    return await scrapCreatorsGet(SCRAPECREATORS_IG_TRANSCRIPT_URL, { url });
  } catch {
    return null; // Transcript endpoint may fail for non-video posts
  }
}

async function downloadVideo(videoUrl: string, destPath: string) {
  const res = await fetch(videoUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://www.tiktok.com/",
    },
  });

  if (!res.ok) throw new Error(`Video download failed: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  return destPath;
}

async function extractFrames(videoPath: string, outDir: string) {
  // Get video duration first
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ]);

  const duration = parseFloat(stdout.trim());
  if (isNaN(duration) || duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  // ~1 frame every 2 seconds, capped at MAX_FRAMES
  const desiredFrames = Math.min(
    Math.max(Math.ceil(duration * FRAMES_PER_SECOND), 4),
    MAX_FRAMES
  );
  const interval = duration / (desiredFrames + 1);

  // Extract frames at regular intervals
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vf", `fps=1/${interval}`,
    "-frames:v", String(desiredFrames),
    "-q:v", "2",
    join(outDir, "frame_%03d.jpg"),
  ]);

  // Read extracted frames
  const frames: { base64: string; index: number }[] = [];
  for (let i = 1; i <= MAX_FRAMES; i++) {
    const framePath = join(outDir, `frame_${String(i).padStart(3, "0")}.jpg`);
    try {
      const data = await readFile(framePath);
      frames.push({ base64: data.toString("base64"), index: i });
    } catch {
      break; // No more frames
    }
  }

  return { frames, duration };
}

async function extractAudioAndTranscribe(videoPath: string, workDir: string) {
  const audioPath = join(workDir, "audio.mp3");

  // Extract audio from video
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vn", "-acodec", "libmp3lame", "-q:a", "4",
    audioPath,
  ]);

  const audioData = await readFile(audioPath);
  const audioBase64 = audioData.toString("base64");

  // Transcribe via OpenRouter with Whisper
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`,
    },
    body: await (async () => {
      const form = new FormData();
      form.append("file", new Blob([audioData], { type: "audio/mpeg" }), "audio.mp3");
      form.append("model", "whisper-1");
      return form;
    })(),
  });

  if (!res.ok) {
    // Fallback: if no OpenAI key, try OpenRouter for transcription
    // For now just return null
    console.error("Whisper transcription failed:", await res.text());
    return null;
  }

  const result = await res.json();
  return result.text || null;
}

async function analyzeTikTok(url: string) {
  // 1. Get video data from ScrapCreators
  const tiktokData = await fetchTikTokData(url);
  const detail = tiktokData?.aweme_detail || tiktokData;

  const caption = detail?.desc || "";
  let transcript = detail?.transcript || "";
  const author = detail?.author?.nickname || "";
  const stats = detail?.statistics || {};

  // Try to find a download URL
  const videoUrl =
    detail?.video?.download_no_watermark_addr?.url_list?.[0] ||
    detail?.video?.download_addr?.url_list?.[0] ||
    detail?.video?.play_addr?.url_list?.[0] ||
    null;

  // 2. Download video, extract frames + audio transcript
  let frames: { base64: string; index: number }[] = [];
  let duration = 0;
  const workDir = join(tmpdir(), `travel-ai-${Date.now()}`);

  if (videoUrl) {
    try {
      await mkdir(workDir, { recursive: true });
      const videoPath = join(workDir, "video.mp4");
      await downloadVideo(videoUrl, videoPath);
      const result = await extractFrames(videoPath, workDir);
      frames = result.frames;
      duration = result.duration;

      // If no transcript from ScrapCreators, try Whisper
      if (!transcript && process.env.OPENAI_API_KEY) {
        try {
          const whisperResult = await extractAudioAndTranscribe(videoPath, workDir);
          if (whisperResult) transcript = whisperResult;
        } catch (err) {
          console.error("Whisper transcription failed:", err);
        }
      }
    } catch (err) {
      console.error("Frame extraction failed:", err);
    } finally {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 3. Build the vision request with frames + text context
  const contentParts: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [];

  // Add frames as images
  for (const frame of frames) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
    });
  }

  // Build context text
  let contextText = `Analyzing a TikTok video from @${author}.\n`;
  if (caption) contextText += `\nCaption: "${caption}"`;
  if (transcript) contextText += `\nTranscript/Voiceover: "${transcript}"`;
  contextText += `\nVideo duration: ${duration.toFixed(1)}s`;
  contextText += `\nFrames extracted: ${frames.length}`;
  if (stats.play_count) contextText += `\nViews: ${stats.play_count}`;

  const prompt = frames.length > 0
    ? `${SCREENSHOT_PARSE_PROMPT}\n\nContext about this TikTok video:\n${contextText}\n\nAnalyze ALL ${frames.length} frames above for travel-relevant information. Look for signage, location names, food, landmarks, and any text overlays across all frames.\n\nYou MUST respond with ONLY a valid JSON object, no other text.`
    : `${URL_CONTENT_PARSE_PROMPT}\n\nContext about this TikTok video:\n${contextText}\n\nYou MUST respond with ONLY a valid JSON object, no other text.`;

  contentParts.push({ type: "text", text: prompt });

  const messages: ChatMessage[] = [
    { role: "user", content: contentParts },
  ];

  const model = frames.length > 0 ? VISION_MODEL : TEXT_MODEL;
  const response = await callOpenRouter(model, messages);
  const text = response.choices?.[0]?.message?.content || "";
  const parsed = extractJSON(text);
  const { validated, enriched_places } = await resolveAndEnrich(parsed);

  return {
    mode: "tiktok",
    model,
    url,
    tiktok: {
      caption,
      author,
      transcript: transcript || null,
      duration,
      framesExtracted: frames.length,
      hasVideo: !!videoUrl,
      stats: {
        plays: stats.play_count,
        likes: stats.digg_count,
        comments: stats.comment_count,
        shares: stats.share_count,
      },
    },
    analysis: validated,
    enriched_places,
    raw_response: text,
    tokens_used: response.usage,
    cost: estimateCost(model, response.usage),
  };
}

// ── Instagram pipeline: ScrapCreators → images/video → vision ──

async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

async function analyzeInstagram(url: string) {
  // 1. Get post data from ScrapCreators
  const igData = await fetchInstagramData(url);
  const media = igData?.data?.xdt_shortcode_media || igData?.data || igData;

  const caption =
    media?.edge_media_to_caption?.edges?.[0]?.node?.text || "";
  const author = media?.owner?.username || "";
  const isVideo = media?.is_video || false;
  const videoUrl = media?.video_url || null;
  const videoDuration = media?.video_duration || 0;

  // Collect all images (carousel or single)
  const imageUrls: string[] = [];

  // Carousel/multi-image post
  const sidecarChildren = media?.edge_sidecar_to_children?.edges;
  if (sidecarChildren && sidecarChildren.length > 0) {
    for (const edge of sidecarChildren) {
      const node = edge.node;
      if (node?.is_video && node?.video_url) {
        // Carousel item is a video — we'll handle it like the main video
        // For now grab the display image as a frame
        if (node.display_url) imageUrls.push(node.display_url);
      } else if (node?.display_url) {
        imageUrls.push(node.display_url);
      }
    }
  } else if (!isVideo && media?.display_url) {
    // Single image post
    imageUrls.push(media.display_url);
  }

  // 2. Process video if it's a reel
  let frames: { base64: string; index: number }[] = [];
  let duration = videoDuration;
  let transcript = "";
  const workDir = join(tmpdir(), `travel-ai-ig-${Date.now()}`);

  if (isVideo && videoUrl) {
    try {
      await mkdir(workDir, { recursive: true });
      const videoPath = join(workDir, "video.mp4");
      await downloadVideo(videoUrl, videoPath);
      const result = await extractFrames(videoPath, workDir);
      frames = result.frames;
      duration = result.duration;

      // Try Whisper transcription
      if (process.env.OPENAI_API_KEY) {
        try {
          const whisperResult = await extractAudioAndTranscribe(videoPath, workDir);
          if (whisperResult) transcript = whisperResult;
        } catch (err) {
          console.error("IG Whisper transcription failed:", err);
        }
      }
    } catch (err) {
      console.error("IG video processing failed:", err);
    } finally {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    // Also try ScrapCreators transcript endpoint
    if (!transcript) {
      const transcriptData = await fetchInstagramTranscript(url);
      if (transcriptData?.transcript) transcript = transcriptData.transcript;
    }
  }

  // 3. Download carousel/single images
  const imageBase64s: string[] = [];
  for (const imgUrl of imageUrls) {
    const b64 = await fetchImageAsBase64(imgUrl);
    if (b64) imageBase64s.push(b64);
  }

  // 4. Build vision request
  const contentParts: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [];

  // Add video frames
  for (const frame of frames) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
    });
  }

  // Add carousel/single images
  for (const b64 of imageBase64s) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    });
  }

  const totalImages = frames.length + imageBase64s.length;
  const postType = sidecarChildren?.length
    ? `carousel (${sidecarChildren.length} slides)`
    : isVideo
      ? "reel/video"
      : "single image";

  let contextText = `Analyzing an Instagram ${postType} from @${author}.\n`;
  if (caption) contextText += `\nCaption: "${caption}"`;
  if (transcript) contextText += `\nTranscript/Voiceover: "${transcript}"`;
  if (isVideo) contextText += `\nVideo duration: ${duration.toFixed(1)}s`;
  contextText += `\nImages/frames for analysis: ${totalImages}`;

  const prompt = totalImages > 0
    ? `${SCREENSHOT_PARSE_PROMPT}\n\nContext about this Instagram post:\n${contextText}\n\nAnalyze ALL ${totalImages} images/frames above for travel-relevant information. Look for signage, location names, food, landmarks, and any text overlays.\n\nYou MUST respond with ONLY a valid JSON object, no other text.`
    : `${URL_CONTENT_PARSE_PROMPT}\n\nContext about this Instagram post:\n${contextText}\n\nYou MUST respond with ONLY a valid JSON object, no other text.`;

  contentParts.push({ type: "text", text: prompt });

  const messages: ChatMessage[] = [{ role: "user", content: contentParts }];

  const model = totalImages > 0 ? VISION_MODEL : TEXT_MODEL;
  const response = await callOpenRouter(model, messages);
  const text = response.choices?.[0]?.message?.content || "";
  const parsed = extractJSON(text);
  const { validated, enriched_places } = await resolveAndEnrich(parsed);

  return {
    mode: "instagram",
    model,
    url,
    instagram: {
      caption,
      author,
      postType,
      transcript: transcript || null,
      duration: isVideo ? duration : null,
      framesExtracted: frames.length,
      imagesFound: imageBase64s.length,
      isVideo,
      stats: {
        likes: media?.edge_media_preview_like?.count,
        comments: media?.edge_media_to_parent_comment?.count,
        views: media?.video_play_count || null,
      },
    },
    analysis: validated,
    enriched_places,
    raw_response: text,
    tokens_used: response.usage,
    cost: estimateCost(model, response.usage),
  };
}

// ── Main handler ──

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY not set in .env.local" },
      { status: 500 }
    );
  }

  try {
    // Handle image upload
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("image") as File | null;

      if (!file) {
        return Response.json({ error: "No image provided" }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const dataUrl = `data:${file.type};base64,${base64}`;

      const messages: ChatMessage[] = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: SCREENSHOT_PARSE_PROMPT },
          ],
        },
      ];

      const response = await callOpenRouter(VISION_MODEL, messages);
      const text = response.choices?.[0]?.message?.content || "";
      const parsed = extractJSON(text);
      const { validated, enriched_places } = await resolveAndEnrich(parsed);

      return Response.json({
        mode: "image",
        model: VISION_MODEL,
        analysis: validated,
        enriched_places,
        raw_response: text,
        tokens_used: response.usage,
        cost: estimateCost(VISION_MODEL, response.usage),
      });
    }

    // Handle URL submission
    if (contentType.includes("application/json")) {
      const { url } = await request.json();
      if (!url) {
        return Response.json({ error: "No URL provided" }, { status: 400 });
      }

      // TikTok URLs get the full pipeline
      if (isTikTokURL(url)) {
        if (!process.env.SCRAPECREATORS_API_KEY) {
          return Response.json(
            { error: "SCRAPECREATORS_API_KEY not set in .env.local" },
            { status: 500 }
          );
        }
        const result = await analyzeTikTok(url);
        return Response.json(result);
      }

      // Instagram URLs
      if (isInstagramURL(url)) {
        if (!process.env.SCRAPECREATORS_API_KEY) {
          return Response.json(
            { error: "SCRAPECREATORS_API_KEY not set in .env.local" },
            { status: 500 }
          );
        }
        const result = await analyzeInstagram(url);
        return Response.json(result);
      }

      // Non-TikTok/IG: fallback to Cheerio scraping
      const pageData = await scrapeURL(url);
      const contentParts: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [];
      let model = TEXT_MODEL;

      if (pageData.ogImage) {
        try {
          const imgResponse = await fetch(pageData.ogImage);
          if (imgResponse.ok) {
            const imgBuffer = await imgResponse.arrayBuffer();
            const imgBase64 = Buffer.from(imgBuffer).toString("base64");
            const imgType =
              imgResponse.headers.get("content-type") || "image/jpeg";
            contentParts.push({
              type: "image_url",
              image_url: { url: `data:${imgType};base64,${imgBase64}` },
            });
            model = VISION_MODEL;
          }
        } catch {
          // Skip
        }
      }

      const prompt = pageData.ogImage
        ? `${SCREENSHOT_PARSE_PROMPT}\n\nAdditionally, here is the scraped text from the page:\n\n${pageData.text}`
        : `${URL_CONTENT_PARSE_PROMPT}\n\nScraped content from ${url}:\n\n${pageData.text}`;

      contentParts.push({ type: "text", text: prompt });

      const messages: ChatMessage[] = [
        { role: "user", content: contentParts },
      ];

      const response = await callOpenRouter(model, messages);
      const text = response.choices?.[0]?.message?.content || "";
      const parsed = extractJSON(text);
      const { validated, enriched_places } = await resolveAndEnrich(parsed);

      return Response.json({
        mode: "url",
        model,
        url,
        scraped: {
          title: pageData.title,
          description: pageData.description,
          ogImage: pageData.ogImage,
          textLength: pageData.text.length,
        },
        analysis: validated,
        enriched_places,
        raw_response: text,
        tokens_used: response.usage,
        cost: estimateCost(model, response.usage),
      });
    }

    return Response.json({ error: "Invalid content type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function scrapeURL(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = await response.text();
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, aside").remove();

  const title = $("title").text().trim();
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  const ogImage =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    "";
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);

  return { title, description, ogImage, text };
}

function extractJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate LLM output with Zod, then resolve + enrich places via Google Maps.
 * Returns the enriched analysis and the enriched places array separately.
 */
async function resolveAndEnrich(rawParsed: unknown) {
  if (!rawParsed || typeof rawParsed !== "object") {
    return { validated: null, enriched_places: [] };
  }

  const parseResult = ExtractionResultSchema.safeParse(rawParsed);
  if (!parseResult.success) {
    console.error("[resolve-enrich] Zod validation failed:", parseResult.error.issues);
    // Still try to use raw parsed — LLM output may have extra fields
    const places = (rawParsed as Record<string, unknown>).places;
    if (!Array.isArray(places) || places.length === 0) {
      return { validated: rawParsed, enriched_places: [] };
    }
  }

  const validated = parseResult.success ? parseResult.data : rawParsed;
  const places = parseResult.success
    ? parseResult.data.places
    : ((rawParsed as Record<string, unknown>).places as Array<Record<string, unknown>> ?? []);

  if (places.length === 0) {
    return { validated, enriched_places: [] };
  }

  const locationContext = parseResult.success
    ? parseResult.data.location_context
    : (rawParsed as Record<string, unknown>).location_context as string | undefined;

  // Resolve against Google Maps
  const resolved = await resolvePlaces(
    places.map((p) => ({
      name: String((p as Record<string, unknown>).name ?? ""),
      location_hint: (p as Record<string, unknown>).location_hint as string | undefined,
      category: (p as Record<string, unknown>).category as ExtractedPlace["category"],
      confidence: ((p as Record<string, unknown>).confidence as "high" | "medium" | "low") ?? "low",
      details: (p as Record<string, unknown>).details as string | undefined,
      source_clue: (p as Record<string, unknown>).source_clue as string | undefined,
    })),
    locationContext
  );

  // Enrich with Place Details
  const enriched = await enrichPlaces(resolved);

  return { validated, enriched_places: enriched };
}
