export type BatteryType = 'long_range' | 'standard_range';

export type ChargerType = 'ultra_fast' | 'fast' | 'standard' | 'custom';

export interface ChargingCurvePoint {
  soc: number;
  powerKw: number;
}

export interface Vehicle {
  id: string;
  name: string;
  batteryCapacityKwh: number;
  peakPowerKw: number;
  architecture: '400V' | '800V';
  consumptionRate: number; // Wh/km
  curve: ChargingCurvePoint[];
}

export interface SimulationParams {
  batteryType: BatteryType;
  batteryCapacityKwh: number; // Dynamic capacity in kWh
  curvePoints: [number, number][]; // Dynamic charging curve points [SoC, kW]
  chargerPower: number; // Max charging power in kW
  startSoC: number; // e.g. 10
  targetSoC: number; // e.g. 80
  ambientTemp: number; // °C
  initialBatteryTemp: number; // °C
  usePreconditioning: boolean;
  electricityRate: number; // e.g. 0.35 $/kWh
  consumptionRate: number; // Efficiency in Wh/km or Wh/mi depending on unit
  unitSystem: 'metric' | 'imperial';
}

export interface SimulationResultPoint {
  timeMinutes: number;
  timeDisplay: string;
  soc: number;
  powerKw: number;
  optimalPowerKw: number; // Power achievable if battery was 25°C+
  batteryTemp: number;
  accumulatedEnergyKwh: number;
  accumulatedCost: number;
  rangeAdded: number;
}

export interface ComparativeRun {
  name: string;
  totalTimeMinutes: number;
  avgPowerKw: number;
  peakPowerKw: number;
  totalEnergyKwh: number;
  description: string;
}

export interface SimulationSummary {
  points: SimulationResultPoint[];
  totalTimeSeconds: number;
  totalTimeMinutes: number;
  avgPowerKw: number;
  peakPowerKw: number;
  totalEnergyKwh: number;
  cost: number;
  rangeAdded: number;
  hasColdGating: boolean;
  hasThermalThrottling: boolean;
  maxTempReached: number;
  comparativeRuns: ComparativeRun[];
}
