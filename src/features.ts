//#region Geo Math
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
//#endregion

//#region Statistics
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMAD(values: number[], median: number): number {
  if (values.length === 0) return 1;
  const deviations = values.map(v => Math.abs(v - median));
  return calculateMedian(deviations) || 1;
}

export function madScore(value: number, median: number, mad: number): number {
  return Math.abs(value - median) / mad;
}

export function sigmoid(x: number, center = 3.0, steepness = 0.8): number {
  return 1 / (1 + Math.exp(-steepness * (x - center)));
}
//#endregion

//#region HTML Stripper
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
//#endregion

//#region Phishing Detection — Email
const PHISHING_DOMAINS = [
  "paypa1", "amaz0n", "northfinancc", "firstnational-alerts", "claims-2087",
  "secure-bank", "verify-now", "account-verify", "security-alert",
];

const PHISHING_SUBJECTS = [
  "claim your prize", "congratulations, winner", "account security alert",
  "verify your bank", "security alert: verify", "urgent: overdue",
  "immediate action required", "subscription renewal notice — immediate",
  "annual employee records review", "subscription renewal: urgent",
  "your account has been", "suspicious activity detected",
  "verify now to avoid", "unusual sign-in",
];

export function emailPhishingScore(mail: string): number {
  const fromMatch = mail.match(/From:.*?<(.+?)>/i);
  const domain = fromMatch ? (fromMatch[1].split("@")[1] ?? "").toLowerCase() : "";
  const subjMatch = mail.match(/Subject:\s*(.+)/i);
  const subj = subjMatch ? subjMatch[1].toLowerCase() : "";

  let score = 0;

  if (PHISHING_DOMAINS.some(d => domain.includes(d))) score += 0.85;
  if (PHISHING_SUBJECTS.some(s => subj.includes(s))) score += 0.70;
  else if (["urgent", "verify", "action required", "security alert", "suspicious"].some(s => subj.includes(s))) score += 0.35;

  return Math.min(score, 1.0);
}
//#endregion

//#region Phishing Detection — SMS
const SMS_PHISHING_KEYWORDS = [
  // Account takeover
  "customs", "release fee", "customs fee", "pay now to avoid",
  "crypto", "frozen", "protect your profit",
  "verify now to avoid", "account locked", "suspicious sign-in",
  "suspicious login", "unusual sign-in", "unusual login",
  "account will be locked", "account will be suspended",
  "verify your identity now", "verify identity now",
  "restore access", "prevent suspension",
  // Government / pension scams
  "pension payment", "pension record", "pension is on hold", "benefits suspended",
  "social security", "retirement benefits", "hmrc", "benefit has been flagged",
  "identity mismatch", "verify now to avoid suspension",
  // Delivery scams
  "parcel is held", "package is held", "customs fee required",
  "dhl", "fee required to release", "immediate customs fee",
  // Subscription scams
  "subscription renewal failed", "update payment",
];

const SMS_PHISHING_DOMAINS = [
  "paypa1", "amaz0n", "northfinancc", "firstnational", "claims-",
  "netfl1x", "natw3st", "ch4se", "bankofamer1ca", "pensi0n",
  "socsec-verify", "ssa-secure", "ss-aid", "pension-verify",
  "dhl-secure-pay", "dhl-release", "dhl-customs",
  "hmrc-secure", "chase-secure-verify", "chase-verify-secure",
  "amaz0n-verify", "amaz0n-verify20", "bit.ly/amaz0n",
];

// Generic suspicious URL patterns (year in domain, -secure-, -verify- combos)
const SUSPICIOUS_URL_PATTERN = /https?:\/\/[^\s]*?(2087|paypa1|amaz0n|netfl1x|natw3st|pensi0n|ch4se|-secure-pay|-secure-verify|-verify\d|-release\d)[^\s]*/i;

export function smsPhishingScore(sms: string): number {
  // Skip LLM refusals and explicit phishing simulations
  if (sms.includes("I can't help create")) return 0;
  if (sms.includes("PHISHING SIM") || sms.includes("training alert")) return 0;

  const lower = sms.toLowerCase();
  let score = 0;

  if (sms.startsWith("URGENT") || lower.startsWith("urgent:") || lower.startsWith("alert:")) score += 0.50;
  if (SMS_PHISHING_KEYWORDS.some(kw => lower.includes(kw))) score += 0.60;
  if (SMS_PHISHING_DOMAINS.some(d => lower.includes(d))) score += 0.85;
  if (SUSPICIOUS_URL_PATTERN.test(sms)) score += 0.75;
  else if (lower.includes("verify") && lower.includes("http")) score += 0.35;

  return Math.min(score, 1.0);
}
//#endregion

//#region Phishing Timeline per Citizen
export interface IPhishingEvent {
  timestamp: Date;
  score: number;
  source: "sms" | "mail";
}

export function buildPhishingTimeline(
  firstName: string,
  sms: { sms: string }[],
  mails: { mail: string }[],
): IPhishingEvent[] {
  const timeline: IPhishingEvent[] = [];
  const name = firstName.toLowerCase();

  for (const s of sms) {
    if (!s.sms.toLowerCase().includes(name)) continue;
    const dateMatch = s.sms.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const score = smsPhishingScore(s.sms);
    if (score > 0.1) timeline.push({ timestamp: new Date(dateMatch[1]), score, source: "sms" });
  }

  for (const m of mails) {
    const toMatch = m.mail.match(/To:.*?"([^"]+)"/i);
    if (!toMatch || !toMatch[1].toLowerCase().includes(name)) continue;
    const dateMatch = m.mail.match(/Date:\s*(.+)/i);
    if (!dateMatch) continue;
    const dt = new Date(dateMatch[1].trim());
    if (isNaN(dt.getTime())) continue;
    const score = emailPhishingScore(m.mail);
    if (score > 0.1) timeline.push({ timestamp: dt, score, source: "mail" });
  }

  return timeline;
}

export function phishingContactScore(
  txTimestamp: string,
  timeline: IPhishingEvent[],
  windowDays = 14,
): number {
  const txTime = new Date(txTimestamp).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let maxScore = 0;
  for (const event of timeline) {
    const dt = txTime - event.timestamp.getTime();
    if (dt >= 0 && dt <= windowMs) {
      maxScore = Math.max(maxScore, event.score);
    }
  }
  return maxScore;
}
//#endregion

//#region Benign Description Filter
const BENIGN_PATTERNS = [
  "salary payment", "rent payment", "phone bill", "health insurance",
  "gym membership", "student gym", "savings deposit", "pension",
  "electricity bill", "gas bill", "water bill", "internet",
  "insurance premium", "mortgage", "subscription fee",
  "monthly fee", "annual fee", "tax payment", "loan payment",
];

export function benignDescriptionScore(description: string): number {
  if (!description) return 0;
  const lower = description.toLowerCase();
  if (BENIGN_PATTERNS.some(p => lower.includes(p))) return 0.85;
  // Month-keyed regular payments (Salary payment Jan, Rent payment Feb, etc.)
  if (/payment (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(lower)) return 0.75;
  return 0;
}
//#endregion

//#region Description Fraud Keywords
const FRAUD_KEYWORDS = [
  "urgent", "immediately", "verify", "suspend", "blocked",
  "confirm your", "reset your", "wire transfer", "gift card",
  "invoice", "overdue", "final notice", "unauthorized",
  "security alert", "account compromised",
];

export function descriptionFraudScore(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const hits = FRAUD_KEYWORDS.filter(kw => lower.includes(kw)).length;
  return Math.min(hits / 2, 1.0);
}
//#endregion

//#region Geo Anomaly
export function geoAnomalyScore(
  txTimestamp: string,
  txLocation: string,
  citizenLocations: { timestamp: string; lat: number; lng: number; city: string }[],
): number {
  if (citizenLocations.length === 0 || !txLocation) return 0;
  const txTime = new Date(txTimestamp).getTime();
  const twoHoursMs = 2 * 60 * 60 * 1000;

  let closest: { lat: number; lng: number; city: string; dt: number } | null = null;
  for (const loc of citizenLocations) {
    const dt = Math.abs(new Date(loc.timestamp).getTime() - txTime);
    if (!closest || dt < closest.dt) {
      closest = { lat: loc.lat, lng: loc.lng, city: loc.city, dt };
    }
  }
  if (!closest || closest.dt > twoHoursMs) return 0;

  const txCity = txLocation.split(" - ")[0].toLowerCase().trim();
  const gpsCity = closest.city.toLowerCase().trim();
  if (txCity && gpsCity && !txCity.includes(gpsCity) && !gpsCity.includes(txCity)) return 0.7;
  return 0;
}
//#endregion
