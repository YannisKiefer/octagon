"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";

/* Agents are first-class fleet members: a supervisor plans, monitor agents
   watch, phone agents drive one device each, custom is everything else.
   Everything here talks to /api/agents and renders only what the API
   actually returns - no invented agents, no invented state. */

export type AgentRole = "supervisor" | "phone" | "monitor" | "custom";

export type Agent = {
  id: string;
  name: string;
  role: AgentRole;
  device_id: string | null;
  color: string;
  status: string;
  active: number | boolean | null | undefined;
};

export type RailDevice = {
  id: string;
  voice_prefix: string;
  display_name?: string;
};

const ROLES: AgentRole[] = ["supervisor", "phone", "monitor", "custom"];

const ROLE_LABEL: Record<AgentRole, string> = {
  supervisor: "Supervisor",
  phone: "Phone agent",
  monitor: "Monitor",
  custom: "Custom",
};

// "active" comes back from SQLite as 0/1 or as a boolean depending on the
// route; an absent field is read as active rather than hiding the agent.
export function isActiveAgent(v: Agent["active"]): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return v;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[(ROLES as string[]).includes(role) ? (role as AgentRole) : "custom"];
}

export function deviceLabel(d: RailDevice | undefined, fallbackId: string | null): string {
  if (d) return d.display_name?.trim() || d.voice_prefix || d.id;
  return fallbackId || "";
}

/* Minimal modal shell matching the page modals (raised card, hairline border,
   Escape and click-away to close). */
function ModalShell({
  title,
  onClose,
  children,
  maxWidth = 360,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full bg-surface border border-hairline rounded-composer shadow-2xl overflow-hidden"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 flex items-center justify-between px-4 border-b border-hairline">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-6 h-6 rounded-full bg-raised grid place-items-center text-ink-mute hover:text-ink text-[11px] leading-none transition-colors"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------- Add agent modal ---------------------------- */

export function AddAgentModal({
  devices,
  onClose,
  onCreated,
}: {
  devices: RailDevice[];
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("phone");
  const [deviceId, setDeviceId] = useState("");
  const [clientError, setClientError] = useState("");
  const [serverError, setServerError] = useState("");
  const [posting, setPosting] = useState(false);

  async function create() {
    if (posting) return; // Enter in the input bypasses the disabled button.
    const n = name.trim();
    if (n.length < 2 || n.length > 24) {
      setClientError("Name must be 2 to 24 characters.");
      return;
    }
    if (role === "phone" && !deviceId) {
      setClientError("Choose the device this agent drives.");
      return;
    }
    setClientError("");
    setServerError("");
    setPosting(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          role === "phone" ? { name: n, role, device_id: deviceId } : { name: n, role },
        ),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success && j?.agent?.id) {
        onCreated(j.agent as Agent);
      } else {
        setServerError(
          String(j?.error || `Could not add the agent (HTTP ${res.status}).`),
        );
      }
    } catch {
      setServerError("Could not add the agent. The farm API is unreachable.");
    }
    setPosting(false);
  }

  return (
    <ModalShell title="Add agent" onClose={onClose}>
      <div className="p-4 space-y-3">
        <label htmlFor="agent-name" className="block text-[12px] text-ink-dim">
          Name
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder="e.g. Nova"
          autoFocus
          className="w-full bg-raised border border-hairline rounded-control px-3 py-[8px] text-[13.5px] text-ink placeholder:text-ink-mute focus:outline-none focus:border-accent transition-colors"
        />

        <label htmlFor="agent-role" className="block text-[12px] text-ink-dim">
          Role
        </label>
        <select
          id="agent-role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as AgentRole);
            setClientError("");
          }}
          className="w-full bg-raised border border-hairline rounded-control px-3 py-[8px] text-[13.5px] text-ink focus:outline-none focus:border-accent transition-colors"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>

        {role === "phone" && (
          <>
            <label htmlFor="agent-device" className="block text-[12px] text-ink-dim">
              Device
            </label>
            <select
              id="agent-device"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setClientError("");
              }}
              className="w-full bg-raised border border-hairline rounded-control px-3 py-[8px] text-[13.5px] text-ink focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">Choose a device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceLabel(d, d.id)}
                </option>
              ))}
            </select>
            {devices.length === 0 && (
              <p className="text-[11.5px] text-ink-mute leading-relaxed">
                No devices yet. Add a device first to link a phone agent.
              </p>
            )}
          </>
        )}

        {clientError && (
          <p className="text-[12px] text-danger" role="alert">
            {clientError}
          </p>
        )}
        {serverError && (
          <p className="text-[12px] text-danger" role="alert">
            {serverError}
          </p>
        )}

        <button
          type="button"
          onClick={create}
          disabled={posting || name.trim().length < 2}
          className="w-full bg-white hover:bg-[#E8ECF2] disabled:opacity-40 text-[#0B0E12] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
        >
          {posting ? "Adding" : "Add agent"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Agents section ---------------------------- */

type MenuState = {
  menuFor: string | null;
  assignFor: string | null;
  retireFor: string | null;
  renameFor: string | null;
};

export function AgentRail({
  agents,
  loaded,
  error,
  devices,
  selectedAgentId,
  onSelect,
  onAdd,
  onChanged,
}: {
  agents: Agent[];
  loaded: boolean;
  error: boolean;
  devices: RailDevice[];
  selectedAgentId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [menu, setMenu] = useState<MenuState>({
    menuFor: null,
    assignFor: null,
    retireFor: null,
    renameFor: null,
  });
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const anyMenuOpen =
    Boolean(menu.menuFor) || Boolean(menu.assignFor) || Boolean(menu.retireFor) || Boolean(menu.renameFor);

  useEffect(() => {
    if (!anyMenuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu({ menuFor: null, assignFor: null, retireFor: null, renameFor: null });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyMenuOpen]);

  useEffect(() => {
    if (menu.renameFor) renameRef.current?.focus();
  }, [menu.renameFor]);

  function closeMenus() {
    setMenu({ menuFor: null, assignFor: null, retireFor: null, renameFor: null });
    setActionError("");
  }

  async function patchAgent(id: string, body: Record<string, unknown>) {
    if (busy) return; // Enter and blur can both fire commitRename.
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        closeMenus();
        onChanged();
      } else {
        setActionError(String(j?.error || `Could not update the agent (HTTP ${res.status}).`));
      }
    } catch {
      setActionError("Could not update the agent. The farm API is unreachable.");
    }
    setBusy(false);
  }

  function startRename(agent: Agent) {
    setRenameValue(agent.name);
    setMenu({ menuFor: null, assignFor: null, retireFor: null, renameFor: agent.id });
  }

  function commitRename(agent: Agent) {
    const n = renameValue.trim();
    if (!n || n === agent.name) {
      closeMenus();
      return;
    }
    if (n.length < 2 || n.length > 24) {
      setActionError("Name must be 2 to 24 characters.");
      return;
    }
    patchAgent(agent.id, { name: n });
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between px-3 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">
          Agents
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-control px-1.5 py-1 text-[11.5px] text-ink-mute transition-colors hover:bg-hover hover:text-ink"
        >
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          Add agent
        </button>
      </div>

      {error && (
        <p className="px-3 py-1.5 text-[12px] text-ink-dim" role="alert">
          Could not load agents.
        </p>
      )}
      {loaded && !error && agents.length === 0 && (
        <p className="px-3 py-1.5 text-[12px] text-ink-mute leading-relaxed">
          No agents yet. Add one to divide the work.
        </p>
      )}

      <div className="space-y-[2px]">
        {agents.map((agent) => {
          const isSel = agent.id === selectedAgentId;
          const device = agent.device_id
            ? devices.find((d) => d.id === agent.device_id)
            : undefined;
          const renaming = menu.renameFor === agent.id;
          return (
            <div
              key={agent.id}
              className={`group relative flex items-center rounded-control transition-colors ${
                isSel ? "bg-selected" : "hover:bg-hover"
              }`}
            >
              {isSel && (
                <span
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent"
                  aria-hidden="true"
                />
              )}
              {renaming ? (
                <div className="flex-1 px-2 py-[6px]">
                  <input
                    ref={renameRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(agent);
                      if (e.key === "Escape") closeMenus();
                    }}
                    onBlur={() => commitRename(agent)}
                    aria-label={`Rename ${agent.name}`}
                    className="w-full bg-raised border border-hairline rounded-control px-2 py-[5px] text-[13px] text-ink focus:outline-none focus:border-accent"
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(agent.id)}
                    aria-pressed={isSel}
                    className="flex-1 min-w-0 flex items-start gap-[9px] px-2.5 py-[8px] text-left"
                    title={`Address ${agent.name} in the conversation`}
                  >
                    <span
                      className="mt-[4px] h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: agent.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-[6px]">
                        <span className="text-[13px] font-semibold leading-tight truncate text-ink">
                          {agent.name}
                        </span>
                        {agent.status && (
                          <span className="ml-auto text-[10.5px] text-ink-mute truncate shrink-0 max-w-[70px]">
                            {agent.status}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-[6px] mt-[3px]">
                        <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-mute">
                          {roleLabel(agent.role)}
                        </span>
                        {agent.role === "phone" && agent.device_id && (
                          <span className="text-[11px] text-ink-dim truncate">
                            {deviceLabel(device, agent.device_id)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Options for ${agent.name}`}
                    aria-expanded={menu.menuFor === agent.id}
                    onClick={() =>
                      setMenu({
                        menuFor: menu.menuFor === agent.id ? null : agent.id,
                        assignFor: null,
                        retireFor: null,
                        renameFor: null,
                      })
                    }
                    className="mr-1.5 shrink-0 rounded-control p-1.5 text-ink-mute opacity-60 transition-colors hover:bg-raised hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <MoreHorizontal size={14} strokeWidth={1.75} />
                  </button>
                </>
              )}

              {menu.menuFor === agent.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={closeMenus} aria-hidden="true" />
                  <div className="absolute right-1 top-full z-40 mt-0.5 min-w-[150px] bg-surface border border-hairline rounded-control shadow-2xl py-1">
                    <button
                      type="button"
                      onClick={() => startRename(agent)}
                      className="block w-full text-left px-3 py-2 text-[12.5px] text-ink hover:bg-hover transition-colors"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMenu({ menuFor: null, assignFor: agent.id, retireFor: null, renameFor: null })
                      }
                      className="block w-full text-left px-3 py-2 text-[12.5px] text-ink hover:bg-hover transition-colors"
                    >
                      Assign device
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMenu({ menuFor: null, assignFor: null, retireFor: agent.id, renameFor: null })
                      }
                      className="block w-full text-left px-3 py-2 text-[12.5px] text-danger hover:bg-hover transition-colors"
                    >
                      Retire
                    </button>
                  </div>
                </>
              )}

              {menu.assignFor === agent.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={closeMenus} aria-hidden="true" />
                  <div
                    role="listbox"
                    aria-label={`Assign ${agent.name} to a device`}
                    className="absolute right-1 top-full z-40 mt-0.5 min-w-[170px] max-h-[220px] overflow-y-auto bg-surface border border-hairline rounded-control shadow-2xl py-1"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patchAgent(agent.id, { device_id: null })}
                      className="block w-full text-left px-3 py-2 text-[12.5px] text-ink-dim hover:bg-hover transition-colors disabled:opacity-40"
                    >
                      No device
                    </button>
                    {devices.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={busy}
                        onClick={() => patchAgent(agent.id, { device_id: d.id })}
                        className={`block w-full text-left px-3 py-2 text-[12.5px] hover:bg-hover transition-colors disabled:opacity-40 ${
                          d.id === agent.device_id ? "text-ink font-medium" : "text-ink-dim"
                        }`}
                      >
                        {deviceLabel(d, d.id)}
                      </button>
                    ))}
                    {devices.length === 0 && (
                      <p className="px-3 py-2 text-[12px] text-ink-mute">No devices yet.</p>
                    )}
                  </div>
                </>
              )}

              {menu.retireFor === agent.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={closeMenus} aria-hidden="true" />
                  <div className="absolute right-1 top-full z-40 mt-0.5 w-[210px] bg-surface border border-hairline rounded-control shadow-2xl p-3">
                    <p className="text-[12.5px] leading-relaxed text-ink-dim">
                      Retire {agent.name}? It stops appearing in the console.
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={closeMenus}
                        className="flex-1 border border-hairline rounded-control py-[6px] text-[12px] font-medium text-ink-dim hover:bg-hover transition-colors"
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patchAgent(agent.id, { active: false })}
                        className="flex-1 rounded-control py-[6px] text-[12px] font-semibold bg-danger text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {busy ? "Retiring" : "Retire"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {actionError && (
        <p className="px-3 pt-1.5 text-[11.5px] text-danger" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
