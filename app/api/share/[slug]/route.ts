import { getRedis, shareKey } from "@/lib/redis";

/** GET — fetch a shared trip by slug */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const redis = getRedis();

    if (!redis) {
      return Response.json(
        { error: "Sharing unavailable — Redis not configured" },
        { status: 503 }
      );
    }

    const data = await redis.get(shareKey(slug));
    if (!data) {
      return Response.json(
        { error: "Trip not found or expired" },
        { status: 404 }
      );
    }

    return Response.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
