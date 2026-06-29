import { useEffect, useRef } from "react";

export function useAgentApplyPrompt(onApply: (prompt: string) => void) {
  const onApplyRef = useRef(onApply);

  useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);

  useEffect(() => {
    const handleAgentApplyPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail;
      const prompt = typeof detail?.prompt === "string" ? detail.prompt : "";
      if (!prompt) return;
      onApplyRef.current(prompt);
    };

    window.addEventListener("agent-apply-prompt", handleAgentApplyPrompt);
    return () => window.removeEventListener("agent-apply-prompt", handleAgentApplyPrompt);
  }, []);
}
