import { parse } from "https://deno.land/std@0.200.0/csv/parse.ts";
import { normalizeStatus } from "./normalizer.ts";

// --- LOGIC LAYERS ---
function calculateMedian(v: number[]) {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function analyzeL1(value: number, history: number[]) {
  if (history.length < 3) return { status: "COLLECTING", score: 0 };
  const median = calculateMedian(history);
  const deviations = history.map(v => Math.abs(v - median));
  const mad = calculateMedian(deviations) || 1;
  const score = Math.abs(value - median) / mad;
  return { status: score > 1.5 ? "ANOMALY" : "STABLE", score };
}

async function runDecisionEngine() {
  try {
    console.clear();
    console.log("======================================================");
    console.log("📡 THE EYE SYSTEM: PROACTIVE MONITORING");
    console.log("======================================================\n");

    // 1. LOAD DATA SOURCES
    const usersRaw = await Deno.readTextFile("./users.json");
    const userList = JSON.parse(usersRaw);
    const nameMap = new Map(userList.map((u: any) => [String(u.user_id).trim(), `${u.first_name} ${u.last_name}`]));

    const locationsRaw = await Deno.readTextFile("./locations.json");
    const locationList = JSON.parse(locationsRaw);
    const locationMap = new Map();
    const alertsByCitizen = new Map<string, number>();
    locationList.forEach((l: any) => locationMap.set(String(l.user_id).trim(), l.city));

    const statusText = await Deno.readTextFile("./status.csv");
    const statusRows = parse(statusText, {
      skipFirstRow: true,
      columns: ["EventID", "CitizenID", "EventType", "PhysicalActivityIndex", "SleepQualityIndex", "EnvironmentalExposureLevel", "Timestamp"]
    }) as any[];

    // Stress injection (Craig)
    statusRows.push({ CitizenID: "WNACROYX", SleepQualityIndex: "8", PhysicalActivityIndex: "92", EnvironmentalExposureLevel: "88" });

    const histories = new Map<string, number[]>();
    const escalatedToAI: string[] = [];

    // Filter counters
    let totalEntries = 0;
    let l0Passed = 0;
    let l1Anomalies = 0;

    for (const row of statusRows) {
      totalEntries++;
      const data = normalizeStatus(row);
      const cleanId = String(data.citizenId).trim();

      // LAYER L0: Basic integrity
      if (!cleanId || cleanId === "UNKNOWN") continue;
      l0Passed++;

      const citizenName = nameMap.get(cleanId) || cleanId;
      const currentCity = locationMap.get(cleanId) || "Unknown";
      const history = histories.get(cleanId) || [];
      const l1Result = analyzeL1(data.sleepIndex, history);

      // LAYER L2: Escalation decision
      const l2Risk = l1Result.score > 3.0 && (data.activityIndex > 60 || data.envExposure > 70);

      // REAL-TIME OUTPUT
      if (history.length >= 3) {
        if (l1Result.status === "ANOMALY") {
          l1Anomalies++;
          const prefix = l2Risk ? "🚨 [CRITICAL]" : "🟡 [DEVIATION]";
          console.log(`${prefix} ${citizenName.padEnd(20)} | L1 Score: ${l1Result.score.toFixed(2)}`);
        }
      }

      if (l2Risk) {
        // Track how many times this citizen triggered L2
        const totalAlerts = (alertsByCitizen.get(citizenName) || 0) + 1;
        alertsByCitizen.set(citizenName, totalAlerts);

        // Store for the AI block with city detail
        escalatedToAI.push(`${citizenName} (${currentCity})`);
      }

      history.push(data.sleepIndex);
      histories.set(cleanId, history);
    }

    // --- FINAL BLOCK: ESCALATION ---
    console.log("\n------------------------------------------------------");
    console.log("🤖 ESCALATED TO AI (L3/L4):");
    if (alertsByCitizen.size > 0) {
      alertsByCitizen.forEach((count, name) => {
        console.log(`   👉 ${name.padEnd(20)} | Status: ${count} critical events detected`);
      });
    } else {
      console.log("   ✅ No citizens require intervention.");
    }

    // --- FINAL BLOCK: METRICS ---
    console.log("------------------------------------------------------");
    console.log("📊 FILTER SUMMARY BY LAYER:");
    console.log(`   L0 (Integrity):   ${l0Passed} of ${totalEntries} records approved.`);
    console.log(`   L1 (Statistical): ${l1Anomalies} anomalies detected.`);
    console.log(`   L2 (Semantic):    ${escalatedToAI.length} cases promoted to AI.`);

    const savings = (100 - (escalatedToAI.length / totalEntries * 100)).toFixed(1);
    console.log(`\n✅ FILTER EFFICIENCY: ${savings}% processing savings.`);
    console.log("======================================================\n");

  } catch (error) {
    console.error("❌ ERROR:", (error as Error).message);
  }
}

runDecisionEngine();
