import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { POST as feasibilityIntake } from "@/app/api/feasibility-intake/route";

const priorUser = process.env.BASIC_AUTH_USER;
const priorPassword = process.env.BASIC_AUTH_PASSWORD;

afterEach(() => {
  if (priorUser === undefined) delete process.env.BASIC_AUTH_USER;
  else process.env.BASIC_AUTH_USER = priorUser;
  if (priorPassword === undefined) delete process.env.BASIC_AUTH_PASSWORD;
  else process.env.BASIC_AUTH_PASSWORD = priorPassword;
});

describe("HTTP boundary hardening", () => {
  it("returns 401 rather than throwing for malformed Basic Auth base64", () => {
    process.env.BASIC_AUTH_USER = "angelo";
    process.env.BASIC_AUTH_PASSWORD = "secret";
    const request = new NextRequest("http://localhost/sponsor", {
      headers: { authorization: "Basic !!!not-base64!!!" },
    });

    const response = middleware(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects an oversized feasibility payload before parsing it", async () => {
    const request = new Request("http://localhost/api/feasibility-intake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(25 * 1024 * 1024 + 1),
      },
      body: JSON.stringify({ text: "small body" }),
    });

    const response = await feasibilityIntake(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "payload exceeds 25MB limit" });
  });
});
