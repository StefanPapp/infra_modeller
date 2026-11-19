import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

const DEFAULT_MODELS = {
  // Pinned: the "gemini-flash-latest" alias was persistently overloaded (503s,
  // 30 s stalls) on the free tier, while this model answered in under a second.
  google: "gemini-2.5-flash",
  anthropic: "claude-sonnet-5-5",
} as const;

export type AiProvider = keyof typeof DEFAULT_MODELS;

type Env = Record<string, string | undefined>;

/**
 * Picks the LLM provider and model from the environment. AI_PROVIDER wins;
 * otherwise Gemini is used when GOOGLE_GENERATIVE_AI_API_KEY is set, and
 * Claude if not. GEMINI_MODEL / ANTHROPIC_MODEL override the model id.
 */
export function resolveModel(env: Env): { provider: AiProvider; modelId: string } {
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== "google" && explicit !== "anthropic") {
    throw new Error(
      `Unsupported AI_PROVIDER "${env.AI_PROVIDER}" (use "google" or "anthropic")`
    );
  }
  const provider: AiProvider =
    (explicit as AiProvider | undefined) ??
    (env.GOOGLE_GENERATIVE_AI_API_KEY ? "google" : "anthropic");

  const override =
    provider === "google" ? env.GEMINI_MODEL : env.ANTHROPIC_MODEL;
  return { provider, modelId: override || DEFAULT_MODELS[provider] };
}

/** The model used for chat and repository extraction. */
export function getModel(): LanguageModel {
  const { provider, modelId } = resolveModel(process.env);
  return provider === "google" ? google(modelId) : anthropic(modelId);
}
