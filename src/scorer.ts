import type { ITransaction, ICitizenBaseline, ITransactionFeatures, ITransactionScore } from "./types.ts";
import {
  calculateMedian, calculateMAD, madScore, sigmoid,
  geoAnomalyScore, descriptionFraudScore, benignDescriptionScore,
  phishingContactScore, buildPhishingTimeline,
} from "./features.ts";
import type { ISms, IMail } from "./types.ts";

//#region Baseline Builder
export function buildCitizenBaseline(
  biotag: string,
  user: { salary: number; iban: string; first_name: string; residence: { city: string; lat: number; lng: number } },
  transactions: ITransaction[],
  locations: { timestamp: string; lat: number; lng: number; city: string }[],
  sms: ISms[],
  mails: IMail[],
): ICitizenBaseline {
  const citizenTxs = transactions.filter(tx => tx.sender_id === biotag);
  const amounts = citizenTxs.map(tx => tx.amount);
  const median = calculateMedian(amounts);
  const mad = calculateMAD(amounts, median);

  const activeHours = citizenTxs.map(tx => new Date(tx.timestamp).getHours());
  const knownRecipients = new Set(citizenTxs.map(tx => tx.recipient_id).filter(Boolean));
  const knownPaymentMethods = new Set(citizenTxs.map(tx => tx.payment_method).filter(Boolean));
  const knownTransactionTypes = new Set(citizenTxs.map(tx => tx.transaction_type).filter(Boolean));
  const phishingTimeline = buildPhishingTimeline(user.first_name, sms, mails);

  return {
    biotag,
    user: user as ICitizenBaseline["user"],
    monthlyIncome: user.salary / 12,
    amounts,
    medianAmount: median,
    madAmount: mad,
    knownRecipients,
    knownPaymentMethods,
    knownTransactionTypes,
    activeHours,
    locations,
    phishingTimeline,
  };
}
//#endregion

//#region Feature Extraction
export function extractFeatures(
  tx: ITransaction,
  baseline: ICitizenBaseline,
  nlpBoost = 0,
): ITransactionFeatures {
  // Phishing contact: did the citizen receive a phishing message before this transaction?
  const phishingContact = phishingContactScore(tx.timestamp, baseline.phishingTimeline);

  // Amount MAD score
  const rawMad = baseline.amounts.length >= 3
    ? madScore(tx.amount, baseline.medianAmount, baseline.madAmount)
    : 0;
  const amountMadScore = sigmoid(rawMad, 3.5, 0.7);

  // Salary ratio: amount vs monthly income
  const amountSalaryRatio = baseline.monthlyIncome > 0
    ? Math.min(tx.amount / baseline.monthlyIncome, 5) / 5
    : 0;

  // Balance drain
  const balanceBefore = tx.balance_after + tx.amount;
  const balanceDrainRatio = balanceBefore > 0
    ? Math.min(tx.amount / balanceBefore, 1)
    : 0;

  // Geo anomaly (in-person only)
  const geoAnomaly = tx.transaction_type === "in-person payment"
    ? geoAnomalyScore(tx.timestamp, tx.location, baseline.locations)
    : 0;

  // Description signals
  const descFraud = descriptionFraudScore(tx.description);
  const benignPenalty = benignDescriptionScore(tx.description);

  // Recipient novelty
  const recipientNovelty = tx.recipient_id && !baseline.knownRecipients.has(tx.recipient_id) ? 1 : 0;

  return {
    phishingContact,
    amountMadScore,
    amountSalaryRatio,
    balanceDrainRatio,
    geoAnomaly,
    descriptionFraudScore: descFraud,
    benignPenalty,
    recipientNovelty,
    nlpBoost,
  };
}
//#endregion

//#region Composite Scoring
// Phishing correlation is our primary signal.
// Benign descriptions apply a strong dampener (salary/rent/bills are almost never fraud).
const WEIGHTS = {
  phishingContact:      0.42,
  amountMadScore:       0.18,
  amountSalaryRatio:    0.08,
  balanceDrainRatio:    0.08,
  geoAnomaly:           0.12,
  descriptionFraudScore: 0.07,
  recipientNovelty:     0.05,
};

export function compositeScore(features: ITransactionFeatures): number {
  const weighted =
    features.phishingContact      * WEIGHTS.phishingContact +
    features.amountMadScore        * WEIGHTS.amountMadScore +
    features.amountSalaryRatio     * WEIGHTS.amountSalaryRatio +
    features.balanceDrainRatio     * WEIGHTS.balanceDrainRatio +
    features.geoAnomaly            * WEIGHTS.geoAnomaly +
    features.descriptionFraudScore * WEIGHTS.descriptionFraudScore +
    features.recipientNovelty      * WEIGHTS.recipientNovelty;

  // Benign penalty: strongly dampen score for clearly legitimate transactions
  const dampened = features.benignPenalty > 0
    ? weighted * (1 - 0.75 * features.benignPenalty)
    : weighted;

  // NLP signal: when LLM fires, blend it at 50% weight with statistical score
  if (features.nlpBoost > 0) {
    return Math.min(dampened * 0.50 + features.nlpBoost * 0.50, 1.0);
  }
  return dampened;
}
//#endregion

//#region Threshold Calibration
export function calibrateThreshold(scores: ITransactionScore[]): number {
  if (scores.length === 0) return 0.5;

  // Target top 10% but require minimum absolute score of 0.20
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);
  const topN = Math.max(1, Math.floor(sorted.length * 0.10));
  const percentileThreshold = sorted[topN - 1]?.compositeScore ?? 0.20;

  return Math.max(percentileThreshold, 0.20);
}
//#endregion

//#region Score Transaction
export function scoreTransaction(
  tx: ITransaction,
  baseline: ICitizenBaseline,
  nlpBoost = 0,
): ITransactionScore {
  const features = extractFeatures(tx, baseline, nlpBoost);
  return {
    transactionId: tx.transaction_id,
    citizenId: baseline.biotag,
    compositeScore: compositeScore(features),
    features,
    isSuspicious: false,
  };
}
//#endregion
