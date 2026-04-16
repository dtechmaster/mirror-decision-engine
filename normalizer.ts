// normalizer.ts

export interface ProcessedCitizen {
  citizenId: string;
  sleepIndex: number;
  activityIndex: number;
  envExposure: number;
  timestamp: string;
}

export function normalizeStatus(row: any): ProcessedCitizen {
  return {
    // Maps CitizenID (CSV) or user_id (JSON)
    citizenId: String(row.CitizenID || row.user_id || "UNKNOWN").trim(),

    // Maps the long field names from the source file to system variables
    sleepIndex: Number(row.SleepQualityIndex || 0),
    activityIndex: Number(row.PhysicalActivityIndex || 0),
    envExposure: Number(row.EnvironmentalExposureLevel || 0),

    timestamp: String(row.Timestamp || new Date().toISOString()),
  };
}
