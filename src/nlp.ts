import Groq from "npm:groq-sdk";
import type { ITransaction, IUser, ISms, IMail } from "./types.ts";
import { stripHtml, buildPhishingTimeline } from "./features.ts";

//#region Groq Client
let _client: Groq | null = null;

function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") });
  }
  return _client;
}
//#endregion

//#region Communication Extractor
function extractRecentComms(
  txTimestamp: string,
  firstName: string,
  sms: ISms[],
  mails: IMail[],
  windowDays = 14,
): string[] {
  const txTime = new Date(txTimestamp).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const name = firstName.toLowerCase();
  const results: string[] = [];

  for (const s of sms) {
    if (!s.sms.toLowerCase().includes(name)) continue;
    if (s.sms.includes("I can't help create")) continue;
    const dateMatch = s.sms.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const dt = new Date(dateMatch[1]).getTime();
    if (Math.abs(txTime - dt) > windowMs) continue;
    const msgMatch = s.sms.match(/Message:\s*([\s\S]+)/);
    if (msgMatch) results.push(`[SMS ${dateMatch[1]}] ${msgMatch[1].trim().slice(0, 250)}`);
  }

  for (const m of mails) {
    const toMatch = m.mail.match(/To:.*?"([^"]+)"/i);
    if (!toMatch || !toMatch[1].toLowerCase().includes(name)) continue;
    const dateMatch = m.mail.match(/Date:\s*(.+)/i);
    if (!dateMatch) continue;
    const dt = new Date(dateMatch[1].trim()).getTime();
    if (isNaN(dt) || Math.abs(txTime - dt) > windowMs) continue;
    const from = m.mail.match(/From:\s*(.+)/i)?.[1]?.trim() ?? "?";
    const subj = m.mail.match(/Subject:\s*(.+)/i)?.[1]?.trim() ?? "?";
    const plain = stripHtml(m.mail).slice(0, 300);
    results.push(`[EMAIL ${dateMatch[1].trim().slice(0, 10)} from ${from.slice(0, 60)}]\nSubject: ${subj}\n${plain}`);
  }

  return results;
}
//#endregion

//#region Single Transaction Analysis
export async function analyzeWithGroq(
  tx: ITransaction,
  user: IUser,
  sms: ISms[],
  mails: IMail[],
): Promise<number> {
  const comms = extractRecentComms(tx.timestamp, user.first_name, sms, mails);

  const commContext = comms.length > 0
    ? comms.slice(0, 6).join("\n---\n")
    : "No recent communications found.";

  const prompt = `You are a bank fraud analyst. Assess this transaction.

TRANSACTION:
- Amount: ${tx.amount}€  |  Type: ${tx.transaction_type}
- Recipient: ${tx.recipient_id || "N/A"}  |  Description: "${tx.description || "none"}"
- Location: "${tx.location || "N/A"}"  |  Time: ${tx.timestamp}
- Payment: ${tx.payment_method || "N/A"}  |  Balance after: ${tx.balance_after}€

CITIZEN:
- Monthly income: ${Math.round(user.salary / 12)}€  |  Job: ${user.job}  |  City: ${user.residence.city}

RECENT COMMUNICATIONS (±14 days):
${commContext}

Is this transaction fraudulent? Watch for: phishing emails/SMS before the transfer, urgent/prize/verify language, suspicious domains (paypa1, claims-, northfinancc), large amounts after scam contact.

Respond ONLY with JSON: {"fraud_probability": 0.0, "reason": "brief"}`;

  try {
    const response = await getClient().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 120,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const prob = Number(parsed.fraud_probability ?? 0);
    return isNaN(prob) ? 0 : Math.max(0, Math.min(1, prob));
  } catch {
    return 0;
  }
}
//#endregion

//#region Batch Analysis (parallel with rate limit)
export interface IBatchInput {
  transactionId: string;
  tx: ITransaction;
  user: IUser;
}

export async function analyzeBatch(
  items: IBatchInput[],
  sms: ISms[],
  mails: IMail[],
  batchSize = 8,
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => analyzeWithGroq(item.tx, item.user, sms, mails)
        .then(score => ({ id: item.transactionId, score }))
      )
    );
    for (const { id, score } of batchResults) {
      results.set(id, score);
    }
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}
//#endregion
