"use client";

/**
 * US-1 upload panel — send a sponsor feasibility form (.docx / .txt) to the intake endpoint,
 * which parses it into a FeasibilityRequest that lands in the inbox below.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IntakePanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    if (!input.files?.length) {
      setMsg("Selecione um arquivo .docx ou .txt.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.append("file", input.files[0]);
      const res = await fetch("/api/feasibility-intake", { method: "POST", body });
      const json = (await res.json()) as { requestId?: string; fieldCount?: number; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg(`Recebido — ${json.fieldCount} campos. Abra na caixa de entrada para preencher.`);
      form.reset();
      router.refresh();
    } catch (err) {
      setMsg(`Falha no upload: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: "var(--cl-space-3)", alignItems: "center", flexWrap: "wrap" }}>
      <input type="file" name="file" accept=".docx,.pdf,.txt,.md" className="cl-input" style={{ maxWidth: 320 }} />
      <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit" disabled={busy}>
        {busy ? "Enviando…" : "Enviar formulário"}
      </button>
      {msg && <span className="muted" style={{ fontSize: "var(--cl-text-sm)" }}>{msg}</span>}
    </form>
  );
}
