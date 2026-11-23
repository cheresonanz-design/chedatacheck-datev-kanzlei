(function () {
  "use strict";
  const engine = window.CheDatevKanzlei;
  if (!engine) return;
  let activeTxs = engine.SAMPLES.mandant_fehlbelege.transactions;
  let lastRes = null;
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function applySample(s) {
    el("mandantName").value = s.mandant_name;
    el("chartSelect").value = s.chart;
    el("periodInput").value = s.period;
    el("toneSelect").value = s.reminder_tone;
    activeTxs = s.transactions;
    runCheck();
  }

  function runCheck() {
    const res = engine.evaluateMandantenMonat({
      mandant_name: el("mandantName").value,
      chart: el("chartSelect").value,
      period: el("periodInput").value,
      reminder_tone: el("toneSelect").value,
      transactions: activeTxs,
    });
    lastRes = res;
    el("resultCard").classList.remove("hidden");
    el("readyKpi").textContent = `${res.readiness_percent} %`;
    el("missingKpi").textContent = `${res.summary.missing_count} (${res.open_gross_eur.toFixed(2)} EUR)`;
    el("chartKpi").textContent = res.chart;
    el("totalKpi").textContent = `${res.total_gross_eur.toFixed(2)} EUR`;
    el("resultHeadline").textContent = res.ok ? `${res.mandant_name}: Monatsstapel DATEV-Ready` : `${res.mandant_name}: ${res.summary.missing_count} Fehlbeleg(e) offen`;
    el("reminderBox").value = res.reminder_text;

    el("entriesBody").innerHTML = res.entries.map((e) => {
      const cls = e.status === "PASS" ? "badge-pass" : e.status === "WARN" ? "badge-warn" : "badge-fail";
      return `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.date)}</td><td><strong>${esc(e.vendor)}</strong><div class="muted">${esc(e.category_label)}</div></td><td>${e.amount_eur.toFixed(2)} EUR</td><td><code>${esc(e.account)}</code> (BU ${esc(e.bu_key)})</td><td><span class="badge ${cls}">${esc(e.status)}</span></td><td>${esc(e.note)}</td></tr>`;
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!el("runCheckBtn")) return;
    el("runCheckBtn").addEventListener("click", runCheck);
    el("chartSelect").addEventListener("change", runCheck);
    el("toneSelect").addEventListener("change", runCheck);
    el("sampleFehlBtn").addEventListener("click", () => applySample(engine.SAMPLES.mandant_fehlbelege));
    el("sampleSkr04Btn").addEventListener("click", () => applySample(engine.SAMPLES.mandant_vollstaendig_skr04));
    el("sampleRevBtn").addEventListener("click", () => applySample(engine.SAMPLES.reverse_charge_bewirtung));

    el("copyRemBtn").addEventListener("click", async () => {
      if (!lastRes || !navigator.clipboard) return;
      await navigator.clipboard.writeText(lastRes.reminder_text);
      el("copyRemBtn").textContent = "Reminder kopiert!";
      setTimeout(() => (el("copyRemBtn").textContent = "Mandanten-Reminder kopieren"), 1800);
    });
    el("dlCsvBtn").addEventListener("click", () => {
      if (!lastRes) return;
      const blob = new Blob([lastRes.datev_csv], { type: "text/csv;charset=utf-8" });
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `DATEV_Buchungsstapel_${lastRes.period}.csv`;
      a.click();
      URL.revokeObjectURL(u);
    });
    el("dlJsonBtn").addEventListener("click", () => {
      if (!lastRes) return;
      const blob = new Blob([engine.formatAuditReportJson(lastRes)], { type: "application/json" });
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `kanzlei_audit_${lastRes.period}.json`;
      a.click();
      URL.revokeObjectURL(u);
    });
    applySample(engine.SAMPLES.mandant_fehlbelege);
  });
})();
