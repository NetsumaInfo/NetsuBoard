// AI agents (MCP): answers the tool calls core/mcp.js relays through the core. The switch lives in
// Settings › AI agents and is remembered on this device; the core only relays while it is on.

import { useEffect, useRef } from "react";
import { nr } from "@/lib/bridge";
import { runAgentTool, type AgentContext } from "./agentTools";

const KEY = "nb-agents-enabled";

export function agentsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export async function setAgentsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch { /* the core flag still applies for this session */ }
  return nr.agentSetEnabled(on);
}

// The context is read through a ref: persistence and project actions are new objects every render,
// and resubscribing to the SSE channel on each render could drop a call in flight.
export function useAgentBridge(ctx: AgentContext) {
  const current = useRef(ctx);
  current.current = ctx;
  useEffect(() => {
    void nr.agentSetEnabled(agentsEnabled()).catch(() => undefined);
    return nr.onAgentCall((call) => {
      void runAgentTool(call.tool, call.args, current.current)
        .then((answer) => nr.agentReply(call.id, answer))
        .catch(() => undefined);
    });
  }, []);
}
