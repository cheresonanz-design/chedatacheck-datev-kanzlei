/* CheDataCheck Kanzlei & DATEV Browser Controller — B14 (User Rows + CSV Import, 100% Local) */
(function () {
  "use strict";

  const Engine = window.CheDatevKanzlei;
  const $ = (id) => document.getElementById(id);
  let activeTransactions = JSON.parse(JSON.stringify(Engine.SAMPLES.mandant_fehlbelege.transactions));
  let lastResult = null;

  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderTxEditor() {
    const tbody = $("txInputBody");
    if (!tbody) return;
    tbody.innerHTML = activeTransactions
      .map(
        (tx, idx) => `
      <tr data-idx="${idx}">
        <td><input type="text" data-field="id" value="${escHtml(tx.id || "TX-" + (idx + 1))}" style="width:74px" aria-label="TX ID" /></td>
        <td><input type="text" data-field="date" value="${escHtml(tx.date || "2026-11-01")}" style="width:98px" aria-label="Datum" /></td>
        <td><input type="text" data-field="vendor" value="${escHtml(tx.vendor || "")}" style="min-width:140px" aria-label="Lieferant" /></td>
        <td><select data-field="category" aria-label="Kategorie">
          ${Object.entries(Engine.ACCOUNT_MAP)
            .map(([k, v]) => `<option value="${k}" ${tx.category === k ? "selected" : ""}>${escHtml(v.label)}</option>`)
            .join("")}
        </select></td>
        <td><select data-field="tax_mode" aria-label="Steuermodus">
          <option value="vst_19" ${tx.tax_mode === "vst_19" ? "selected" : ""}>19% VSt (BU 9)</option>
          <option value="vst_7" ${tx.tax_mode === "vst_7" ? "selected" : ""}>7% VSt (BU 8)</option>
          <option value="eu_reverse_charge" ${tx.tax_mode === "eu_reverse_charge" ? "selected" : ""}>§13b EU (BU 94)</option>
          <option value="none" ${tx.tax_mode === "none" ? "selected" : ""}>0% / Steuerfrei</option>
        </select></td>
        <td><input type="number" step="0.01" min="0" data-field="amount_eur" value="${Number(tx.amount_eur || 0).toFixed(2)}" style="width:92px" aria-label="Betrag EUR" /></td>
        <td style="text-align:center"><input type="checkbox" data-field="has_receipt" ${tx.has_receipt ? "checked" : ""} aria-label="Beleg vorhanden" /></td>
        <td style="text-align:center"><input type="checkbox" data-field="ust_id_or_address_ok" ${tx.ust_id_or_address_ok !== false ? "checked" : ""} aria-label="§14 UStG OK" /></td>
        <td style="text-align:center"><input type="checkbox" data-field="bewirtung_anlass_ok" ${tx.bewirtung_anlass_ok !== false ? "checked" : ""} aria-label="Bewirtungsanlass OK" /></td>
        <td><button type="button" class="btn" data-remove="${idx}" aria-label="Zeile entfernen">×</button></td>
      </tr>`
      )
      .join("");
  }

  function syncFromEditor() {
    const tbody = $("txInputBody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-idx]");
    activeTransactions = Array.from(rows).map((tr, i) => {
      const getVal = (f) => tr.querySelector(`[data-field="${f}"]`);
      return {
        id: (getVal("id")?.value || `TX-${i + 1}`).trim(),
        date: (getVal("date")?.value || "2026-11-01").trim(),
        vendor: (getVal("vendor")?.value || "Unbekannter Kreditor").trim(),
        category: getVal("category")?.value || "saas_it",
        tax_mode: getVal("tax_mode")?.value || "vst_19",
        amount_eur: Number(getVal("amount_eur")?.value || 0),
        has_receipt: Boolean(getVal("has_receipt")?.checked),
        ust_id_or_address_ok: Boolean(getVal("ust_id_or_address_ok")?.checked),
        bewirtung_anlass_ok: Boolean(getVal("bewirtung_anlass_ok")?.checked),
      };
    });
  }

  function loadSample(sampleObj) {
    $("mandantName").value = sampleObj.mandant_name;
    $("chartSelect").value = sampleObj.chart;
    $("periodInput").value = sampleObj.period;
    $("toneSelect").value = sampleObj.reminder_tone;
    activeTransactions = JSON.parse(JSON.stringify(sampleObj.transactions));
    renderTxEditor();
    run();
  }

  function parseCsvLine(line, sep) {
    return line.split(sep).map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
  }

  function importCsvText(text) {
    const rawLines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (rawLines.length === 0) return;
    const sep = rawLines[0].includes(";") ? ";" : ",";
    const firstCols = parseCsvLine(rawLines[0], sep).map((c) => c.toLowerCase());
    const hasHeader = firstCols.some((c) => /datum|date|lieferant|vendor|betrag|amount|beguenstigter|kreditor/.test(c));
    const startIdx = hasHeader ? 1 : 0;

    const findCol = (patterns, fallbackIdx) => {
      if (!hasHeader) return fallbackIdx;
      const idx = firstCols.findIndex((c) => patterns.some((p) => c.includes(p)));
      return idx >= 0 ? idx : fallbackIdx;
    };

    const dateCol = findCol(["datum", "date", "buchungstag"], 0);
    const vendorCol = findCol(["lieferant", "vendor", "empf", "name", "kreditor"], 1);
    const catCol = findCol(["kategorie", "category", "konto"], 2);
    const taxCol = findCol(["steuer", "tax", "ust"], 3);
    const amtCol = findCol(["betrag", "amount", "umsatz", "brutto"], hasHeader ? firstCols.length - 1 : 4);
    const recCol = findCol(["beleg", "receipt", "quittung"], 5);

    const imported = [];
    for (let i = startIdx; i < rawLines.length; i++) {
      const cols = parseCsvLine(rawLines[i], sep);
      if (cols.length < 2) continue;
      const rawAmt = String(cols[amtCol] || cols[cols.length - 1] || "0")
        .replace(/[^\d.,-]/g, "")
        .replace(/\.(?=\d{3}(?:[,.]|$))/g, "")
        .replace(",", ".");
      const amount = Math.abs(Number(rawAmt) || 0);
      if (!amount && !cols[vendorCol]) continue;
      const rawCat = String(cols[catCol] || "saas_it").toLowerCase();
      const cat = Engine.ACCOUNT_MAP[rawCat] ? rawCat : "saas_it";
      const rawTax = String(cols[taxCol] || "vst_19").toLowerCase();
      const taxMode = ["vst_19", "vst_7", "eu_reverse_charge", "none"].includes(rawTax) ? rawTax : "vst_19";
      const rawRec = String(cols[recCol] || "").toLowerCase();
      const hasRec = rawRec ? !["0", "false", "nein", "no", "offen", "fehlt"].includes(rawRec) : true;
      imported.push({
        id: `CSV-${imported.length + 1}`,
        date: /^\d{4}-\d{2}-\d{2}$/.test(cols[dateCol] || "") ? cols[dateCol] : $("periodInput").value.trim() + "-01",
        vendor: cols[vendorCol] || `Kreditor ${imported.length + 1}`,
        category: cat,
        tax_mode: taxMode,
        amount_eur: amount,
        has_receipt: hasRec,
        ust_id_or_address_ok: true,
        bewirtung_anlass_ok: true,
      });
    }
    if (imported.length > 0) {
      activeTransactions = imported;
      renderTxEditor();
      run();
    }
  }

  function run() {
    syncFromEditor();
    const res = Engine.evaluateMandantenMonat({
      mandant_name: $("mandantName").value,
      chart: $("chartSelect").value,
      period: $("periodInput").value,
      reminder_tone: $("toneSelect").value,
      transactions: activeTransactions,
    });
    lastResult = res;

    $("resultCard").classList.remove("hidden");
    $("resultHeadline").textContent = `${res.mandant_name} · ${res.period} (${res.chart})`;
    $("readyKpi").textContent = `${res.readiness_percent} %`;
    $("missingKpi").textContent = `${res.summary.missing_count} (${res.open_gross_eur.toFixed(2)} EUR)`;
    $("chartKpi").textContent = res.chart;
    $("totalKpi").textContent = `${res.total_gross_eur.toFixed(2)} EUR`;

    const tbody = $("entriesBody");
    tbody.innerHTML = res.entries
      .map((e) => {
        const cls = e.status === "PASS" ? "badge-pass" : e.status === "WARN" ? "badge-warn" : "badge-fail";
        return `<tr><td><code>${escHtml(e.id)}</code></td><td>${escHtml(e.date)}</td><td>${escHtml(e.vendor)}</td><td>${e.amount_eur.toFixed(2)} EUR</td><td><code>${escHtml(e.account)}</code> · BU ${escHtml(e.bu_key)}</td><td><span class="badge ${cls}">${escHtml(e.status)}</span></td><td>${escHtml(e.note)}</td></tr>`;
      })
      .join("");

    $("reminderBox").value = res.reminder_text;
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("sampleFehlBtn").addEventListener("click", () => loadSample(Engine.SAMPLES.mandant_fehlbelege));
    $("sampleSkr04Btn").addEventListener("click", () => loadSample(Engine.SAMPLES.mandant_vollstaendig_skr04));
    $("sampleRevBtn").addEventListener("click", () => loadSample(Engine.SAMPLES.reverse_charge_bewirtung));
    $("runCheckBtn").addEventListener("click", run);

    $("addTxBtn")?.addEventListener("click", () => {
      syncFromEditor();
      activeTransactions.push({
        id: `TX-${activeTransactions.length + 1}`,
        date: `${$("periodInput").value.trim() || "2026-11"}-15`,
        vendor: "Neuer Kreditor GmbH",
        category: "saas_it",
        tax_mode: "vst_19",
        amount_eur: 199.0,
        has_receipt: false,
        ust_id_or_address_ok: true,
        bewirtung_anlass_ok: true,
      });
      renderTxEditor();
      run();
    });

    $("txInputBody")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-remove]");
      if (!btn) return;
      syncFromEditor();
      const idx = Number(btn.getAttribute("data-remove"));
      activeTransactions.splice(idx, 1);
      renderTxEditor();
      run();
    });

    $("csvUpload")?.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importCsvText(reader.result);
      reader.readAsText(file, "utf-8");
    });

    $("importCsvBtn")?.addEventListener("click", () => {
      importCsvText($("csvPasteArea")?.value || "");
    });

    $("dlCsvBtn").addEventListener("click", () => {
      if (!lastResult) return;
      download(`datev_buchungsstapel_${lastResult.period}.csv`, lastResult.datev_csv, "text/csv;charset=utf-8");
    });
    $("dlJsonBtn").addEventListener("click", () => {
      if (!lastResult) return;
      download(`kanzlei_audit_${lastResult.period}.json`, Engine.formatAuditReportJson(lastResult), "application/json");
    });
    $("copyRemBtn").addEventListener("click", async () => {
      const text = $("reminderBox").value;
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
    });

    loadSample(Engine.SAMPLES.mandant_fehlbelege);
  });
})();
