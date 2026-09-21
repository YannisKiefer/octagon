"use client";

// In-app update banner (desktop shell only). The main process checks GitHub
// releases once after launch and exposes a one-click download + install that
// swaps the app bundle and relaunches.
import { useCallback, useEffect, useState } from "react";

type DesktopBridge = {
  checkForUpdate: () => Promise<{ available: boolean; version?: string }>;
  installUpdate: () => Promise<{ ok: boolean; relaunching?: boolean; note?: string; error?: string }>;
  onUpdateAvailable: (callback: (info: { version?: string }) => void) => () => void;
  onUpdateProgress: (callback: (payload: { phase: string; pct?: number }) => void) => () => void;
};

export function UpdateBanner() {
  const bridge = (globalThis as { octagonDesktop?: DesktopBridge }).octagonDesktop;
  const [version, setVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "installing" | "relaunching" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!bridge?.onUpdateAvailable) return;
    const off = bridge.onUpdateAvailable((info) => {
      if (info?.version) setVersion(info.version);
    });
    return off;
  }, [bridge]);

  const update = useCallback(async () => {
    if (!bridge?.installUpdate) return;
    setError(null);
    setPhase("downloading");
    bridge.onUpdateProgress((payload) => {
      if (payload.phase === "download") { setPct(payload.pct ?? 0); setPhase("downloading"); }
      if (payload.phase === "install") { setPhase("installing"); }
      if (payload.phase === "relaunch") { setPhase("relaunching"); }
    });
    const result = await bridge.installUpdate();
    if (!result.ok) {
      setError(result.error || "The update could not be installed.");
      setPhase("error");
      return;
    }
    if (!result.relaunching) {
      setError(result.note || "Drag Octagon to Applications to finish the update.");
      setPhase("error");
    }
  }, [bridge]);

  if (!bridge?.installUpdate || !version || dismissed) return null;

  return (
    <div role="status" className="flex items-center gap-3 px-4 py-2 bg-[#151A21] border-b border-hairline text-[13px]">
      <span className="text-ink">
        {phase === "downloading" && `Downloading Octagon ${version} - ${pct}%`}
        {phase === "installing" && "Installing update..."}
        {phase === "relaunching" && "Restarting Octagon..."}
        {phase === "idle" && `Octagon ${version} is available.`}
        {phase === "error" && (error || "The update failed.")}
      </span>
      {phase === "idle" && (
        <button
          onClick={update}
          className="ml-auto rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-[#0B0E12] hover:bg-[#6DAEFF] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Update now
        </button>
      )}
      {phase === "downloading" && (
        <span className="ml-auto w-40 h-1.5 rounded-full bg-[#1C222B] overflow-hidden" aria-hidden="true">
          <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
        </span>
      )}
      {(phase === "error" || phase === "relaunching") && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-ink-mute hover:text-ink text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
