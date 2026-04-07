import { cookies } from "next/headers";
import { nanoid } from "nanoid";

const SESSION_COOKIE = "travelai_sid";
const SESSION_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

/**
 * Get or create an anonymous session ID from cookies.
 * Must be called in a Route Handler or Server Action (not Server Components).
 */
export async function getSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE)?.value;
  if (existing) return existing;

  const sid = nanoid(21);
  cookieStore.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return sid;
}
