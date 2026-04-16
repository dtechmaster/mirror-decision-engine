import { load } from "https://deno.land/std@0.200.0/dotenv/mod.ts";
import { runPipeline, getDatasetConfigs } from "./src/engine.ts";

await load({ export: true });

//#region Entry Point
async function main() {
  const baseDir = "./data";
  const outputDir = "./output";
  const configs = getDatasetConfigs(baseDir);

  await Deno.mkdir(outputDir, { recursive: true });

  console.log("======================================================");
  console.log("🕵️  MIRROR FRAUD DETECTION ENGINE");
  console.log("======================================================");

  for (const config of configs) {
    console.log(`\n[${config.name}]`);
    const result = await runPipeline(config.trainPath, config.validPath);
    const slug = config.name.replace(/ /g, "_");

    const trainFile = `${outputDir}/train_${slug}.txt`;
    const validFile = `${outputDir}/validation_${slug}.txt`;

    await Deno.writeTextFile(trainFile, result.train.join("\n"));
    await Deno.writeTextFile(validFile, result.validation.join("\n"));

    console.log(`  → ${trainFile} (${result.train.length} IDs)`);
    console.log(`  → ${validFile} (${result.validation.length} IDs)`);
  }

  console.log("\n======================================================");
  console.log("✅ 6 output files written to ./output/");
  console.log("======================================================\n");
}
//#endregion

main();
