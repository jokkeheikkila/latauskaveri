import { SimulationParams, SimulationResultPoint, SimulationSummary, ComparativeRun, BatteryType } from './types';

// Optimal charging curves at optimal battery temperature (25°C to 45°C)
export const LR_OPTIMAL_CURVE: [number, number][] = [
  [0, 210],
  [5, 222],
  [10, 238],
  [15, 252],
  [20, 258],
  [25, 263],
  [30, 263],
  [35, 263],
  [40, 261],
  [45, 255],
  [50, 248],
  [52, 195], // Stepdown
  [55, 192],
  [60, 190],
  [65, 184],
  [70, 180],
  [72, 155], // Stepdown
  [75, 145],
  [78, 125], // Stepdown
  [80, 115],
  [82, 65],  // Post 80% throttling
  [85, 55],
  [90, 32],
  [95, 20],
  [100, 8]
];

export const SR_OPTIMAL_CURVE: [number, number][] = [
  [0, 135],
  [5, 145],
  [10, 158],
  [15, 172],
  [20, 180],
  [25, 180],
  [30, 180],
  [35, 180],
  [40, 180],
  [45, 175],
  [50, 170],
  [52, 140], // Stepdown
  [55, 136],
  [60, 134],
  [65, 130],
  [70, 126],
  [72, 105], // Stepdown
  [75, 96],
  [78, 85],  // Stepdown
  [80, 78],
  [82, 45],  // Post 80% throttling
  [85, 38],
  [90, 22],
  [95, 14],
  [100, 6]
];

export function interpolatePower(soc: number, points: [number, number][]): number {
  if (!points || points.length === 0) return 0;
  if (soc <= points[0][0]) return points[0][1];
  if (soc >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (soc >= x0 && soc <= x1) {
      const t = (soc - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 0;
}

// BMS temperature limits. Many modern EVs use discrete temperature gates to protect the battery.
export function getBatteryTempLimit(temp: number): { limitKw: number; label: string } {
  if (temp < -10) {
    return { limitKw: 15, label: 'Deep Freeze Gating' };
  } else if (temp < 0) {
    return { limitKw: 35, label: 'Freezing Gating' };
  } else if (temp < 5) {
    return { limitKw: 55, label: 'Severe Cold Gating' };
  } else if (temp < 15) {
    return { limitKw: 75, label: 'Standard Cold Gating' };
  } else if (temp < 20) {
    return { limitKw: 140, label: 'Mild Cold Gating' };
  } else if (temp < 25) {
    return { limitKw: 200, label: 'Warm-up Gating' };
  } else if (temp > 49) {
    return { limitKw: 45, label: 'Severe Thermal Protection' };
  } else if (temp > 47) {
    return { limitKw: 95, label: 'Mild Thermal Protection' };
  } else if (temp > 45) {
    return { limitKw: 150, label: 'Pre-Thermal Protection' };
  }
  return { limitKw: Infinity, label: 'Optimal Temperature' };
}

export function runSimulation(params: SimulationParams): SimulationSummary {
  const batteryCapacityKwh = params.batteryCapacityKwh;
  
  // Starting battery temperature. Preconditioning warms up the cells to 25°C.
  let currentTemp = params.usePreconditioning ? 25.0 : params.initialBatteryTemp;
  let currentSoc = params.startSoC;
  
  const points: SimulationResultPoint[] = [];
  const dtSeconds = 10; // 10 second simulation steps
  const dtHours = dtSeconds / 3600;
  
  let timeElapsedSeconds = 0;
  let accumulatedEnergyKwh = 0;
  let maxPowerKw = 0;
  let totalPowerSums = 0;
  let stepsCount = 0;
  let hasColdGating = false;
  let hasThermalThrottling = false;
  let maxTempReached = currentTemp;

  // Let's create an elegant helper to push a data point
  const addPoint = (timeSec: number, socVal: number, powKw: number, optPowKw: number, tempVal: number, energyKwh: number) => {
    const mins = timeSec / 60;
    const minsWhole = Math.floor(mins);
    const secsWhole = Math.round((mins - minsWhole) * 60);
    const timeDisplay = `${minsWhole}:${secsWhole.toString().padStart(2, '0')}`;
    
    const costVal = energyKwh * params.electricityRate;
    
    // Range added calculation
    // metric: consumption in Wh/km (e.g. 180 Wh/km means 0.18 kWh/km). Added range = energyKwh / (consumptionWh / 1000)
    // imperial: consumption in Wh/mi.
    const kwhPerUnit = params.consumptionRate / 1000;
    const rangeVal = kwhPerUnit > 0 ? energyKwh / kwhPerUnit : 0;

    points.push({
      timeMinutes: parseFloat(mins.toFixed(2)),
      timeDisplay,
      soc: parseFloat(socVal.toFixed(1)),
      powerKw: parseFloat(powKw.toFixed(1)),
      optimalPowerKw: parseFloat(optPowKw.toFixed(1)),
      batteryTemp: parseFloat(tempVal.toFixed(1)),
      accumulatedEnergyKwh: parseFloat(energyKwh.toFixed(2)),
      accumulatedCost: parseFloat(costVal.toFixed(2)),
      rangeAdded: parseFloat(rangeVal.toFixed(1))
    });
  };

  // Run a point at t=0
  const initialOptimal = interpolatePower(currentSoc, params.curvePoints);
  const initialTempLimitObj = getBatteryTempLimit(currentTemp);
  const initialPower = Math.min(initialOptimal, initialTempLimitObj.limitKw, params.chargerPower);
  addPoint(0, currentSoc, initialPower, initialOptimal, currentTemp, 0);

  // Loop until we reach the target State of Charge
  // Limit to safety loop to avoid infinite execution (max 120 minutes of charging)
  while (currentSoc < params.targetSoC && timeElapsedSeconds < 7200) {
    timeElapsedSeconds += dtSeconds;
    
    // 1. Base potential power at this State of Charge
    const optPower = interpolatePower(currentSoc, params.curvePoints);
    
    // 2. Limit based on current battery cell temperature
    const tempLimitObj = getBatteryTempLimit(currentTemp);
    if (tempLimitObj.limitKw < optPower && currentTemp < 25) {
      hasColdGating = true;
    }
    if (tempLimitObj.limitKw < optPower && currentTemp > 45) {
      hasThermalThrottling = true;
    }
    
    // 3. Final actual power is bounded by battery curve, thermal/cold limits, and physical charger speed
    const actualPower = Math.min(optPower, tempLimitObj.limitKw, params.chargerPower);
    
    // 4. Update energy delivery
    const dE = actualPower * dtHours;
    accumulatedEnergyKwh += dE;
    
    // 5. Update State of Charge
    currentSoc += (dE / batteryCapacityKwh) * 100;
    if (currentSoc > 100) currentSoc = 100;
    
    // 6. Update Battery Temperature (Thermodynamics)
    // - Heat generation from internal resistance is proportional to I^2 * R, which scales with Power squared.
    // - There is also background cooling (active liquid cooling loop + ambient cooling).
    const heatGenCoeff = params.batteryType === 'long_range' ? 0.000032 : 0.000042; // standard range battery pack heats up slightly faster
    const dTGen = heatGenCoeff * actualPower * actualPower * (dtSeconds / 60); // proportional to power^2 and dt in minutes
    
    // Active battery chiller kicks in once cells exceed 25°C
    const activeCoolingCoeff = currentTemp > 25 ? 0.035 : 0.005;
    const coolingTarget = currentTemp > 25 ? 25 : params.ambientTemp;
    const dTCool = activeCoolingCoeff * (currentTemp - coolingTarget) * (dtSeconds / 60);
    
    currentTemp = currentTemp + dTGen - dTCool;
    if (currentTemp > maxTempReached) {
      maxTempReached = currentTemp;
    }

    // Keep statistics
    if (actualPower > maxPowerKw) {
      maxPowerKw = actualPower;
    }
    totalPowerSums += actualPower;
    stepsCount++;
    
    // Log data point roughly every 30 seconds or if it's the final point to keep chart rendering smooth
    if (stepsCount % 3 === 0 || currentSoc >= params.targetSoC) {
      addPoint(timeElapsedSeconds, currentSoc, actualPower, optPower, currentTemp, accumulatedEnergyKwh);
    }
  }

  const avgPower = stepsCount > 0 ? (totalPowerSums / stepsCount) : 0;
  const totalCost = accumulatedEnergyKwh * params.electricityRate;
  const totalRangeAdded = accumulatedEnergyKwh / (params.consumptionRate / 1000);

  // Generate COMPARATIVE scenarios for what-if analytics
  const comparativeRuns: ComparativeRun[] = [];

  // Comparison 1: Absolute Optimal (Preconditioned, 350kW)
  const optimalSummary = runSubSimulation({
    ...params,
    usePreconditioning: true,
    initialBatteryTemp: 25,
    chargerPower: 350
  });
  comparativeRuns.push({
    name: 'Optimal (Preconditioned, 350kW)',
    totalTimeMinutes: parseFloat((optimalSummary.timeSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(optimalSummary.avgPower.toFixed(1)),
    peakPowerKw: parseFloat(optimalSummary.peakPower.toFixed(1)),
    totalEnergyKwh: parseFloat(optimalSummary.energy.toFixed(1)),
    description: 'Perfect temperature of 25°C+ on an ultra-fast charger. No limits applied.'
  });

  // Comparison 2: Current selection
  comparativeRuns.push({
    name: 'Your Current Simulation',
    totalTimeMinutes: parseFloat((timeElapsedSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(avgPower.toFixed(1)),
    peakPowerKw: parseFloat(maxPowerKw.toFixed(1)),
    totalEnergyKwh: parseFloat(accumulatedEnergyKwh.toFixed(1)),
    description: `Selected start temp: ${params.usePreconditioning ? '25°C (Preheated)' : params.initialBatteryTemp + '°C'} on ${params.chargerPower}kW charger.`
  });

  // Comparison 3: Extreme Cold Gating (No preconditioning, 0°C battery, 350kW)
  const coldSummary = runSubSimulation({
    ...params,
    usePreconditioning: false,
    initialBatteryTemp: 0,
    chargerPower: 350
  });
  comparativeRuns.push({
    name: 'Frozen Start (0°C cells, 350kW)',
    totalTimeMinutes: parseFloat((coldSummary.timeSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(coldSummary.avgPower.toFixed(1)),
    peakPowerKw: parseFloat(coldSummary.peakPower.toFixed(1)),
    totalEnergyKwh: parseFloat(coldSummary.energy.toFixed(1)),
    description: 'Starting cold with 0°C cells. Battery forces severe gating until warmed up.'
  });

  // Comparison 4: Standard 150kW charger (Warm cells)
  const charger150Summary = runSubSimulation({
    ...params,
    usePreconditioning: true,
    initialBatteryTemp: 25,
    chargerPower: 150
  });
  comparativeRuns.push({
    name: 'Standard 150kW Charger',
    totalTimeMinutes: parseFloat((charger150Summary.timeSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(charger150Summary.avgPower.toFixed(1)),
    peakPowerKw: parseFloat(charger150Summary.peakPower.toFixed(1)),
    totalEnergyKwh: parseFloat(charger150Summary.energy.toFixed(1)),
    description: 'Charging on a standard 150 kW DC charger, limiting maximum speeds.'
  });

  // Comparison 5: Standard 50kW Charger (Warm cells)
  const charger50Summary = runSubSimulation({
    ...params,
    usePreconditioning: true,
    initialBatteryTemp: 25,
    chargerPower: 50
  });
  comparativeRuns.push({
    name: 'Slow 50kW DC Station',
    totalTimeMinutes: parseFloat((charger50Summary.timeSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(charger50Summary.avgPower.toFixed(1)),
    peakPowerKw: parseFloat(charger50Summary.peakPower.toFixed(1)),
    totalEnergyKwh: parseFloat(charger50Summary.energy.toFixed(1)),
    description: 'Standard highway triple chargers, capping speeds at 50 kW.'
  });

  return {
    points,
    totalTimeSeconds: timeElapsedSeconds,
    totalTimeMinutes: parseFloat((timeElapsedSeconds / 60).toFixed(1)),
    avgPowerKw: parseFloat(avgPower.toFixed(1)),
    peakPowerKw: parseFloat(maxPowerKw.toFixed(1)),
    totalEnergyKwh: parseFloat(accumulatedEnergyKwh.toFixed(1)),
    cost: parseFloat(totalCost.toFixed(2)),
    rangeAdded: parseFloat(totalRangeAdded.toFixed(1)),
    hasColdGating,
    hasThermalThrottling,
    maxTempReached: parseFloat(maxTempReached.toFixed(1)),
    comparativeRuns
  };
}

// Lightweight simulation helper for what-if scenarios
function runSubSimulation(params: SimulationParams): { timeSeconds: number; avgPower: number; peakPower: number; energy: number } {
  const capacity = params.batteryCapacityKwh;
  let temp = params.usePreconditioning ? 25.0 : params.initialBatteryTemp;
  let soc = params.startSoC;
  
  let timeSec = 0;
  let energy = 0;
  let peak = 0;
  let powerSum = 0;
  let counts = 0;
  
  const dt = 15; // 15 second step is fine for sub runs
  const dtHr = dt / 3600;

  while (soc < params.targetSoC && timeSec < 7200) {
    timeSec += dt;
    const optPower = interpolatePower(soc, params.curvePoints);
    const tempLimitObj = getBatteryTempLimit(temp);
    const power = Math.min(optPower, tempLimitObj.limitKw, params.chargerPower);
    
    const dE = power * dtHr;
    energy += dE;
    soc += (dE / capacity) * 100;
    
    if (power > peak) peak = power;
    powerSum += power;
    counts++;
    
    // thermodynamics simplify
    const heatGenCoeff = params.batteryType === 'long_range' ? 0.000032 : 0.000042;
    const activeCoolingCoeff = temp > 25 ? 0.035 : 0.005;
    const coolingTarget = temp > 25 ? 25 : params.ambientTemp;
    
    temp = temp + (heatGenCoeff * power * power - activeCoolingCoeff * (temp - coolingTarget)) * (dt / 60);
  }

  return {
    timeSeconds: timeSec,
    avgPower: counts > 0 ? (powerSum / counts) : 0,
    peakPower: peak,
    energy
  };
}
