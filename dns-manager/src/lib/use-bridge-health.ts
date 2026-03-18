"use client";

import { useEffect, useRef } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { toast } from "sonner";

const HEALTH_INTERVAL = 30000;

export function useBridgeHealth() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const setBridgeConnected = useStore((s) => s.setBridgeConnected);
  const setExecutionMode = useStore((s) => s.setExecutionMode);
  const wasConnected = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function check() {
      const result = await api.health();
      const connected = result.success && (result as Record<string, unknown>).status === "ok";
      setBridgeConnected(connected);

      if (wasConnected.current && !connected) {
        toast.warning("Bridge connection lost. Falling back to command generation.");
        setExecutionMode("generate");
      } else if (!wasConnected.current && connected) {
        toast.success("Bridge connected.");
      }
      wasConnected.current = connected;
    }

    check();
    timer = setInterval(check, HEALTH_INTERVAL);
    return () => clearInterval(timer);
  }, [setBridgeConnected, setExecutionMode]);

  return bridgeConnected;
}
