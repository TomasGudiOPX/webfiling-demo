import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import type { DemoProfileId } from "../types";

const COOKIE_NAME = "webfiling_demo_profile";
const profileIds = new Set<DemoProfileId>([
  "employee",
  "manager",
  "administration-staff",
  "system-administrator",
]);

export class ProfileContextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function signature(profileId: string): string {
  return createHmac("sha256", getConfig().sessionSecret)
    .update(profileId)
    .digest("base64url");
}

function readCookie(request: Request): string | null {
  const value = request.headers.get("Cookie");
  if (!value) return null;
  return (
    value
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? null
  );
}

export function resolveDemoProfile(request: Request): DemoProfileId {
  if (!getConfig().demoMode)
    throw new ProfileContextError("Demo profile switching is unavailable.", 404);
  const value = readCookie(request);
  if (!value) return "employee";
  const [profileId, providedSignature, ...extra] = value.split(".");
  const expectedSignature = signature(profileId);
  if (
    extra.length ||
    !profileIds.has(profileId as DemoProfileId) ||
    !providedSignature ||
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature),
    )
  )
    throw new ProfileContextError("The demo profile context is invalid.");
  return profileId as DemoProfileId;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  const expectedOrigin = getConfig().publicOrigin ?? new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin)
    throw new ProfileContextError("Profile changes require a same-origin request.", 403);
}

export async function switchDemoProfile(
  request: Request,
): Promise<{ profileId: DemoProfileId; setCookie: string }> {
  if (!getConfig().demoMode)
    throw new ProfileContextError("Demo profile switching is unavailable.", 404);
  if (request.method !== "POST")
    throw new ProfileContextError("Profile switching requires POST.", 405);
  assertSameOrigin(request);
  const form = await request.formData();
  const profileId = String(form.get("profileId") ?? "");
  if (!profileIds.has(profileId as DemoProfileId))
    throw new ProfileContextError("The selected demo profile is invalid.");
  const publicUrl = getConfig().publicOrigin ?? request.url;
  const secure = new URL(publicUrl).protocol === "https:" ? "; Secure" : "";
  return {
    profileId: profileId as DemoProfileId,
    setCookie: `${COOKIE_NAME}=${profileId}.${signature(profileId)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  };
}
