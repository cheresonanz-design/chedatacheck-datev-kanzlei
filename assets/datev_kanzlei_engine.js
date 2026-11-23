/**
 * CheDataCheck Kanzlei & DATEV Pre-Accounting Engine (by VeriTakt Collective) — B14
 * Matches bank transactions vs. submitted receipts, detects Fehlbelege, validates § 14 UStG / § 33 UStDV,
 * maps SKR03/SKR04 accounts & BU keys, generates DATEV CSV & Mandanten-Reminder (100 % local in browser).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CheDatevKanzlei = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ACCOUNT_MAP = {
    saas_it: { label: "Software / Cloud / IT", skr03: "4964", skr04: "6815" },
    bewirtung: { label: "Bewirtungskosten (70/30 Split)", skr03: "4650", skr04: "6640" },
    reisekosten: { label: "Reisekosten Unternehmer/MA", skr03: "4670", skr04: "6670" },
    wareneinkauf: { label: "Wareneinkauf / Material", skr03: "3400", skr04: "5400" },
    beratung: { label: "Rechts- & Beratungskosten", skr03: "4950", skr04: "6825" },
    telekommunikation: { label: "Telefon & Internet", skr03: "4920", skr04: "6805" },
    miete: { label: "Miete & Raumkosten", skr03: "4210", skr04: "6310" },
  };

  function resolveBuKey(taxMode) {
    switch (String(taxMode || "vst_19")) {
      case "vst_19":
        return "9";
      case "vst_7":
        return "8";
      case "eu_reverse_charge":
        return "94";
      default:
        return "0";
    }
  }

  function formatDatevDate(isoDate) {
    const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "0111";
    return `${m[3]}${m[2]}`;
  }

  function formatDatevAmount(val) {
    const n = Math.abs(Number(val) || 0);
    return n.toFixed(2).replace(".", ",");
  }

  function evaluateMandantenMonat(raw) {
    const d = raw || {};
    const mandantName = String(d.mandant_name || "Muster Mandant GmbH").trim();
    const chart = String(d.chart || "SKR03").toUpperCase() === "SKR04" ? "SKR04" : "SKR03";
    const period = String(d.period || "2026-11").trim();
    const tone = String(d.reminder_tone || "freundlich").toLowerCase() === "streng" ? "streng" : "freundlich";
    const txs = Array.isArray(d.transactions) ? d.transactions : [];

    const entries = [];
    const missingReceipts = [];
    const warnings = [];
    let totalGrossEur = 0;
    let openGrossEur = 0;

    for (const tx of txs) {
      const amount = Math.abs(Number(tx.amount_eur) || 0);
      totalGrossEur += amount;
      const catInfo = ACCOUNT_MAP[tx.category] || ACCOUNT_MAP.saas_it;
      const account = chart === "SKR04" ? catInfo.skr04 : catInfo.skr03;
      const bu = resolveBuKey(tx.tax_mode);
      const hasReceipt = Boolean(tx.has_receipt);
      const needsFullInvoice = amount > 250;

      let status = "PASS";
      let note = "Beleg vollständig & vorkontiert.";

      if (!hasReceipt) {
        status = "FAIL";
        note = `Fehlbeleg: Keine Rechnung/Quittung zu Bankumsatz '${tx.vendor}' (${amount.toFixed(2)} EUR).`;
        openGrossEur += amount;
        missingReceipts.push({
          tx_id: tx.id || "-",
          date: tx.date || "-",
          vendor: tx.vendor || "-",
          amount_eur: amount,
          requirement: needsFullInvoice ? "Vollrechnung (§ 14 UStG) erforderlich" : "Kleinbetragsrechnung (§ 33 UStDV) ausreichend",
        });
      } else if (tx.category === "bewirtung" && !tx.bewirtung_anlass_ok) {
        status = "WARN";
        note = "Bewirtungsbeleg ohne Anlass/Teilnehmer-Unterschrift (70/30-Abzug gefährdet).";
        warnings.push({ tx_id: tx.id || "-", vendor: tx.vendor, reason: note });
      } else if (needsFullInvoice && !tx.ust_id_or_address_ok) {
        status = "WARN";
        note = "Betrag > 250 EUR: Vollständige Empfängeranschrift & Steuer-/USt-ID (§ 14 UStG) nachprüfen.";
        warnings.push({ tx_id: tx.id || "-", vendor: tx.vendor, reason: note });
      }

      entries.push({
        id: tx.id || "-",
        date: tx.date || "-",
        vendor: tx.vendor || "-",
        amount_eur: Number(amount.toFixed(2)),
        category_label: catInfo.label,
        account,
        contra_account: "1200",
        bu_key: bu,
        has_receipt: hasReceipt,
        status,
        note,
      });
    }

    const csvHeader = "Umsatz;Soll/Haben;Konto;Gegenkonto;BU;Belegdatum;Belegfeld1;Buchungstext";
    const csvRows = entries.map((e) => {
      const txt = `${e.vendor} (${e.status === "FAIL" ? "FEHLBELEG" : "Vorerfasst"})`.replace(/;/g, ",");
      return `${formatDatevAmount(e.amount_eur)};S;${e.account};${e.contra_account};${e.bu_key};${formatDatevDate(e.date)};${e.id};${txt}`;
    });
    const datevCsv = [csvHeader, ...csvRows].join("\n");

    let reminderText = "";
    if (missingReceipts.length === 0 && warnings.length === 0) {
      reminderText = `Hallo ${mandantName}-Team,\n\nvielen Dank — für ${period} liegen alle Belege vollständig vor und sind für den DATEV-Export (${chart}) vorbereitet.`;
    } else {
      const listLines = missingReceipts.map(
        (m) => `- ${m.date} | ${m.vendor} | ${m.amount_eur.toFixed(2)} EUR (${m.requirement})`
      );
      const warnLines = warnings.map((w) => `- ${w.vendor}: ${w.reason}`);
      if (tone === "streng") {
        reminderText =
          `Betreff: Dringend — Fehlende Belege für ${period} (${mandantName}) vor USt-Voranmeldung\n\n` +
          `Sehr geehrte Damen und Herren,\n\nfür den Abschluss ${period} fehlen noch ${missingReceipts.length} Pflichtbeleg(e) über insgesamt ${openGrossEur.toFixed(2)} EUR (Vorsteuerabzug sonst nicht möglich):\n` +
          `${listLines.join("\n")}\n` +
          (warnLines.length ? `\nZusätzliche Klärung nötig:\n${warnLines.join("\n")}\n` : "") +
          `\nBitte laden Sie alle Belege bis spätestens übermorgen hoch, damit wir die DATEV-Verbuchung (${chart}) fristgerecht abschließen können.`;
      } else {
        reminderText =
          `Betreff: Kurze Rückfrage zu ${missingReceipts.length} Beleg(en) für ${period} (${mandantName})\n\n` +
          `Guten Tag,\n\nfür die monatliche Buchhaltung ${period} (${chart}) fehlen uns aktuell noch folgende Belege (Summe ${openGrossEur.toFixed(2)} EUR):\n` +
          `${listLines.join("\n")}\n` +
          (warnLines.length ? `\nKurzer Hinweis zur Prüfung:\n${warnLines.join("\n")}\n` : "") +
          `\nSobald Sie diese kurz nachreichen, schließen wir den Monatsstapel direkt ab. Vielen Dank!`;
      }
    }

    const summary = {
      total_tx: entries.length,
      ready_count: entries.filter((e) => e.status === "PASS").length,
      warn_count: entries.filter((e) => e.status === "WARN").length,
      missing_count: missingReceipts.length,
    };
    const readinessPercent = entries.length ? Math.round((summary.ready_count / entries.length) * 100) : 100;

    return {
      ok: missingReceipts.length === 0 && warnings.length === 0,
      mandant_name: mandantName,
      chart,
      period,
      readiness_percent: readinessPercent,
      total_gross_eur: Number(totalGrossEur.toFixed(2)),
      open_gross_eur: Number(openGrossEur.toFixed(2)),
      summary,
      entries,
      missing_receipts: missingReceipts,
      warnings,
      reminder_text: reminderText,
      datev_csv: datevCsv,
    };
  }

  function formatAuditReportJson(res) {
    return JSON.stringify(
      { tool: "CheDataCheck Kanzlei & DATEV Vorerfassung", provider: "CheDataCheck by VeriTakt Collective", checked_at: new Date().toISOString(), ...res },
      null,
      2
    );
  }

  function formatAuditReportMarkdown(res) {
    const lines = [
      `# CheDataCheck Kanzlei-Protokoll — ${res.mandant_name} (${res.period} · ${res.chart})`,
      ``,
      `- **Beleg-Readiness:** **${res.readiness_percent} %** (${res.summary.ready_count}/${res.summary.total_tx} vollständig · Fehlbelege: ${res.summary.missing_count} / ${res.open_gross_eur.toFixed(2)} EUR)`,
      ``,
      `| ID | Datum | Lieferant | Betrag (EUR) | Konto | BU | Status | Hinweis |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
    ];
    for (const e of res.entries) {
      lines.push(`| ${e.id} | ${e.date} | ${e.vendor} | ${e.amount_eur.toFixed(2)} | ${e.account} | ${e.bu_key} | **${e.status}** | ${String(e.note).replace(/\|/g, "/")} |`);
    }
    lines.push(``);
    lines.push(`## Mandanten-Reminder`);
    lines.push("```");
    lines.push(res.reminder_text);
    lines.push("```");
    lines.push(``);
    lines.push(`*100 % lokal im Browser ohne Mandanten-Daten-Upload via CheDataCheck (by VeriTakt Collective).*`);
    return lines.join("\n");
  }

  const SAMPLES = {
    mandant_fehlbelege: {
      mandant_name: "Alsterbau Handwerk GmbH",
      chart: "SKR03",
      period: "2026-11",
      reminder_tone: "freundlich",
      transactions: [
        { id: "TX-101", date: "2026-11-04", vendor: "Telekom Deutschland", category: "telekommunikation", tax_mode: "vst_19", amount_eur: 89.25, has_receipt: true, ust_id_or_address_ok: true, bewirtung_anlass_ok: true },
        { id: "TX-102", date: "2026-11-09", vendor: "Cloudflare / OpenAI EU", category: "saas_it", tax_mode: "eu_reverse_charge", amount_eur: 310.00, has_receipt: false, ust_id_or_address_ok: false, bewirtung_anlass_ok: true },
        { id: "TX-103", date: "2026-11-12", vendor: "Ratskeller Bremen", category: "bewirtung", tax_mode: "vst_19", amount_eur: 148.50, has_receipt: true, ust_id_or_address_ok: true, bewirtung_anlass_ok: false },
        { id: "TX-104", date: "2026-11-18", vendor: "Würth Baustoffe AG", category: "wareneinkauf", tax_mode: "vst_19", amount_eur: 1420.00, has_receipt: false, ust_id_or_address_ok: false, bewirtung_anlass_ok: true },
      ],
    },
    mandant_vollstaendig_skr04: {
      mandant_name: "Elbe Digital Agentur GmbH",
      chart: "SKR04",
      period: "2026-11",
      reminder_tone: "freundlich",
      transactions: [
        { id: "TX-201", date: "2026-11-03", vendor: "DATEV eG", category: "saas_it", tax_mode: "vst_19", amount_eur: 297.50, has_receipt: true, ust_id_or_address_ok: true, bewirtung_anlass_ok: true },
        { id: "TX-202", date: "2026-11-10", vendor: "Bürohaus Mitte GmbH", category: "miete", tax_mode: "vst_19", amount_eur: 1950.00, has_receipt: true, ust_id_or_address_ok: true, bewirtung_anlass_ok: true },
        { id: "TX-203", date: "2026-11-15", vendor: "Deutsche Bahn", category: "reisekosten", tax_mode: "vst_7", amount_eur: 112.40, has_receipt: true, ust_id_or_address_ok: true, bewirtung_anlass_ok: true },
      ],
    },
    reverse_charge_bewirtung: {
      mandant_name: "Nordic Commerce UG",
      chart: "SKR03",
      period: "2026-11",
      reminder_tone: "streng",
      transactions: [
        { id: "TX-301", date: "2026-11-06", vendor: "Kanzlei Nord PartG", category: "beratung", tax_mode: "vst_19", amount_eur: 890.00, has_receipt: true, ust_id_or_address_ok: false, bewirtung_anlass_ok: true },
        { id: "TX-302", date: "2026-11-19", vendor: "AWS EMEA SARL", category: "saas_it", tax_mode: "eu_reverse_charge", amount_eur: 460.00, has_receipt: false, ust_id_or_address_ok: false, bewirtung_anlass_ok: true },
      ],
    },
  };

  return { evaluateMandantenMonat, formatAuditReportJson, formatAuditReportMarkdown, ACCOUNT_MAP, SAMPLES };
});
