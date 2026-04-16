import { z } from "npm:zod";

//#region Transaction
export const TransactionSchema = z.object({
  transaction_id: z.string(),
  sender_id: z.string(),
  recipient_id: z.string(),
  transaction_type: z.string(),
  amount: z.coerce.number(),
  location: z.string(),
  payment_method: z.string(),
  sender_iban: z.string(),
  recipient_iban: z.string(),
  balance_after: z.coerce.number(),
  description: z.string(),
  timestamp: z.string(),
});
export type ITransaction = z.infer<typeof TransactionSchema>;
//#endregion

//#region User
export const UserSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  birth_year: z.number(),
  salary: z.number(),
  job: z.string(),
  iban: z.string(),
  residence: z.object({
    city: z.string(),
    lat: z.coerce.number(),
    lng: z.coerce.number(),
  }),
  description: z.string(),
});
export type IUser = z.infer<typeof UserSchema>;
//#endregion

//#region Location
export const LocationSchema = z.object({
  biotag: z.string(),
  timestamp: z.string(),
  lat: z.number(),
  lng: z.number(),
  city: z.string(),
});
export type ILocation = z.infer<typeof LocationSchema>;
//#endregion

//#region SMS & Mail
export const SmsSchema = z.object({ sms: z.string() });
export type ISms = z.infer<typeof SmsSchema>;

export const MailSchema = z.object({ mail: z.string() });
export type IMail = z.infer<typeof MailSchema>;
//#endregion

//#region Dataset
export interface IDataset {
  transactions: ITransaction[];
  users: IUser[];
  locations: ILocation[];
  sms: ISms[];
  mails: IMail[];
}
//#endregion

//#region Citizen Baseline (built from training)
import type { IPhishingEvent } from "./features.ts";

export interface ICitizenBaseline {
  biotag: string;
  user: IUser;
  monthlyIncome: number;
  amounts: number[];
  medianAmount: number;
  madAmount: number;
  knownRecipients: Set<string>;
  knownPaymentMethods: Set<string>;
  knownTransactionTypes: Set<string>;
  activeHours: number[];
  locations: ILocation[];
  phishingTimeline: IPhishingEvent[];   // phishing contacts from SMS/mails
}
//#endregion

//#region Transaction Features
export interface ITransactionFeatures {
  phishingContact: number;          // 0-1, phishing SMS/email within 10 days before tx
  amountMadScore: number;           // MAD deviation from citizen's normal amounts
  amountSalaryRatio: number;        // amount / (annual_salary / 12)
  balanceDrainRatio: number;        // amount / (balance_after + amount)
  geoAnomaly: number;               // 0-1, impossible travel or location mismatch
  descriptionFraudScore: number;    // 0-1, fraud keyword density
  benignPenalty: number;            // 0-1, how clearly benign the transaction is
  recipientNovelty: number;         // 1 = never seen this recipient, 0 = known
  nlpBoost: number;                 // 0-1, Groq NLP analysis result (0 if not called)
}
//#endregion

//#region Transaction Score Output
export interface ITransactionScore {
  transactionId: string;
  citizenId: string;
  compositeScore: number;
  features: ITransactionFeatures;
  isSuspicious: boolean;
}
//#endregion
