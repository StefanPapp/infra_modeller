import { describe, it, expect } from "vitest";
import { resolveModel } from "@/lib/ai";

describe("resolveModel", () => {
  it("uses Gemini when a Google API key is configured", () => {
    expect(resolveModel({ GOOGLE_GENERATIVE_AI_API_KEY: "g" })).toEqual({
      provider: "google",
      modelId: "gemini-2.5-flash",
    });
  });

  it("prefers Gemini when both keys are configured", () => {
    expect(
      resolveModel({ GOOGLE_GENERATIVE_AI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })
        .provider
    ).toBe("google");
  });

  it("falls back to Claude without a Google key", () => {
    expect(resolveModel({ ANTHROPIC_API_KEY: "a" })).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-5-5",
    });
    expect(resolveModel({}).provider).toBe("anthropic");
  });

  it("honours an explicit provider and model overrides", () => {
    expect(
      resolveModel({
        AI_PROVIDER: "anthropic",
        GOOGLE_GENERATIVE_AI_API_KEY: "g",
        ANTHROPIC_MODEL: "claude-opus-5-5",
      })
    ).toEqual({ provider: "anthropic", modelId: "claude-opus-5-5" });
    expect(
      resolveModel({ AI_PROVIDER: "google", GEMINI_MODEL: "gemini-3.5-flash" })
    ).toEqual({ provider: "google", modelId: "gemini-3.5-flash" });
  });

  it("rejects an unknown provider", () => {
    expect(() => resolveModel({ AI_PROVIDER: "openai" })).toThrow(
      'Unsupported AI_PROVIDER "openai" (use "google" or "anthropic")'
    );
  });
});
