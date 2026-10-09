import assert from "node:assert/strict";
import test from "node:test";
import {
  ProfileContextError,
  resolveDemoProfile,
  switchDemoProfile,
} from "../app/.server/profile-session.server";

const originalDemoMode = process.env.DEMO_MODE;
const originalSessionSecret = process.env.SESSION_SECRET;

function request(
  cookie?: string,
  body?: URLSearchParams,
): Request {
  return new Request("http://example.test/api/demo-profile", {
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? {
            Origin: "http://example.test",
            "Content-Type": "application/x-www-form-urlencoded",
          }
        : {}),
    },
    body,
  });
}

test("demo profile defaults to employee and ignores submitted actor fields", async () => {
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "profile-test-secret";
  assert.equal(resolveDemoProfile(request()), "employee");
  const switched = await switchDemoProfile(
    request(undefined, new URLSearchParams({ profileId: "manager" })),
  );
  assert.equal(
    resolveDemoProfile(
      request(
        `${switched.setCookie.split(";")[0]}`,
        new URLSearchParams({ actorId: "system-administrator" }),
      ),
    ),
    "manager",
  );
});

test("forged or unknown demo profile context is rejected", () => {
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "profile-test-secret";
  assert.throws(
    () => resolveDemoProfile(request("webfiling_demo_profile=system-administrator.forged")),
    ProfileContextError,
  );
  assert.throws(
    () => resolveDemoProfile(request("webfiling_demo_profile=unknown.invalid")),
    ProfileContextError,
  );
});

test("profile switching is disabled outside demo mode", async () => {
  process.env.DEMO_MODE = "false";
  process.env.SESSION_SECRET = "profile-test-secret";
  await assert.rejects(
    () =>
      switchDemoProfile(
        request(undefined, new URLSearchParams({ profileId: "employee" })),
      ),
    (error: unknown) =>
      error instanceof ProfileContextError && error.status === 404,
  );
  process.env.DEMO_MODE = originalDemoMode;
  process.env.SESSION_SECRET = originalSessionSecret;
});
