import { parse } from "https://deno.land/std@0.200.0/csv/parse.ts";
import {
  TransactionSchema, UserSchema, LocationSchema, SmsSchema, MailSchema,
  type IDataset, type IUser, type ITransaction,
} from "./types.ts";

//#region Dataset Loader
export async function loadDataset(basePath: string): Promise<IDataset> {
  const [csvText, usersRaw, locsRaw, smsRaw, mailsRaw] = await Promise.all([
    Deno.readTextFile(`${basePath}/transactions.csv`),
    Deno.readTextFile(`${basePath}/users.json`),
    Deno.readTextFile(`${basePath}/locations.json`),
    Deno.readTextFile(`${basePath}/sms.json`),
    Deno.readTextFile(`${basePath}/mails.json`),
  ]);

  const rawRows = parse(csvText, {
    skipFirstRow: true,
    columns: [
      "transaction_id", "sender_id", "recipient_id", "transaction_type",
      "amount", "location", "payment_method", "sender_iban", "recipient_iban",
      "balance_after", "description", "timestamp",
    ],
  });

  return {
    transactions: rawRows.map(r => TransactionSchema.parse(r)),
    users: JSON.parse(usersRaw).map((u: unknown) => UserSchema.parse(u)),
    locations: JSON.parse(locsRaw).map((l: unknown) => LocationSchema.parse(l)),
    sms: JSON.parse(smsRaw).map((s: unknown) => SmsSchema.parse(s)),
    mails: JSON.parse(mailsRaw).map((m: unknown) => MailSchema.parse(m)),
  };
}
//#endregion

//#region Identity Maps
export interface IIdentityMaps {
  ibanToUser: Map<string, IUser>;
  biotagToUser: Map<string, IUser>;
  biotagToIban: Map<string, string>;
}

function isCitizenId(id: string): boolean {
  // Citizen biotags contain dashes and aren't EMP/ABIT/ACCTR/etc. prefixes
  if (!id) return false;
  const knownPrefixes = ["EMP", "ABIT", "ACCTR", "ACCST", "ACCRN", "APP", "BILCY", "DOM", "GRSC"];
  return id.includes("-") && !knownPrefixes.some(p => id.startsWith(p));
}

export function buildIdentityMaps(users: IUser[], transactions: ITransaction[]): IIdentityMaps {
  const ibanToUser = new Map<string, IUser>();
  for (const user of users) {
    ibanToUser.set(user.iban, user);
  }

  const biotagToUser = new Map<string, IUser>();
  const biotagToIban = new Map<string, string>();

  for (const tx of transactions) {
    if (isCitizenId(tx.sender_id) && tx.sender_iban) {
      const user = ibanToUser.get(tx.sender_iban);
      if (user) {
        biotagToUser.set(tx.sender_id, user);
        biotagToIban.set(tx.sender_id, tx.sender_iban);
      }
    }
    if (isCitizenId(tx.recipient_id) && tx.recipient_iban) {
      const user = ibanToUser.get(tx.recipient_iban);
      if (user) {
        biotagToUser.set(tx.recipient_id, user);
        biotagToIban.set(tx.recipient_id, tx.recipient_iban);
      }
    }
  }

  return { ibanToUser, biotagToUser, biotagToIban };
}
//#endregion
