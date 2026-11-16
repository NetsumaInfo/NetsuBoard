// Settings › AI agents: the switch that lets an MCP client (Claude Code, Codex…) drive the board,
// and the exact commands that register NetsuBoard's MCP server with each of them.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { nr, type AgentStatus } from "@/lib/bridge";
import { Checkbox } from "@/components/ui/checkbox";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentsEnabled, setAgentsEnabled } from "@/components/reference/useAgentBridge";

const quote = (p: string) => `"${p}"`;

function CommandRow({ label, command }: { label: string; command: string }) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard refused: the command stays selectable */ }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-xs">{command}</code>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={copy}
                aria-label={t("agents.copy")}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              />
            }
          >
            <NetsuIcon name={copied ? "check" : "copy-clipboard"} className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{copied ? t("agents.copied") : t("agents.copy")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function AgentsPanel() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [on, setOn] = useState(agentsEnabled);

  useEffect(() => {
    void nr.agentStatus().then(setStatus).catch(() => undefined);
    return nr.onAgentStatus(setStatus);
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setOn(next);
    setStatus(await setAgentsEnabled(next));
  }, []);

  const node = status?.node ? quote(status.node) : "node";
  const script = status?.script ? quote(status.script) : "";
  const json = JSON.stringify({ mcpServers: { netsuboard: { command: status?.node || "node", args: [status?.script || ""] } } }, null, 2);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-medium">{t("agents.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("agents.subtitle")}</p>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4">
        <span className="flex flex-col gap-1">
          <span className="text-[0.8125rem]">{t("agents.enable")}</span>
          <span className="text-xs text-muted-foreground">
            {on
              ? (status?.lastCall ? t("agents.lastCall", { time: new Date(status.lastCall).toLocaleTimeString() }) : t("agents.waiting"))
              : t("agents.off")}
          </span>
        </span>
        <Checkbox checked={on} onCheckedChange={(v) => void toggle(!!v)} />
      </label>

      {script && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">{t("agents.howto")}</p>
          <CommandRow label="Claude Code" command={`claude mcp add netsuboard -- ${node} ${script}`} />
          <CommandRow label="Codex" command={`codex mcp add netsuboard -- ${node} ${script}`} />
          <CommandRow label={t("agents.otherClients")} command={json} />
        </div>
      )}
    </section>
  );
}
