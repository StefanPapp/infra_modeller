"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";

interface ChatPopoverProps {
  /** Called whenever the assistant successfully changed the model. */
  onModelChanged: () => void;
}

const MUTATION_TOOLS = new Set([
  "tool-add_component",
  "tool-delete_component",
  "tool-update_component",
  "tool-rename_component",
  "tool-connect_components",
  "tool-disconnect_components",
  "tool-add_owner",
  "tool-remove_owner",
  "tool-import_repository",
  "tool-undo",
]);

const PENDING_LABELS: Record<string, string> = {
  "tool-import_repository": "Reading repository…",
  "tool-web_search": "Searching the web…",
};

interface ToolOutcome {
  success: boolean;
  message: string;
}

/** Extracts the `{ success, message }` result of a finished tool call, if any. */
function toolOutcome(part: { type: string }): ToolOutcome | null {
  const { state, output } = part as { state?: string; output?: unknown };
  if (state !== "output-available" || typeof output !== "object" || !output) {
    return null;
  }
  const { success, message } = output as Record<string, unknown>;
  if (typeof success !== "boolean" || typeof message !== "string") return null;
  return { success, message };
}

function isPending(part: { type: string }): boolean {
  const { state } = part as { state?: string };
  return state === "input-streaming" || state === "input-available";
}

export function ChatPopover({ onModelChanged }: ChatPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeCountRef = useRef(0);

  const { messages, sendMessage, status, error } = useChat();
  const isBusy = status === "submitted" || status === "streaming";

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-focus input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Detect successful mutations and trigger a map refresh
  useEffect(() => {
    let count = 0;
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (MUTATION_TOOLS.has(part.type) && toolOutcome(part)?.success) {
          count++;
        }
      }
    }
    if (count > changeCountRef.current) {
      changeCountRef.current = count;
      onModelChanged();
    }
  }, [messages, onModelChanged]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <>
      {/* Floating chat button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-[#252838] border border-[#3b82f6] text-[#3b82f6] flex items-center justify-center hover:bg-[#3b82f6] hover:text-white transition-colors shadow-lg"
        title="Open Infra Assistant"
        aria-label="Open Infra Assistant"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Chat popover */}
      {isOpen && (
        <div className="fixed bottom-20 right-5 z-50 w-[400px] h-[500px] bg-[#161822] border border-[#252838] rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#252838] shrink-0">
            <h3 className="text-sm font-semibold text-white">
              Infra Assistant
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              className="text-[#666] hover:text-white text-lg leading-none"
            >
              x
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-[#555] text-center mt-8">
                Describe services and how they connect, ask what depends on
                what, or paste a GitHub URL and I&apos;ll read the repository
                into the map.
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#3b82f6]/20 text-[#ccc]"
                      : "bg-[#1e2235] text-[#ccc]"
                  }`}
                >
                  {msg.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <span key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </span>
                      );
                    }
                    if (!part.type.startsWith("tool-")) return null;
                    if (isPending(part)) {
                      const label = PENDING_LABELS[part.type];
                      return label ? (
                        <div key={i} className="mt-2 text-xs text-[#888]">
                          {label}
                        </div>
                      ) : null;
                    }
                    // Render any mutation tool result as a status card
                    if (MUTATION_TOOLS.has(part.type)) {
                      const result = toolOutcome(part);
                      if (!result) return null;
                      return (
                        <div
                          key={i}
                          className={`mt-2 px-3 py-2 rounded-lg text-xs ${
                            result.success
                              ? "bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30"
                              : "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
                          }`}
                        >
                          {result.success ? "\u2713" : "\u2717"} {result.message}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {status === "submitted" && (
              <p className="text-xs text-[#666]">Thinking…</p>
            )}
            {error && (
              <div className="px-3 py-2 rounded-lg text-xs bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30">
                The assistant failed to respond. Check ANTHROPIC_API_KEY and
                try again.
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-[#252838] shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Describe a component, connection or repo…"
                aria-label="Message"
                className="flex-1 bg-[#1e2235] border border-[#252838] rounded-lg px-3 py-2 text-sm text-[#ccc] placeholder-[#555] focus:outline-none focus:border-[#3b82f6]"
              />
              <button
                onClick={handleSend}
                disabled={isBusy || !input.trim()}
                className="px-3 py-2 bg-[#3b82f6] text-white rounded-lg text-sm hover:bg-[#2563eb] transition-colors shrink-0 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
