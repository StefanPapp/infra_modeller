"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "What is Infra Modeller?",
    a: "An interactive map of your IT infrastructure: services, frontends, databases, queues, caches, gateways, external SaaS and platforms are nodes, and the dependencies between them are directed, labelled connections.",
  },
  {
    q: "How do I read the graph?",
    a: "Colour shows the component type (see the legend). An arrow points from the component that calls or depends on something to the thing it depends on. A thick border marks high criticality; a dashed border marks deprecated components. Hover or click a node to highlight its neighbours and show connection labels.",
  },
  {
    q: "How do I navigate?",
    a: "Scroll to zoom, drag the background to pan, drag a node to move it. Click a node to open its details; click the background to close them.",
  },
  {
    q: "How do I add components and connections?",
    a: "Open the chat (blue button, bottom-right) and describe them, e.g. \"Add a Go service called Billing API that reads/writes Orders DB over SQL and calls Stripe.\" You can also open a component and use \"+ Add connection\" in the detail panel, or remove a connection with the x next to it.",
  },
  {
    q: "How does reading a repository work?",
    a: "Click \"Import repository\" (or paste a GitHub URL into the chat). The app fetches infrastructure-relevant files via the GitHub API - docker-compose, Terraform, Kubernetes manifests, Dockerfiles, package manifests, CI config - and Claude extracts components and connections from them. Components that already exist by name are reused, so several repositories merge into one map.",
  },
  {
    q: "Which files are read from a repository?",
    a: "At most 25 files, chosen by name. Files that typically hold credentials (.env, *.tfvars, Terraform state, keys, anything named secret/credential) are never downloaded. Private repositories need a GITHUB_TOKEN on the server.",
  },
  {
    q: "What can I ask the assistant?",
    a: "Questions about the model (\"What breaks if Orders DB goes down?\", \"Which components does the Platform team own?\"), changes (add, update, rename, delete, connect, disconnect, owners), repository imports, and web lookups about technologies.",
  },
  {
    q: "How does undo work?",
    a: "After any change, type \"undo\" in the chat to reverse it. Only the most recent change can be undone - a repository import counts as one change.",
  },
  {
    q: "Where is the data stored?",
    a: "In the Postgres database configured via DATABASE_URL. An empty database is seeded with a fictional e-commerce platform as demo data.",
  },
];

export function FaqModal() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="absolute top-5 right-5 z-20 w-8 h-8 rounded-full bg-[#252838]/80 border border-[#252838] text-[#666] hover:text-white hover:border-[#3b82f6] flex items-center justify-center transition-colors"
        title="Help / FAQ"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Frequently asked questions"
            className="w-[520px] max-h-[80vh] bg-[#161822] border border-[#252838] rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#252838] shrink-0">
              <h2 className="text-base font-semibold text-white">
                Frequently Asked Questions
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#666] hover:text-white text-xl leading-none"
              >
                x
              </button>
            </div>

            {/* FAQ list */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {FAQ_ITEMS.map((item, i) => (
                <div key={i}>
                  <h3 className="text-sm font-medium text-[#e0e0e0] mb-1">
                    {item.q}
                  </h3>
                  <p className="text-sm text-[#888] leading-relaxed">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
