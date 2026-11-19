import { describe, it, expect } from "vitest";
import { authorize, isCrossSiteWrite } from "@/lib/auth";

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

const configured = { username: "admin", password: "s3cret:with:colons" };

describe("authorize", () => {
  it("allows matching credentials", () => {
    expect(
      authorize(basic("admin", "s3cret:with:colons"), configured, true)
    ).toBe("ok");
  });

  it.each([
    ["missing header", null],
    ["wrong password", basic("admin", "nope")],
    ["wrong user", basic("root", "s3cret:with:colons")],
    ["prefix of the password", basic("admin", "s3cret")],
    ["bearer scheme", "Bearer abc"],
    ["garbage base64", "Basic !!!"],
    ["no colon", `Basic ${Buffer.from("admin").toString("base64")}`],
    ["empty", ""],
  ])("challenges on %s", (_name, header) => {
    expect(authorize(header, configured, true)).toBe("challenge");
  });

  it("accepts the scheme case-insensitively", () => {
    const header = basic("admin", "s3cret:with:colons").replace("Basic", "basic");
    expect(authorize(header, configured, true)).toBe("ok");
  });

  it("fails closed in production when no password is configured", () => {
    const none = { username: "admin", password: undefined };
    expect(authorize(null, none, true)).toBe("unconfigured");
    expect(authorize(basic("admin", ""), none, true)).toBe("unconfigured");
    expect(authorize(null, { username: "admin", password: "" }, true)).toBe(
      "unconfigured"
    );
  });

  it("is open in development when no password is configured", () => {
    expect(
      authorize(null, { username: "admin", password: undefined }, false)
    ).toBe("ok");
  });

  it("still enforces a configured password in development", () => {
    expect(authorize(null, configured, false)).toBe("challenge");
  });
});

describe("isCrossSiteWrite", () => {
  const req = (
    method: string,
    headers: { origin?: string; secFetchSite?: string; host?: string } = {}
  ) =>
    isCrossSiteWrite({
      method,
      host: headers.host ?? "infra.example.com",
      origin: headers.origin ?? null,
      secFetchSite: headers.secFetchSite ?? null,
    });

  it("never blocks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        req(method, { origin: "https://evil.example", secFetchSite: "cross-site" })
      ).toBe(false);
    }
  });

  it("allows same-origin writes", () => {
    expect(req("POST", { secFetchSite: "same-origin" })).toBe(false);
    expect(req("POST", { origin: "https://infra.example.com" })).toBe(false);
    expect(
      req("DELETE", { origin: "http://localhost:3000", host: "localhost:3000" })
    ).toBe(false);
  });

  it("blocks cross-site and same-site-but-different-origin writes", () => {
    expect(req("POST", { secFetchSite: "cross-site" })).toBe(true);
    expect(req("POST", { secFetchSite: "same-site" })).toBe(true);
    expect(req("POST", { origin: "https://evil.example" })).toBe(true);
    expect(req("DELETE", { origin: "https://infra.example.com.evil.example" })).toBe(true);
    expect(req("POST", { origin: "null" })).toBe(true);
    expect(
      req("POST", { origin: "http://localhost:4000", host: "localhost:3000" })
    ).toBe(true);
  });

  it("trusts Sec-Fetch-Site over a matching Origin", () => {
    expect(
      req("POST", { secFetchSite: "cross-site", origin: "https://infra.example.com" })
    ).toBe(true);
  });

  it("allows non-browser clients that send neither header", () => {
    expect(req("POST")).toBe(false);
  });
});
