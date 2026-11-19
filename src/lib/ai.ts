import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

const DEFAULT_MODEL = "claude-sonnet-5-5";

/** The Claude model used for chat and repository extraction. Override with ANTHROPIC_MODEL. */
export function getModel(): LanguageModel {
  return anthropic(process.env.ANTHROPIC_MODEL || DEFAULT_MODEL);
}
