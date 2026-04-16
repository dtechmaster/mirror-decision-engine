import type { IDataset, ITransactionScore } from "./types.ts";
import { loadDataset, buildIdentityMaps } from "./loader.ts";
import { buildCitizenBaseline, scoreTransaction, calibrateThreshold } from "./scorer.ts";
import { analyzeBatch, type IBatchInput } from "./nlp.ts";

//#region Pipeline
export interface IPipelineResult {
  train: string[];
  validation: string[];
}

async function scoreCitizenTransactions(
  transactions: ITransaction[],
  baselines: Map<string, ReturnType<typeof buildCitizenBaseline>>,
  biotagToUser: Map<string, unknown>,
  sms: unknown[],
  mails: unknown[],
  label: string,
): Promise<ITransactionScore[]> {
  // First pass: statistical scoring
  const scores: ITransactionScore[] = [];
  for (const tx of transactions) {
    const baseline = baselines.get(tx.sender_id);
    if (!baseline) continue;
    scores.push(scoreTransaction(tx, baseline));
  }

  console.log(`  [${label}] Statistical scored: ${scores.length}`);

  // Second pass: LLM on top 30% statistical scorers
  const sortedByScore = [...scores].sort((a, b) => b.compositeScore - a.compositeScore);
  const llmCandidates = sortedByScore.slice(0, Math.ceil(scores.length * 0.30));

  const batchInputs: IBatchInput[] = llmCandidates.map(s => ({
    transactionId: s.transactionId,
    tx: transactions.find(t => t.transaction_id === s.transactionId)!,
    user: (biotagToUser as Map<string, any>).get(s.citizenId)!,
  })).filter(b => b.tx && b.user);

  console.log(`  [${label}] Sending ${batchInputs.length} to Groq (top 30%)...`);
  const nlpResults = await analyzeBatch(batchInputs, sms as any, mails as any);

  // Third pass: re-score with NLP boost
  for (let i = 0; i < scores.length; i++) {
    const nlpBoost = nlpResults.get(scores[i].transactionId) ?? 0;
    if (nlpBoost > 0) {
      const tx = transactions.find(t => t.transaction_id === scores[i].transactionId)!;
      const baseline = baselines.get(scores[i].citizenId)!;
      scores[i] = scoreTransaction(tx, baseline, nlpBoost);
    }
  }

  return scores;
}

import type { ITransaction } from "./types.ts";

export async function runPipeline(trainPath: string, validPath: string): Promise<IPipelineResult> {
  console.log(`\n  Loading datasets...`);
  const [train, valid] = await Promise.all([
    loadDataset(trainPath),
    loadDataset(validPath),
  ]);

  const allTransactions = [...train.transactions, ...valid.transactions];
  const allUsers = [...train.users, ...valid.users.filter(
    vu => !train.users.some(tu => tu.iban === vu.iban)
  )];
  const maps = buildIdentityMaps(allUsers, allTransactions);

  console.log(`  Citizens: ${maps.biotagToUser.size} | Train txns: ${train.transactions.length} | Valid txns: ${valid.transactions.length}`);

  //#region Build baselines (train→valid, valid→train)
  const validBaselines = new Map(
    [...maps.biotagToUser.entries()].map(([biotag, user]) => {
      const locs = train.locations.filter(l => l.biotag === biotag);
      return [biotag, buildCitizenBaseline(biotag, user, train.transactions, locs, valid.sms, valid.mails)] as const;
    })
  );

  const trainBaselines = new Map(
    [...maps.biotagToUser.entries()].map(([biotag, user]) => {
      const locs = valid.locations.filter(l => l.biotag === biotag);
      return [biotag, buildCitizenBaseline(biotag, user, valid.transactions, locs, train.sms, train.mails)] as const;
    })
  );
  //#endregion

  //#region Score both sets with LLM
  const [validScores, trainScores] = await Promise.all([
    scoreCitizenTransactions(valid.transactions, validBaselines, maps.biotagToUser, valid.sms, valid.mails, "validation"),
    scoreCitizenTransactions(train.transactions, trainBaselines, maps.biotagToUser, train.sms, train.mails, "train"),
  ]);
  //#endregion

  //#region Threshold + output
  const validThreshold = calibrateThreshold(validScores);
  const trainThreshold = calibrateThreshold(trainScores);

  const suspiciousValid = validScores.filter(s => s.compositeScore >= validThreshold).map(s => s.transactionId);
  const suspiciousTrain = trainScores.filter(s => s.compositeScore >= trainThreshold).map(s => s.transactionId);

  console.log(`  Validation: ${suspiciousValid.length} flagged (threshold ${validThreshold.toFixed(3)})`);
  console.log(`  Training:   ${suspiciousTrain.length} flagged (threshold ${trainThreshold.toFixed(3)})`);
  //#endregion

  return { train: suspiciousTrain, validation: suspiciousValid };
}
//#endregion

//#region Dataset Config
export interface IDatasetConfig {
  name: string;
  trainPath: string;
  validPath: string;
}

export function getDatasetConfigs(baseDir: string): IDatasetConfig[] {
  return [
    {
      name: "The Truman Show",
      trainPath: `${baseDir}/training/The+Truman+Show+-+train/The Truman Show - train`,
      validPath: `${baseDir}/validation/The+Truman+Show+-+validation/The Truman Show - validation`,
    },
    {
      name: "Deus Ex",
      trainPath: `${baseDir}/training/Deus+Ex+-+train/Deus Ex - train`,
      validPath: `${baseDir}/validation/Deus+Ex+-+validation/Deus Ex - validation`,
    },
    {
      name: "Brave New World",
      trainPath: `${baseDir}/training/Brave+New+World+-+train/Brave New World - train`,
      validPath: `${baseDir}/validation/Brave+New+World+-+validation/Brave New World - validation`,
    },
  ];
}
//#endregion
