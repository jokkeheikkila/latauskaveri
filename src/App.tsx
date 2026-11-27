import React, { useState, useEffect, useMemo, useRef, useCallback, ReactNode, PointerEvent, MouseEvent, ButtonHTMLAttributes, SyntheticEvent } from 'react';
import { Vehicle, ChargingCurvePoint } from './types';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Zap,
  Thermometer,
  Clock,
  BatteryCharging,
  Info,
  Sliders,
  CheckCircle,
  Snowflake,
  Sparkles,
  RefreshCw,
  Plus,
  Minus,
  Navigation,
  CloudSun,
  MapPin,
  Loader2,
  Search,
  Locate,
  ExternalLink,
  Euro,
  Coins,
  TrendingUp,
  Percent,
  Smartphone,
  Download,
  X,
} from 'lucide-react';


// Helper to format any number to Finnish locale (comma as decimal separator)
const formatNumber = (num: number | string | undefined | null, decimals: number = 2, maxDecimals?: number): string => {
  if (num === undefined || num === null || num === '') return '';
  const val = typeof num === 'number' ? num : parseFloat(num);
  if (isNaN(val)) return '';
  
  return val.toLocaleString('fi-FI', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: maxDecimals !== undefined ? maxDecimals : decimals,
  });
};

const fn = (num: number | string | undefined | null, decimals: number = 2): string => {
  return formatNumber(num, decimals, decimals);
};

const fnMax = (num: number | string | undefined | null, decimals: number = 2): string => {
  return formatNumber(num, 0, decimals);
};

const RelativeTime = ({ timestamp }: { timestamp: string | null }) => {
  const [text, setText] = useState('Ei päivitetty');

  useEffect(() => {
    if (!timestamp) {
      setText('Ei päivitetty');
      return;
    }

    const updateText = () => {
      const updatedDate = new Date(timestamp);
      if (isNaN(updatedDate.getTime())) {
        // If it's a fallback string like '7/2/2026, 11:22:50' depending on locale, it might fail in some browsers
        // But let's try to parse it, or fallback to the string
        const parsed = timestamp.split(',')[1]?.trim() || timestamp;
        setText(`Päivitetty: ${parsed}`);
        return;
      }

      const now = new Date();
      const diffMs = Math.max(0, now.getTime() - updatedDate.getTime());
      const diffMins = Math.floor(diffMs / (1000 * 60));

      if (diffMins < 1) {
        setText('Päivitetty: alle minuutti sitten');
        return;
      }

      const days = Math.floor(diffMins / (24 * 60));
      const hours = Math.floor((diffMins % (24 * 60)) / 60);
      const mins = diffMins % 60;

      const parts = [];
      if (days > 0) parts.push(days === 1 ? '1 päivä' : `${days} päivää`);
      if (hours > 0) parts.push(hours === 1 ? '1 tunti' : `${hours} tuntia`);
      if (mins > 0 || parts.length === 0) parts.push(mins === 1 ? '1 minuutti' : `${mins} minuuttia`);

      setText(`Päivitetty: ${parts.join(' ')} sitten`);
    };

    updateText();
    const interval = setInterval(updateText, 60000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return <>{text}</>;
};

const DEFAULT_CUSTOM_VEHICLE: Vehicle = {
  id: 'custom',
  name: 'Oma ajoneuvo',
  batteryCapacityKwh: 75.0,
  peakPowerKw: 150,
  architecture: '400V',
  consumptionRate: 170,
  curve: [
    { soc: 0, powerKw: 150 },
    { soc: 20, powerKw: 150 },
    { soc: 40, powerKw: 120 },
    { soc: 60, powerKw: 90 },
    { soc: 80, powerKw: 50 },
    { soc: 100, powerKw: 10 }
  ]
};

function interpolatePower(soc: number, points: ChargingCurvePoint[]): number {
  if (!points || points.length === 0) return 0;
  if (soc <= points[0].soc) return points[0].powerKw;
  if (soc >= points[points.length - 1].soc) return points[points.length - 1].powerKw;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (soc >= p0.soc && soc <= p1.soc) {
      if (p1.soc === p0.soc) return p0.powerKw;
      const t = (soc - p0.soc) / (p1.soc - p0.soc);
      return p0.powerKw + t * (p1.powerKw - p0.powerKw);
    }
  }
  return 0;
}

// Discrete cold-gating thresholds for battery protection
function getBatteryTempLimit(temp: number): { limitKw: number; label: string; severity: 'high' | 'medium' | 'none' } {
  if (temp < -10) {
    return { limitKw: 15, label: 'Syväpakkasen latausrajoitus', severity: 'high' };
  } else if (temp < 0) {
    return { limitKw: 35, label: 'Pakkaslatausrajoitus', severity: 'high' };
  } else if (temp < 5) {
    return { limitKw: 55, label: 'Kova kylmärajoitus', severity: 'high' };
  } else if (temp < 15) {
    return { limitKw: 75, label: 'Normaali kylmärajoitus', severity: 'medium' };
  } else if (temp < 20) {
    return { limitKw: 140, label: 'Lievä kylmärajoitus', severity: 'medium' };
  } else if (temp < 25) {
    return { limitKw: 200, label: 'Akun lämmitys käynnissä', severity: 'medium' };
  }
  return { limitKw: Infinity, label: 'Optimaalinen lämpötila', severity: 'none' };
}

interface SpotPriceItem {
  dateTime: string;
  priceWithTaxCents: number;
  priceNoTaxCents: number;
}

// Get spot price for a simulated offset of minutes from the session start time and day offset
const getSpotPriceForOffset = (
  startStr: string,
  minutesOffset: number,
  list: SpotPriceItem[],
  defaultPrice: number,
  useVat: boolean,
  resolution: 'hourly' | '15min' = 'hourly',
  startDayOffset: number = 0
): { price: number; isExactMatch: boolean } => {
  if (!list || list.length === 0) {
    if (resolution === '15min') {
      const [startH, startM] = startStr.split(':').map(Number);
      const totalMin = (isNaN(startH) ? 0 : startH) * 60 + (isNaN(startM) ? 0 : startM) + minutesOffset;
      const q = Math.floor((totalMin % 60) / 15);
      const hour = Math.floor((totalMin / 60) % 24);
      const hash = (hour * 7 + q * 17) % 10;
      const pct = -0.12 + (hash / 9) * 0.24;
      return { price: parseFloat((defaultPrice * (1 + pct)).toFixed(3)), isExactMatch: false };
    }
    return { price: defaultPrice, isExactMatch: false };
  }
  
  // Parse start time "HH:MM"
  const [startH, startM] = startStr.split(':').map(Number);
  if (isNaN(startH) || isNaN(startM)) return { price: defaultPrice, isExactMatch: false };
  
  // Base date is today's date + startDayOffset
  const baseDate = new Date();
  const sessionStartDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + startDayOffset,
    startH,
    startM,
    0,
    0
  );
  
  // Target date-time for this block
  const targetTime = new Date(sessionStartDate.getTime() + minutesOffset * 60 * 1000);
  
  // Find matching prices in the list where targetTime is in that hour
  const matchingItems = list.filter((item) => {
    const itemTime = new Date(item.dateTime);
    return itemTime.getFullYear() === targetTime.getFullYear() &&
           itemTime.getMonth() === targetTime.getMonth() &&
           itemTime.getDate() === targetTime.getDate() &&
           itemTime.getHours() === targetTime.getHours();
  });
  
  let basePrice = defaultPrice;
  let matchingDateTimeStr = targetTime.toISOString();
  
  if (matchingItems.length > 0) {
    if (resolution === 'hourly') {
      const sum = matchingItems.reduce((acc, item) => acc + (useVat ? item.priceWithTaxCents : item.priceNoTaxCents), 0);
      basePrice = sum / matchingItems.length;
    } else {
      const exact15Min = matchingItems.find(item => {
        const itemTime = new Date(item.dateTime);
        return Math.floor(itemTime.getMinutes() / 15) === Math.floor(targetTime.getMinutes() / 15);
      });
      const chosenItem = exact15Min || matchingItems[0];
      basePrice = useVat ? chosenItem.priceWithTaxCents : chosenItem.priceNoTaxCents;
      matchingDateTimeStr = chosenItem.dateTime;
    }

    if (resolution === '15min') {
      const q = Math.floor(targetTime.getMinutes() / 15);
      const dt = new Date(matchingDateTimeStr);
      const hash = (dt.getDate() * 13 + dt.getHours() * 7 + q * 17) % 10;
      const pct = -0.12 + (hash / 9) * 0.24; // fluctuation between -12% and +12%
      return { price: parseFloat((basePrice * (1 + pct)).toFixed(3)), isExactMatch: true };
    }
    
    return { price: basePrice, isExactMatch: true };
  }

  // If exact matching hour is NOT found, return default price and flag as not exact match
  return { price: defaultPrice, isExactMatch: false };
};

// Standard Local Storage custom hook for persisting selections
function useLocalStorage<T>(key: string, initialValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      let item = window.localStorage.getItem(key);
      if (!item) {
        // Fallback to old key starting with "ioniq5_" if applicable
        const oldKey = key.replace(/^latauskaveri_/, 'ioniq5_');
        if (oldKey !== key) {
          item = window.localStorage.getItem(oldKey);
        }
      }
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setLocalStorageState = (value: T | ((prev: T) => T)) => {
    try {
      setState((prev) => {
        const nextValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        window.localStorage.setItem(key, JSON.stringify(nextValue));
        return nextValue;
      });
    } catch (error) {
      console.error('Error saving local storage:', error);
    }
  };

  return [state, setLocalStorageState];
}

interface RepeatButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onAction: () => void;
  delay?: number;
  interval?: number;
  className?: string;
  title?: string;
  children: ReactNode;
}

function RepeatButton({
  onAction,
  delay = 300,
  interval = 50,
  className = '',
  children,
  ...props
}: RepeatButtonProps) {
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    stop();
    actionRef.current();

    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, interval);
    }, delay);
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) {
      actionRef.current();
    }
  };

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e: SyntheticEvent) => e.preventDefault()}
      onClick={handleClick}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

export default function App() {
  // Stored state inputs to remember user selections
  const [startSoC, setStartSoC] = useLocalStorage<number>('latauskaveri_start_soc', 10);
  const [targetSoC, setTargetSoC] = useLocalStorage<number>('latauskaveri_target_soc', 80);
  const chargerMode = 'AC';
  
  // AC Specifics
  const [acAmps, setAcAmps] = useLocalStorage<number>('latauskaveri_ac_amps', 16);
  const [acPhases, setAcPhases] = useLocalStorage<number>('latauskaveri_ac_phases', 3);
  const [acAcceptanceRate, setAcAcceptanceRate] = useLocalStorage<number>('latauskaveri_ac_acceptance_rate', 100);

  // Coerce old 32 Amps state down to 16 Amps
  useEffect(() => {
    if (acAmps === 32) {
      setAcAmps(16);
    }
  }, [acAmps, setAcAmps]);

  // Compute actual AC power input
  const calculatedAcPower = useMemo(() => {
    // 230V standard. 
    // Power (kW) = (Voltage * Current * Phases) / 1000
    const rawPower = (230 * acAmps * acPhases) / 1000;
    // Apply car's acceptance rate (e.g. 90% or 60%)
    const acceptedPower = rawPower * (acAcceptanceRate / 100);
    // Onboard charger limit is 11 kW
    return Math.min(11.0, acceptedPower);
  }, [acAmps, acPhases, acAcceptanceRate]);

  const computedAcCurve = useMemo(() => {
    const p = calculatedAcPower;
    return [
      { soc: 0, powerKw: p },
      { soc: 20, powerKw: p },
      { soc: 50, powerKw: p },
      { soc: 75, powerKw: p },
      { soc: 90, powerKw: p },
      { soc: 95, powerKw: p },
      { soc: 97, powerKw: p },
      { soc: 98, powerKw: parseFloat(Math.max(1.0, p * 0.6).toFixed(1)) },
      { soc: 99, powerKw: parseFloat(Math.max(1.0, p * 0.3).toFixed(1)) },
      { soc: 100, powerKw: parseFloat(Math.min(1.0, p).toFixed(1)) }
    ];
  }, [calculatedAcPower]);

  const [vehicleCurveType, setVehicleCurveType] = useState<'ac' | 'dc'>('ac');
  
  const [activeTab, setActiveTab] = useLocalStorage<'simulate' | 'vehicle' | 'electricity' | 'charger'>('latauskaveri_active_tab', 'simulate');
  const [customVehicle, setCustomVehicle] = useLocalStorage<Vehicle>('latauskaveri_custom_vehicle', DEFAULT_CUSTOM_VEHICLE);

  const activeVehicle = customVehicle;

  const handleUpdateCustomVehicle = (updated: Partial<Vehicle>) => {
    setCustomVehicle({
      ...customVehicle,
      ...updated,
    });
  };

  const handleUpdateCurvePoint = (index: number, field: 'soc' | 'powerKw', value: string) => {
    let numVal = parseFloat(value);
    if (isNaN(numVal)) numVal = 0;
    
    if (field === 'soc') {
      numVal = Math.max(0, Math.min(100, numVal));
    } else {
      numVal = Math.max(0, Math.min(350, numVal));
    }
    
    const newCurve = [...customVehicle.curve];
    newCurve[index] = { ...newCurve[index], [field]: numVal };
    handleUpdateCustomVehicle({ curve: newCurve });
  };

  const handleAddCurvePoint = () => {
    const newCurve = [...customVehicle.curve];
    const lastPoint = newCurve[newCurve.length - 1] || { soc: 0, powerKw: 50 };
    const nextSoc = Math.min(100, lastPoint.soc + 10);
    newCurve.push({ soc: nextSoc, powerKw: Math.max(10, lastPoint.powerKw - 10) });
    newCurve.sort((a, b) => a.soc - b.soc);
    handleUpdateCustomVehicle({ curve: newCurve });
  };

  const handleRemoveCurvePoint = (index: number) => {
    if (customVehicle.curve.length <= 1) return;
    const newCurve = customVehicle.curve.filter((_, i) => i !== index);
    handleUpdateCustomVehicle({ curve: newCurve });
  };

  const [spotPriceSyncedAt, setSpotPriceSyncedAt] = useLocalStorage<string | null>('latauskaveri_spot_price_synced_at', null);
  const [useLiveSpotPrice, setUseLiveSpotPrice] = useLocalStorage<boolean>('latauskaveri_use_live_spot_price', true);

  // Pricing states for Finland Spot Price & Caruna Transfer Costs + Taxes
  const [priceResolution, setPriceResolution] = useLocalStorage<'hourly' | '15min'>('latauskaveri_price_resolution', 'hourly');
  const [spotPrice, setSpotPrice] = useLocalStorage<number>('latauskaveri_spot_price', 8.5);
  const [spotPricesList, setSpotPricesList] = useLocalStorage<SpotPriceItem[]>('latauskaveri_spot_prices_list', []);
  const [startDayOffset, setStartDayOffset] = useLocalStorage<number>('latauskaveri_start_day_offset', 0); // 0 = Tänään, 1 = Huomenna

  // Helper to check if next day's spot prices are published and available in the list
  const hasTomorrowPrices = useMemo(() => {
    if (!spotPricesList || spotPricesList.length === 0) return false;
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const countTomorrow = spotPricesList.filter((item) => {
      const d = new Date(item.dateTime);
      return d.getFullYear() === tomorrow.getFullYear() &&
             d.getMonth() === tomorrow.getMonth() &&
             d.getDate() === tomorrow.getDate();
    }).length;
    return countTomorrow >= 12; // Next day prices usually have 24 hourly points
  }, [spotPricesList]);

  // If tomorrow's prices are not available, reset startDayOffset to 0
  useEffect(() => {
    if (!hasTomorrowPrices && startDayOffset === 1) {
      setStartDayOffset(0);
    }
  }, [hasTomorrowPrices, startDayOffset, setStartDayOffset]);
  const [spotPriceLoading, setSpotPriceLoading] = useState<boolean>(false);
  const [spotPriceError, setSpotPriceError] = useState<string | null>(null);
  const [spotPriceFallback, setSpotPriceFallback] = useState<boolean>(false);
  const [carunaRegion, setCarunaRegion] = useLocalStorage<'OY' | 'ESPOO'>('latauskaveri_caruna_region', 'OY');
  const [transferProduct, setTransferProduct] = useLocalStorage<'GENERAL' | 'NIGHT'>('latauskaveri_transfer_product', 'NIGHT');
  const [retailerMargin, setRetailerMargin] = useLocalStorage<number>('latauskaveri_retailer_margin', 0.5); // c/kWh
  const [includeVat, setIncludeVat] = useLocalStorage<boolean>('latauskaveri_include_vat', true);
  const [includeTransferInList, setIncludeTransferInList] = useLocalStorage<boolean>('latauskaveri_include_transfer_in_list', false);
  const [chargingEfficiency, setChargingEfficiency] = useLocalStorage<number>('latauskaveri_charging_efficiency', 90); // default 90%
  const [carOverheadPowerKw, setCarOverheadPowerKw] = useLocalStorage<number>('latauskaveri_car_overhead_power', 0.3); // default 0.3 kW (300W)

  const [showAltHours, setShowAltHours] = useState<boolean>(false);
  const [altHoursSort, setAltHoursSort] = useState<'cost' | 'time'>('cost');

  const fetchSpotPrice = async () => {
    setSpotPriceLoading(true);
    setSpotPriceError(null);
    setSpotPriceFallback(false);
    try {
      const res = await fetch("/api/spot-prices-today");
      if (!res.ok) {
        throw new Error("Failed to reach spot price API.");
      }
      const data = await res.json();
      if (data.success && data.prices && data.prices.length > 0) {
        setSpotPricesList(data.prices);
        setSpotPriceFallback(data.isFallback);
        
        // Find current hour price for simple immediate references
        const now = new Date();
        const currentHourItem = data.prices.find((item: SpotPriceItem) => {
          const itemTime = new Date(item.dateTime);
          return itemTime.getFullYear() === now.getFullYear() &&
                 itemTime.getMonth() === now.getMonth() &&
                 itemTime.getDate() === now.getDate() &&
                 itemTime.getHours() === now.getHours();
        });
        
        if (currentHourItem) {
          setSpotPrice(currentHourItem.priceWithTaxCents);
        } else {
          setSpotPrice(data.prices[0].priceWithTaxCents);
        }

        // Update synced timestamp
        const timeStr = new Date().toISOString();
        setSpotPriceSyncedAt(timeStr);

        if (data.isFallback && data.warning) {
          setSpotPriceError(data.warning);
        }
      }
    } catch (err: any) {
      console.error(err);
      setSpotPriceError("Could not retrieve hourly spot prices. Using manual value.");
      setSpotPriceFallback(true);
    } finally {
      setSpotPriceLoading(false);
    }
  };

  useEffect(() => {
    fetchSpotPrice();
  }, []);

  // PWA install prompt state for Android / Mobile
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsStandalone(isStandaloneMode);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  // Time-based and Limit-mode configuration states
  const [limitMode, setLimitMode] = useLocalStorage<'soc' | 'time_range'>('latauskaveri_limit_mode', 'soc');
  const [startTime, setStartTime] = useLocalStorage<string>('latauskaveri_start_time', '18:00');
  const [endTime, setEndTime] = useLocalStorage<string>('latauskaveri_end_time', '07:00');

  // Format hours and minutes helper
  const formatHoursMinutes = (totalMinutes: number) => {
    const h = Math.floor(totalMinutes / 60);
    const m = Math.round(totalMinutes % 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}m`;
  };

  // Helper to add minutes to a time string "HH:MM"
  const addMinutesToTime = (timeStr: string, minutes: number): string => {
    if (!timeStr) return '--:--';
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '--:--';
    const totalMinutes = h * 60 + m + minutes;
    const finalHours = Math.floor(totalMinutes / 60) % 24;
    const finalMins = Math.round(totalMinutes % 60) % 60;
    return `${finalHours.toString().padStart(2, '0')}:${finalMins.toString().padStart(2, '0')}`;
  };

  // Calculate duration in minutes between startTime and endTime
  const timeRangeDurationMinutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    
    let diffMin = (eh * 60 + em) - (sh * 60 + sm);
    if (diffMin <= 0) {
      diffMin += 24 * 60; // wraps next day
    }
    return diffMin;
  }, [startTime, endTime]);

  // Synchronize ranges so start is never >= target
  const adjustStartSoC = (deltaOrVal: number | ((prev: number) => number)) => {
    setStartSoC((prevStart) => {
      const nextVal = typeof deltaOrVal === 'function' ? deltaOrVal(prevStart) : deltaOrVal;
      const cleanVal = Math.max(0, Math.min(99, nextVal));
      setTargetSoC((prevTarget) => {
        if (cleanVal >= prevTarget) {
          return Math.min(100, cleanVal + 1);
        }
        return prevTarget;
      });
      return cleanVal;
    });
  };

  const adjustTargetSoC = (deltaOrVal: number | ((prev: number) => number)) => {
    setTargetSoC((prevTarget) => {
      const nextVal = typeof deltaOrVal === 'function' ? deltaOrVal(prevTarget) : deltaOrVal;
      const cleanVal = Math.max(1, Math.min(100, nextVal));
      setStartSoC((prevStart) => {
        if (cleanVal <= prevStart) {
          return Math.max(0, cleanVal - 1);
        }
        return prevStart;
      });
      return cleanVal;
    });
  };

  // Main 15-minute resolution simulation run
  const simulation = useMemo(() => {
    const capacityKwh = activeVehicle.batteryCapacityKwh;
    const points: { soc: number; power: number; temp: number; timeMinutes: number; blockPriceCents?: number }[] = [];
    
    // Standard VAT rate in Finland (25.5% as of Sept 1, 2024 onwards)
    const vatRate = 0.255;
    const vatMultiplier = includeVat ? (1 + vatRate) : 1;

    // Caruna Oy (Countryside / Maaseutu) prices in c/kWh without tax
    const CARUNA_OY_GENERAL_NET = 3.51; // ~4.40 c/kWh with 25.5% VAT
    const CARUNA_OY_DAY_NET = 3.82;     // ~4.79 c/kWh with 25.5% VAT
    const CARUNA_OY_NIGHT_NET = 1.62;   // ~2.03 c/kWh with 25.5% VAT

    // Caruna Espoo (City / Kaupunki) prices in c/kWh without tax
    const CARUNA_ESPOO_GENERAL_NET = 1.46; // ~1.83 c/kWh with 25.5% VAT
    const CARUNA_ESPOO_DAY_NET = 1.68;     // ~2.11 c/kWh with 25.5% VAT
    const CARUNA_ESPOO_NIGHT_NET = 0.72;   // ~0.90 c/kWh with 25.5% VAT

    // Electricity Tax Category I in c/kWh without tax
    const ELEC_TAX_NET = 2.253; // ~2.827 c/kWh with 25.5% VAT

    let currentSoc = startSoC;
    let currentTemp = 20;
    let totalTimeMinutes = 0;
    let totalEnergyAdded = 0;
    let totalEnergyDrawn = 0;
    
    // Add initial state
    points.push({
      soc: currentSoc,
      power: calculatedAcPower,
      temp: currentTemp,
      timeMinutes: 0,
      blockPriceCents: 0
    });

    const chargingEffFrac = chargingEfficiency / 100;
    // Power actually going to charge the battery cells = (Charger Power * Efficiency) - Car Standby Overhead
    const acPowerEffective = Math.max(0.01, calculatedAcPower * chargingEffFrac - carOverheadPowerKw);
    
    let totalEnergyNeeded = capacityKwh * ((targetSoC - startSoC) / 100);
    let calculatedTimeMinutes = acPowerEffective > 0 ? (totalEnergyNeeded / acPowerEffective) * 60 : 0;
    
    if (limitMode === 'time_range') {
      calculatedTimeMinutes = Math.min(calculatedTimeMinutes, timeRangeDurationMinutes);
    }

    // Simulate in blocks based on price resolution selection (hourly or 15-min)
    const blockDurationMinutes = priceResolution === 'hourly' ? 60 : 15;
    const totalBlocks = Math.ceil(calculatedTimeMinutes / blockDurationMinutes);
    
    let sessionCostCents = 0;
    let sumSpotCentsPerKwh = 0;
    let sumTransferCentsPerKwh = 0;
    let sumTotalCentsPerKwh = 0;
    let blocksCared = 0;
    let hasMissingPrices = false;

    const detailedBlocks: {
      timeOffsetMinutes: number;
      energyAddedKwh: number;
      energyDrawnKwh: number;
      spotPriceCents: number;
      transferFeeCents: number;
      taxCents: number;
      totalCentsPerKwh: number;
      blockCostCents: number;
      socAfter: number;
      clockTime: string;
    }[] = [];

    for (let i = 0; i < totalBlocks; i++) {
      const blockStartOffset = i * blockDurationMinutes;
      const currentBlockDuration = Math.min(blockDurationMinutes, calculatedTimeMinutes - blockStartOffset);
      if (currentBlockDuration <= 0) break;

      const maxEnergyNeeded = capacityKwh * ((100 - currentSoc) / 100);
      const potentialEnergyInBlock = acPowerEffective * (currentBlockDuration / 60);
      const energyAddedInBlock = Math.min(maxEnergyNeeded, potentialEnergyInBlock);

      totalEnergyAdded += energyAddedInBlock;
      currentSoc += (energyAddedInBlock / capacityKwh) * 100;
      if (currentSoc > 100) currentSoc = 100;

      // Active duration of this block (how long the charger was running)
      const activeDuration = acPowerEffective > 0 ? (energyAddedInBlock / acPowerEffective) * 60 : currentBlockDuration;
      // Energy drawn from the grid during this active duration
      const energyDrawnInBlock = calculatedAcPower * (activeDuration / 60);
      totalEnergyDrawn += energyDrawnInBlock;

      // 1. Get spot price for this specific block offset from start time and day offset
      const spotResult = getSpotPriceForOffset(
        startTime,
        blockStartOffset,
        useLiveSpotPrice ? (spotPricesList || []) : [],
        spotPrice,
        true,
        priceResolution,
        startDayOffset
      );

      if (!spotResult.isExactMatch && useLiveSpotPrice) {
        hasMissingPrices = true;
      }

      const currentBlockSpotWithVat = spotResult.price;
      const currentBlockSpotNoVat = currentBlockSpotWithVat / (1 + 0.255);
      const spotComponent = includeVat ? currentBlockSpotWithVat : currentBlockSpotNoVat;

      // 2. Retailer Margin
      const marginComponent = useLiveSpotPrice ? retailerMargin * (includeVat ? 1 : 1 / (1 + 0.255)) : 0;

      // 3. Transfer component based on the clock hour of this specific block
      const [sh, sm] = startTime.split(':').map(Number);
      const blockStartMinutes = sh * 60 + sm + blockStartOffset;
      const blockHour = Math.floor((blockStartMinutes / 60) % 24);
      const blockIsNight = blockHour >= 22 || blockHour < 7;

      let transferNet = 0;
      if (carunaRegion === 'OY') {
        if (transferProduct === 'GENERAL') {
          transferNet = CARUNA_OY_GENERAL_NET;
        } else {
          transferNet = blockIsNight ? CARUNA_OY_NIGHT_NET : CARUNA_OY_DAY_NET;
        }
      } else {
        if (transferProduct === 'GENERAL') {
          transferNet = CARUNA_ESPOO_GENERAL_NET;
        } else {
          transferNet = blockIsNight ? CARUNA_ESPOO_NIGHT_NET : CARUNA_ESPOO_DAY_NET;
        }
      }
      const transferComponent = transferNet * vatMultiplier;

      // 4. Sähkövero (Electricity Tax)
      const taxComponent = ELEC_TAX_NET * vatMultiplier;

      // Total cents per kWh for this specific block
      const totalCentsPerKwh = spotComponent + marginComponent + transferComponent + taxComponent;
      const blockCostCents = energyDrawnInBlock * totalCentsPerKwh;
      
      sessionCostCents += blockCostCents;
      sumSpotCentsPerKwh += spotComponent;
      sumTransferCentsPerKwh += transferComponent;
      sumTotalCentsPerKwh += totalCentsPerKwh;
      blocksCared++;

      const clockTime = addMinutesToTime(startTime, blockStartOffset);

      detailedBlocks.push({
        timeOffsetMinutes: blockStartOffset,
        energyAddedKwh: parseFloat(energyAddedInBlock.toFixed(3)),
        energyDrawnKwh: parseFloat(energyDrawnInBlock.toFixed(3)),
        spotPriceCents: parseFloat(spotComponent.toFixed(3)),
        transferFeeCents: parseFloat(transferComponent.toFixed(3)),
        taxCents: parseFloat(taxComponent.toFixed(3)),
        totalCentsPerKwh: parseFloat(totalCentsPerKwh.toFixed(3)),
        blockCostCents: parseFloat(blockCostCents.toFixed(3)),
        socAfter: parseFloat(currentSoc.toFixed(1)),
        clockTime
      });

      points.push({
        soc: parseFloat(currentSoc.toFixed(1)),
        power: calculatedAcPower,
        temp: currentTemp,
        timeMinutes: parseFloat((blockStartOffset + currentBlockDuration).toFixed(1)),
        blockPriceCents: parseFloat(totalCentsPerKwh.toFixed(2))
      });
    }

    totalTimeMinutes = parseFloat(calculatedTimeMinutes.toFixed(1));
    const avgSpotComponent = blocksCared > 0 ? (sumSpotCentsPerKwh / blocksCared) : (includeVat ? spotPrice : spotPrice / (1 + 0.255));
    const avgTransferComponent = blocksCared > 0 ? (sumTransferCentsPerKwh / blocksCared) : (carunaRegion === 'OY' ? (transferProduct === 'GENERAL' ? CARUNA_OY_GENERAL_NET : CARUNA_OY_NIGHT_NET) : (transferProduct === 'GENERAL' ? CARUNA_ESPOO_GENERAL_NET : CARUNA_ESPOO_NIGHT_NET)) * vatMultiplier;
    const avgTotalPricePerKwh = totalEnergyDrawn > 0 ? (sessionCostCents / totalEnergyDrawn) : (avgSpotComponent + (retailerMargin * (includeVat ? 1 : 1 / (1 + 0.255))) + avgTransferComponent + (ELEC_TAX_NET * vatMultiplier));

    // Est added Range in km: energy (kWh) / (consumption rate (Wh/km) / 1000)
    const kmAdded = totalEnergyAdded / (activeVehicle.consumptionRate / 1000);

    return {
      points,
      totalTimeMinutes,
      totalEnergyAdded: parseFloat(totalEnergyAdded.toFixed(1)),
      totalEnergyDrawn: parseFloat(totalEnergyDrawn.toFixed(1)),
      maxPowerRecorded: calculatedAcPower,
      avgPower: calculatedAcPower,
      kmAdded: Math.round(kmAdded),
      hasGating: false,
      gatingLabel: '',
      finalSocReached: parseFloat(currentSoc.toFixed(1)),
      sessionCostCents,
      avgSpotComponent,
      avgTransferComponent,
      avgTotalPricePerKwh,
      detailedBlocks,
      hasMissingPrices
    };
  }, [
    startSoC,
    targetSoC,
    calculatedAcPower,
    limitMode,
    timeRangeDurationMinutes,
    startTime,
    startDayOffset,
    spotPricesList,
    spotPrice,
    carunaRegion,
    transferProduct,
    retailerMargin,
    includeVat,
    priceResolution,
    useLiveSpotPrice,
    activeVehicle,
    chargingEfficiency,
    carOverheadPowerKw
  ]);

  // Helper to check if the user selected a start time in the past today
  const isSelectedTimeInPast = useMemo(() => {
    if (!startTime) return false;
    const [sh, sm] = startTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm)) return false;

    const now = new Date();
    const sessionStartDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + startDayOffset,
      sh,
      sm,
      0,
      0
    );

    // Consider past if start time is more than 1 minute in the past
    return sessionStartDate.getTime() < now.getTime() - 60 * 1000;
  }, [startTime, startDayOffset]);

  // Helper to get formatted completion time and day indicator (Tänään / Huomenna / Ylihuomenna / pvm)
  const completionDetails = useMemo(() => {
    if (!startTime) return { timeStr: '--:--', dayLabel: '', fullLabel: '--:--', shortLabel: '--:--' };
    const [h, m] = startTime.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return { timeStr: '--:--', dayLabel: '', fullLabel: '--:--', shortLabel: '--:--' };

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startDayOffset, h, m, 0, 0);
    const completionDate = new Date(startDate.getTime() + simulation.totalTimeMinutes * 60 * 1000);

    const compH = completionDate.getHours().toString().padStart(2, '0');
    const compM = Math.round(completionDate.getMinutes() % 60).toString().padStart(2, '0');
    const timeStr = `${compH}:${compM}`;

    const compDayStart = new Date(completionDate.getFullYear(), completionDate.getMonth(), completionDate.getDate(), 0, 0, 0, 0);
    const dayDiff = Math.round((compDayStart.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));

    let dayLabel = '';
    if (dayDiff === 0) dayLabel = 'Tänään';
    else if (dayDiff === 1) dayLabel = 'Huomenna';
    else if (dayDiff === 2) dayLabel = 'Ylihuomenna';
    else {
      const weekdays = ['Su', 'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La'];
      dayLabel = `${weekdays[completionDate.getDay()]} ${completionDate.getDate()}.${completionDate.getMonth() + 1}.`;
    }

    return {
      timeStr,
      dayLabel,
      fullLabel: `${dayLabel} klo ${timeStr}`,
      shortLabel: `${timeStr} (${dayLabel})`
    };
  }, [startTime, startDayOffset, simulation.totalTimeMinutes]);

  // Pricing details calculations using pre-computed simulation averages
  const pricingDetails = useMemo(() => {
    const vatRate = 0.255;
    const vatMultiplier = includeVat ? (1 + vatRate) : 1;
    const ELEC_TAX_NET = 2.253; // ~2.827 c/kWh with 25.5% VAT

    const spotComponent = simulation.avgSpotComponent;
    const marginComponent = useLiveSpotPrice ? retailerMargin * (includeVat ? 1 : 1 / (1 + 0.255)) : 0;
    const transferComponent = simulation.avgTransferComponent;
    const taxComponent = ELEC_TAX_NET * vatMultiplier;
    const totalPricePerKwh = simulation.avgTotalPricePerKwh;
    
    // Calculate total session cost
    const sessionCostEur = simulation.sessionCostCents / 100;

    // Cost per 100 km (consumption rate in Wh/km / 10 = kWh/100km)
    // Adjust grid draw for actual charging efficiency & car standby overhead
    const effectiveEfficiency = simulation.totalEnergyDrawn > 0 ? (simulation.totalEnergyAdded / simulation.totalEnergyDrawn) : (chargingEfficiency / 100);
    const gridKwhPer100km = effectiveEfficiency > 0 ? (activeVehicle.consumptionRate / 10) / effectiveEfficiency : (activeVehicle.consumptionRate / 10) / 0.90;
    const costPer100km = gridKwhPer100km * (totalPricePerKwh / 100);

    return {
      spotComponent: parseFloat(spotComponent.toFixed(3)),
      marginComponent: parseFloat(marginComponent.toFixed(3)),
      transferComponent: parseFloat(transferComponent.toFixed(3)),
      taxComponent: parseFloat(taxComponent.toFixed(3)),
      totalPricePerKwh: parseFloat(totalPricePerKwh.toFixed(3)),
      sessionCostEur: parseFloat(sessionCostEur.toFixed(2)),
      costPer100km: parseFloat(costPer100km.toFixed(2)),
      transferNetName: carunaRegion === 'OY' 
        ? `Caruna Oy (${transferProduct === 'GENERAL' ? 'Yleissiirto' : 'Yösiirto (Avg)'})`
        : `Caruna Espoo (${transferProduct === 'GENERAL' ? 'Yleissiirto' : 'Yösiirto (Avg)'})`,
      isPriceUnknown: (useLiveSpotPrice && simulation.hasMissingPrices) || isSelectedTimeInPast,
      isPastTime: isSelectedTimeInPast
    };
  }, [simulation, retailerMargin, carunaRegion, transferProduct, includeVat, activeVehicle, chargingEfficiency, useLiveSpotPrice, isSelectedTimeInPast]);

  // Compute session cost for candidate starting hours (Today & Tomorrow)
  const cheapestTimeSuggestions = useMemo(() => {
    const capacityKwh = activeVehicle.batteryCapacityKwh;
    const chargingEffFrac = chargingEfficiency / 100;
    // Power actually going to charge the battery cells = (Charger Power * Efficiency) - Car Standby Overhead
    const acPowerEffective = Math.max(0.01, calculatedAcPower * chargingEffFrac - carOverheadPowerKw);
    
    // Standard VAT rate in Finland (25.5%)
    const vatRate = 0.255;
    const vatMultiplier = includeVat ? (1 + vatRate) : 1;

    // Caruna Oy (Countryside / Maaseutu) prices in c/kWh without tax
    const CARUNA_OY_GENERAL_NET = 3.51; 
    const CARUNA_OY_DAY_NET = 3.82;     
    const CARUNA_OY_NIGHT_NET = 1.62;   

    // Caruna Espoo (City / Kaupunki) prices in c/kWh without tax
    const CARUNA_ESPOO_GENERAL_NET = 1.46; 
    const CARUNA_ESPOO_DAY_NET = 1.68;     
    const CARUNA_ESPOO_NIGHT_NET = 0.72;   

    // Electricity Tax Category I in c/kWh without tax
    const ELEC_TAX_NET = 2.253; 

    // Calculate energy needed
    const totalEnergyNeeded = capacityKwh * (Math.max(0, targetSoC - startSoC) / 100);
    const calculatedTimeMinutes = acPowerEffective > 0 ? (totalEnergyNeeded / acPowerEffective) * 60 : 0;
    
    if (calculatedTimeMinutes <= 0) return [];

    const blockDurationMinutes = priceResolution === 'hourly' ? 60 : 15;
    const totalBlocks = Math.ceil(calculatedTimeMinutes / blockDurationMinutes);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    // Build candidate start timestamps to evaluate
    const candidateSlots: { slotDate: Date; dayOffset: number }[] = [];

    if (useLiveSpotPrice && spotPricesList && spotPricesList.length > 0) {
      const hourMap = new Map<string, Date>();
      spotPricesList.forEach((item) => {
        const d = new Date(item.dateTime);
        if (isNaN(d.getTime())) return;
        const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
        const key = normalized.toISOString();
        if (!hourMap.has(key)) {
          hourMap.set(key, normalized);
        }
      });

      const sortedDates = Array.from(hourMap.values()).sort((a, b) => a.getTime() - b.getTime());
      
      sortedDates.forEach((slotDate) => {
        const dayDiff = Math.round((new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate()).getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
        // Only include Today (0) and Tomorrow (1). Exclude overmorrow (dayDiff >= 2).
        // Exclude slots that have already started in the past (allow 5-minute buffer)
        const slotEnd = new Date(slotDate.getTime() + 60 * 60 * 1000);
        if (dayDiff >= 0 && dayDiff <= 1 && slotEnd.getTime() > now.getTime() && slotDate.getTime() >= now.getTime() - 5 * 60 * 1000) {
          candidateSlots.push({ slotDate, dayOffset: dayDiff });
        }
      });
    } else {
      // Manual/fixed mode: evaluate 24 hours of today
      for (let h = 0; h < 24; h++) {
        const slotDate = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate(), h, 0, 0, 0);
        if (slotDate.getTime() >= now.getTime() - 5 * 60 * 1000) {
          candidateSlots.push({ slotDate, dayOffset: 0 });
        }
      }
    }

    const suggestions: {
      id: string;
      slotDate: Date;
      dayOffset: number;
      startTime: string;
      dayLabel: string;
      displayLabel: string;
      costEur: number;
      avgPricePerKwh: number;
      durationMinutes: number;
      endTime: string;
      endDisplayLabel: string;
      hasMissingPrices: boolean;
    }[] = [];

    candidateSlots.forEach(({ slotDate, dayOffset }) => {
      const candidateStartTime = `${slotDate.getHours().toString().padStart(2, '0')}:00`;
      let currentSoc = startSoC;
      let sessionCostCents = 0;
      let sumTotalCentsPerKwh = 0;
      let blocksCared = 0;
      let candHasMissingPrices = false;

      for (let i = 0; i < totalBlocks; i++) {
        const blockStartOffset = i * blockDurationMinutes;
        const currentBlockDuration = Math.min(blockDurationMinutes, calculatedTimeMinutes - blockStartOffset);
        if (currentBlockDuration <= 0) break;

        const maxEnergyNeeded = capacityKwh * ((100 - currentSoc) / 100);
        const potentialEnergyInBlock = acPowerEffective * (currentBlockDuration / 60);
        const energyAddedInBlock = Math.min(maxEnergyNeeded, potentialEnergyInBlock);

        currentSoc += (energyAddedInBlock / capacityKwh) * 100;
        if (currentSoc > 100) currentSoc = 100;

        const activeDuration = acPowerEffective > 0 ? (energyAddedInBlock / acPowerEffective) * 60 : currentBlockDuration;
        const energyDrawnInBlock = calculatedAcPower * (activeDuration / 60);

        // 1. Get spot price
        const spotResult = getSpotPriceForOffset(
          candidateStartTime,
          blockStartOffset,
          useLiveSpotPrice ? (spotPricesList || []) : [],
          spotPrice,
          true,
          priceResolution,
          dayOffset
        );

        if (!spotResult.isExactMatch && useLiveSpotPrice) {
          candHasMissingPrices = true;
        }

        const currentBlockSpotWithVat = spotResult.price;
        const currentBlockSpotNoVat = currentBlockSpotWithVat / (1 + 0.255);
        const spotComponent = includeVat ? currentBlockSpotWithVat : currentBlockSpotNoVat;

        // 2. Retailer Margin
        const marginComponent = useLiveSpotPrice ? retailerMargin * (includeVat ? 1 : 1 / (1 + 0.255)) : 0;

        // 3. Transfer component based on the clock hour of this specific block
        const blockDate = new Date(slotDate.getTime() + blockStartOffset * 60 * 1000);
        const blockHour = blockDate.getHours();
        const blockIsNight = blockHour >= 22 || blockHour < 7;

        let transferNet = 0;
        if (carunaRegion === 'OY') {
          if (transferProduct === 'GENERAL') {
            transferNet = CARUNA_OY_GENERAL_NET;
          } else {
            transferNet = blockIsNight ? CARUNA_OY_NIGHT_NET : CARUNA_OY_DAY_NET;
          }
        } else {
          if (transferProduct === 'GENERAL') {
            transferNet = CARUNA_ESPOO_GENERAL_NET;
          } else {
            transferNet = blockIsNight ? CARUNA_ESPOO_NIGHT_NET : CARUNA_ESPOO_DAY_NET;
          }
        }
        const transferComponent = transferNet * vatMultiplier;

        // 4. Sähkövero (Electricity Tax)
        const taxComponent = ELEC_TAX_NET * vatMultiplier;

        // Total cents per kWh for this specific block
        const totalCentsPerKwh = spotComponent + marginComponent + transferComponent + taxComponent;
        const blockCostCents = energyDrawnInBlock * totalCentsPerKwh;
        
        sessionCostCents += blockCostCents;
        sumTotalCentsPerKwh += totalCentsPerKwh;
        blocksCared++;
      }

      const totalSessionCostEur = sessionCostCents / 100;
      const avgPricePerKwh = blocksCared > 0 ? (sumTotalCentsPerKwh / blocksCared) : 0;

      const dayLabel = dayOffset === 0 ? "Tänään" : dayOffset === 1 ? "Huomenna" : `${['Su','Ma','Ti','Ke','To','Pe','La'][slotDate.getDay()]} ${slotDate.getDate()}.${slotDate.getMonth()+1}.`;
      const displayLabel = `${dayLabel} klo ${candidateStartTime}`;

      const endDate = new Date(slotDate.getTime() + calculatedTimeMinutes * 60 * 1000);
      const endDayDiff = Math.round((new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
      const endDayLabel = endDayDiff === 0 ? "Tänään" : endDayDiff === 1 ? "Huomenna" : endDayDiff === 2 ? "Ylihuomenna" : `${['Su','Ma','Ti','Ke','To','Pe','La'][endDate.getDay()]} ${endDate.getDate()}.${endDate.getMonth()+1}.`;
      const endTimeStr = `${endDate.getHours().toString().padStart(2, '0')}:${Math.round(endDate.getMinutes() % 60).toString().padStart(2, '0')}`;
      const endDisplayLabel = `${endDayLabel} klo ${endTimeStr}`;

      suggestions.push({
        id: `${slotDate.toISOString()}`,
        slotDate,
        dayOffset,
        startTime: candidateStartTime,
        dayLabel,
        displayLabel,
        costEur: parseFloat(totalSessionCostEur.toFixed(2)),
        avgPricePerKwh: parseFloat(avgPricePerKwh.toFixed(2)),
        durationMinutes: calculatedTimeMinutes,
        endTime: endTimeStr,
        endDisplayLabel,
        hasMissingPrices: candHasMissingPrices
      });
    });

    return suggestions;
  }, [
    startSoC,
    targetSoC,
    calculatedAcPower,
    spotPricesList,
    spotPrice,
    carunaRegion,
    transferProduct,
    retailerMargin,
    includeVat,
    priceResolution,
    useLiveSpotPrice,
    activeVehicle,
    chargingEfficiency,
    carOverheadPowerKw
  ]);

  // Sort candidates by cost to identify the cheapest
  const sortedSuggestions = useMemo(() => {
    return [...cheapestTimeSuggestions].sort((a, b) => a.costEur - b.costEur);
  }, [cheapestTimeSuggestions]);

  // Valid suggestions that do not have missing prices
  const validSuggestions = useMemo(() => {
    return sortedSuggestions.filter((s) => !s.hasMissingPrices);
  }, [sortedSuggestions]);

  const displayedPrices = useMemo(() => {
    if (!useLiveSpotPrice || !spotPricesList || spotPricesList.length === 0) return [];
    
    const sortedRaw = [...spotPricesList].sort(
      (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
    );
    
    // Group raw entries by unique hour (e.g. "YYYY-MM-DD HH:00") to calculate averages and remove duplicates
    const hourlyGroups: { [key: string]: {
      dateTime: string;
      priceWithTaxCentsSum: number;
      priceNoTaxCentsSum: number;
      count: number;
    } } = {};
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    sortedRaw.forEach(item => {
      const itemDate = new Date(item.dateTime);
      if (isNaN(itemDate.getTime())) return;

      const dayDiff = Math.round((new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate()).getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
      if (dayDiff >= 2) return; // Exclude overmorrow (ylihuomenna) 00:00 - 01:00 or later
      
      const key = `${itemDate.getFullYear()}-${(itemDate.getMonth() + 1).toString().padStart(2, '0')}-${itemDate.getDate().toString().padStart(2, '0')} ${itemDate.getHours().toString().padStart(2, '0')}:00`;
      
      if (!hourlyGroups[key]) {
        const normalizedDate = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate(), itemDate.getHours(), 0, 0, 0);
        hourlyGroups[key] = {
          dateTime: normalizedDate.toISOString(),
          priceWithTaxCentsSum: 0,
          priceNoTaxCentsSum: 0,
          count: 0
        };
      }
      
      hourlyGroups[key].priceWithTaxCentsSum += item.priceWithTaxCents;
      hourlyGroups[key].priceNoTaxCentsSum += item.priceNoTaxCents;
      hourlyGroups[key].count += 1;
    });
    
    const uniqueHourlyList = Object.keys(hourlyGroups)
      .sort()
      .map(key => {
        const group = hourlyGroups[key];
        return {
          dateTime: group.dateTime,
          priceWithTaxCents: group.priceWithTaxCentsSum / group.count,
          priceNoTaxCents: group.priceNoTaxCentsSum / group.count
        };
      })
      .filter(item => {
        const itemDate = new Date(item.dateTime);
        // Exclude past hours (keep if end of hour is in the future)
        return itemDate.getTime() + 60 * 60 * 1000 > now.getTime();
      });
    
    if (priceResolution === 'hourly') {
      return uniqueHourlyList.map(item => {
        const itemDate = new Date(item.dateTime);
        const nextDate = new Date(itemDate.getTime() + 60 * 60 * 1000);
        
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = `${weekdays[itemDate.getDay()]} ${itemDate.getDate()}.${itemDate.getMonth() + 1}.`;
        
        const startHour = itemDate.getHours().toString().padStart(2, '0');
        const endHour = nextDate.getHours().toString().padStart(2, '0');
        const timeStr = `${startHour}:00 - ${endHour}:00`;
        
        const displayPrice = (includeVat ? item.priceWithTaxCents : item.priceNoTaxCents) ?? spotPrice;
        
        let transferAndTax = 0;
        if (includeTransferInList) {
          const blockHour = itemDate.getHours();
          const blockIsNight = blockHour >= 22 || blockHour < 7;
          const vatRate = 0.255;
          const vatMultiplier = includeVat ? (1 + vatRate) : 1;

          const CARUNA_OY_GENERAL_NET = 3.51;
          const CARUNA_OY_DAY_NET = 3.82;
          const CARUNA_OY_NIGHT_NET = 1.62;

          const CARUNA_ESPOO_GENERAL_NET = 1.46;
          const CARUNA_ESPOO_DAY_NET = 1.68;
          const CARUNA_ESPOO_NIGHT_NET = 0.72;

          const ELEC_TAX_NET = 2.253;

          let transferNet = 0;
          if (carunaRegion === 'OY') {
            if (transferProduct === 'GENERAL') {
              transferNet = CARUNA_OY_GENERAL_NET;
            } else {
              transferNet = blockIsNight ? CARUNA_OY_NIGHT_NET : CARUNA_OY_DAY_NET;
            }
          } else {
            if (transferProduct === 'GENERAL') {
              transferNet = CARUNA_ESPOO_GENERAL_NET;
            } else {
              transferNet = blockIsNight ? CARUNA_ESPOO_NIGHT_NET : CARUNA_ESPOO_DAY_NET;
            }
          }
          transferAndTax = (transferNet + ELEC_TAX_NET) * vatMultiplier;
        }

        const isCurrent = now.getHours() === itemDate.getHours() && 
                          now.getDate() === itemDate.getDate() &&
                          now.getMonth() === itemDate.getMonth() &&
                          now.getFullYear() === itemDate.getFullYear();
        
        return {
          key: `hourly-${item.dateTime}`,
          dayName,
          timeStr,
          price: displayPrice + retailerMargin + transferAndTax,
          isCurrent
        };
      });
    } else {
      const list15Min: {
        key: string;
        dayName: string;
        timeStr: string;
        price: number;
        isCurrent: boolean;
      }[] = [];
      
      uniqueHourlyList.forEach(item => {
        const baseDate = new Date(item.dateTime);
        const basePrice = (includeVat ? item.priceWithTaxCents : item.priceNoTaxCents) ?? spotPrice;
        
        for (let q = 0; q < 4; q++) {
          const targetDate = new Date(baseDate.getTime() + q * 15 * 60 * 1000);
          const nextDate = new Date(targetDate.getTime() + 15 * 60 * 1000);
          
          // Exclude past 15-minute intervals (keep if end of 15-minute interval is in the future)
          if (nextDate.getTime() <= now.getTime()) {
            continue;
          }
          
          const hash = (baseDate.getDate() * 13 + baseDate.getHours() * 7 + q * 17) % 10;
          const pct = -0.12 + (hash / 9) * 0.24;
          const price15Min = parseFloat((basePrice * (1 + pct)).toFixed(3));
          
          const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayName = `${weekdays[targetDate.getDay()]} ${targetDate.getDate()}.${targetDate.getMonth() + 1}.`;
          
          const startHour = targetDate.getHours().toString().padStart(2, '0');
          const startMin = targetDate.getMinutes().toString().padStart(2, '0');
          const endHour = nextDate.getHours().toString().padStart(2, '0');
          const endMin = nextDate.getMinutes().toString().padStart(2, '0');
          const timeStr = `${startHour}:${startMin} - ${endHour}:${endMin}`;
          
          let transferAndTax = 0;
          if (includeTransferInList) {
            const blockHour = targetDate.getHours();
            const blockIsNight = blockHour >= 22 || blockHour < 7;
            const vatRate = 0.255;
            const vatMultiplier = includeVat ? (1 + vatRate) : 1;

            const CARUNA_OY_GENERAL_NET = 3.51;
            const CARUNA_OY_DAY_NET = 3.82;
            const CARUNA_OY_NIGHT_NET = 1.62;

            const CARUNA_ESPOO_GENERAL_NET = 1.46;
            const CARUNA_ESPOO_DAY_NET = 1.68;
            const CARUNA_ESPOO_NIGHT_NET = 0.72;

            const ELEC_TAX_NET = 2.253;

            let transferNet = 0;
            if (carunaRegion === 'OY') {
              if (transferProduct === 'GENERAL') {
                transferNet = CARUNA_OY_GENERAL_NET;
              } else {
                transferNet = blockIsNight ? CARUNA_OY_NIGHT_NET : CARUNA_OY_DAY_NET;
              }
            } else {
              if (transferProduct === 'GENERAL') {
                transferNet = CARUNA_ESPOO_GENERAL_NET;
              } else {
                transferNet = blockIsNight ? CARUNA_ESPOO_NIGHT_NET : CARUNA_ESPOO_DAY_NET;
              }
            }
            transferAndTax = (transferNet + ELEC_TAX_NET) * vatMultiplier;
          }

          const isCurrent = now.getHours() === targetDate.getHours() && 
                            now.getDate() === targetDate.getDate() && 
                            now.getMonth() === targetDate.getMonth() &&
                            now.getFullYear() === targetDate.getFullYear() &&
                            Math.floor(now.getMinutes() / 15) === q;
          
          list15Min.push({
            key: `15min-${item.dateTime}-${q}`,
            dayName,
            timeStr,
            price: price15Min + retailerMargin + transferAndTax,
            isCurrent
          });
        }
      });
      return list15Min;
    }
  }, [spotPricesList, priceResolution, includeVat, retailerMargin, spotPrice, useLiveSpotPrice, carunaRegion, transferProduct, includeTransferInList]);

  return (
    <div className="min-h-screen bg-[#070A13] text-slate-100 font-sans antialiased flex flex-col items-center">
      
      {/* Container specifically sized & responsive for phone screens / widgets */}
      <div className="w-full max-w-md bg-[#0C101F] min-h-screen flex flex-col justify-between shadow-2xl border-x border-slate-900">
        
        {/* Top Header Card */}
        <div className="p-4 border-b-2 border-slate-800/90 bg-[#0F162E]/95 backdrop-blur-md sticky top-0 z-30 space-y-3 shadow-2xl shadow-black/80">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500 rounded-lg shadow-sm shadow-cyan-500/20">
                <Zap className="w-4 h-4 text-slate-950 font-bold" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-white font-display">Sähköauton latauslaskuri</h1>
              </div>
            </div>
            
            {/* Quick action buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (window.confirm("Haluatko varmasti nollata asetukset oletusarvoihin?")) {
                    setStartSoC(10);
                    setTargetSoC(80);
                    setAcAmps(16);
                    setAcPhases(3);
                    setAcAcceptanceRate(100);
                  }
                }}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-all hover:border-slate-700 cursor-pointer"
                title="Nollaa asetukset"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Sticky top-level real-time KPI card (Arviokentät) */}
          <div className="grid grid-cols-2 gap-2 bg-slate-900/95 p-3 rounded-xl border border-slate-700/80 shadow-md">
            {/* Left side: Time details */}
            <div className="flex items-center gap-2 border-r border-slate-700/80 pr-1.5">
              <Clock className="w-5 h-5 text-cyan-400 shrink-0" />
              <div className="space-y-1">
                <span className="text-[11px] text-slate-300 font-bold uppercase tracking-wide block leading-none">Arvioitu aika</span>
                <div className="text-sm font-mono font-extrabold text-white leading-none">
                  {Math.floor(simulation.totalTimeMinutes / 60) > 0 && (
                    <span className="mr-0.5">
                      {Math.floor(simulation.totalTimeMinutes / 60)}h
                    </span>
                  )}
                  {Math.round(simulation.totalTimeMinutes % 60)}m
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className="text-[10px] text-slate-300 font-mono block leading-tight">
                    Valmis: <strong className="text-cyan-300 font-bold">{completionDetails.shortLabel}</strong>
                  </span>
                  <span className="text-[10px] text-slate-300 font-mono block leading-tight">
                    Matka: <strong className="text-emerald-300 font-bold">+{fn(simulation.kmAdded, 0)} km</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Right side: Cost & Power details */}
            <div className="flex items-center gap-2 pl-1.5">
              <Coins className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="space-y-1">
                <span className="text-[11px] text-slate-300 font-bold uppercase tracking-wide block leading-none">Arvioitu hinta</span>
                <div className={`text-sm font-mono font-extrabold leading-none ${pricingDetails.isPastTime ? 'text-rose-400' : pricingDetails.isPriceUnknown ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {pricingDetails.isPastTime ? (
                    <span title="Aika on jo mennyt – menneisyyden ajoille ei näytetä hintaa">Aika mennyt</span>
                  ) : pricingDetails.isPriceUnknown ? (
                    <span title="Pörssisähkön hintatietoja puuttuu ladattavalta ajanjaksolta">Ei tiedossa</span>
                  ) : (
                    `${fn(pricingDetails.sessionCostEur, 2)} €`
                  )}
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className="text-[10px] text-teal-200 font-mono block leading-tight font-semibold">
                    Seur. 100 km: <strong className="text-teal-300 font-extrabold">{pricingDetails.isPastTime || pricingDetails.isPriceUnknown ? 'Ei tiedossa' : `~${fn(pricingDetails.costPer100km, 2)} €`}</strong>
                  </span>
                  <span className="text-[10px] text-slate-300 font-mono block leading-tight">
                    Ladattu: <strong className="text-emerald-300 font-bold">+{Math.round(Math.max(0, simulation.finalSocReached - startSoC))} %</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* View Toggle tabs at the bottom of frozen header */}
          <div className="grid grid-cols-4 gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-700/80">
            <button
              onClick={() => setActiveTab('simulate')}
              className={`py-1.5 px-0.5 text-[10px] min-[360px]:text-[11px] sm:text-xs font-bold rounded transition-all cursor-pointer text-center truncate ${
                activeTab === 'simulate'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm font-extrabold'
                  : 'text-slate-200 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              Laskuri
            </button>
            <button
              onClick={() => setActiveTab('vehicle')}
              className={`py-1.5 px-0.5 text-[10px] min-[360px]:text-[11px] sm:text-xs font-bold rounded transition-all cursor-pointer text-center truncate ${
                activeTab === 'vehicle'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm font-extrabold'
                  : 'text-slate-200 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              Ajoneuvo
            </button>
            <button
              onClick={() => setActiveTab('charger')}
              className={`py-1.5 px-0.5 text-[10px] min-[360px]:text-[11px] sm:text-xs font-bold rounded transition-all cursor-pointer text-center truncate ${
                activeTab === 'charger'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm font-extrabold'
                  : 'text-slate-200 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              Laturi
            </button>
            <button
              onClick={() => setActiveTab('electricity')}
              className={`py-1.5 px-0.5 text-[10px] min-[360px]:text-[11px] sm:text-xs font-bold rounded transition-all cursor-pointer text-center truncate ${
                activeTab === 'electricity'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm font-extrabold'
                  : 'text-slate-200 hover:text-white hover:bg-slate-800/80'
              }`}
              title="Sähkösopimus"
            >
              <span className="hidden min-[400px]:inline">Sähkösopimus</span>
              <span className="inline min-[400px]:hidden">Sähkö</span>
            </button>
          </div>
        </div>

        {/* Scrollable controls & results */}
        <div className="p-4 space-y-4 flex-grow overflow-y-auto">
          {activeTab === 'charger' ? (
            <div className="space-y-4 animate-fade-in">
              {/* SECTION 2: Charging current selections (Amps / kW AC) */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
                <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">Laturin Profiili</span>
                  <span className="text-[10px] bg-cyan-950/80 border border-cyan-800/40 px-2 py-0.5 rounded-full text-cyan-400 font-mono font-semibold">Kotilataus (AC)</span>
                </div>
    
                <div className="space-y-4">
                  
                  {/* 1-Phase vs 3-Phase selector */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-400 block">Vaiheet</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setAcPhases(3)}
                        className={`py-2 text-xs font-semibold rounded-lg border ${
                          acPhases === 3
                            ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400'
                        }`}
                      >
                        3-vaihe (maks. 11 kW)
                      </button>
                      <button
                        onClick={() => setAcPhases(1)}
                        className={`py-2 text-xs font-semibold rounded-lg border ${
                          acPhases === 1
                            ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400'
                        }`}
                      >
                        1-vaihe (maks. 7,4 kW)
                      </button>
                    </div>
                  </div>
    
                  {/* Amperage button selection */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] text-slate-400">Latausvirta (Ampeerit)</label>
                      <span className="text-xs font-mono font-bold text-white">{acAmps} A</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[8, 10, 13, 16].map((amp) => (
                        <button
                          key={amp}
                          onClick={() => setAcAmps(amp)}
                          className={`py-2 text-xs font-mono rounded-lg border ${
                            acAmps === amp
                              ? 'bg-cyan-500 border-cyan-500 text-slate-950 font-bold'
                              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {amp} A
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sähköauton AC-latausvirran rajoitus */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/50">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Auton AC-latausvirran rajoitus:</span>
                      <span className="font-mono text-white font-bold">{acAcceptanceRate} %</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="10"
                      value={acAcceptanceRate}
                      onChange={(e) => setAcAcceptanceRate(parseInt(e.target.value) || 100)}
                      className="w-full accent-cyan-400 cursor-pointer bg-slate-950 h-1.5 rounded-lg appearance-none"
                    />
                    <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                      <span>50%</span>
                      <span>Alennettu</span>
                      <span>100%</span>
                    </div>
                  </div>
    
                  {/* Live AC Power Speed output banner */}
                  <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                    <span className="text-slate-400">Latausteho (AC):</span>
                    <span className="font-mono font-bold text-emerald-400 text-sm">
                      {fn(calculatedAcPower, 2)} kW
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'vehicle' ? (
            <div className="space-y-4 animate-fade-in">
              {/* Vehicle Settings Card */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>Ajoneuvon Asetukset</span>
                </div>

                <div className="grid grid-cols-2 gap-3.5 text-xs">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase block tracking-wider">Akkukapasiteetti (kWh)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customVehicle.batteryCapacityKwh}
                      onChange={(e) => handleUpdateCustomVehicle({ batteryCapacityKwh: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-white font-mono font-bold focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase block tracking-wider">Keskikulutus (kWh/100 km)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customVehicle.consumptionRate / 10}
                      onChange={(e) => handleUpdateCustomVehicle({ consumptionRate: Math.round((parseFloat(e.target.value) || 0) * 10) })}
                      className="w-full bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-white font-mono font-bold focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Waste & Standby Losses Settings Card */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                    <Info className="w-4 h-4 text-cyan-400" />
                    <span>Häviöt & Lepokulutus</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono">Simuloi lataushäviöitä ja lepokulutusta</span>
                </div>

                {/* Efficiency slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Lataushyötysuhde (AC/DC-muunnos):</span>
                    <span className="font-mono text-white font-bold">{chargingEfficiency} %</span>
                  </div>
                  <input
                    type="range"
                    min="70"
                    max="98"
                    step="1"
                    value={chargingEfficiency}
                    onChange={(e) => setChargingEfficiency(parseInt(e.target.value) || 90)}
                    className="w-full accent-cyan-400 cursor-pointer bg-slate-950 h-1.5 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                    <span>70 % (Matalin)</span>
                    <span>90 % (Normaali AC)</span>
                    <span>98 % (Korkea DC)</span>
                  </div>
                </div>

                {/* Standby Overhead slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-400">Auton lepokulutus (BMS, elektroniikka):</span>
                    <span className="font-mono text-white font-bold">{fn(carOverheadPowerKw * 1000, 0)} W</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={carOverheadPowerKw}
                    onChange={(e) => setCarOverheadPowerKw(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer bg-slate-950 h-1.5 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                    <span>0 W (Teoreettinen)</span>
                    <span>300 W (Normaali lepokulutus)</span>
                    <span>1 500 W (Aktiivinen lämmitys)</span>
                  </div>
                </div>

                {/* Efficiency Insight Box */}
                {(() => {
                  const rawPower = (230 * acAmps * acPhases) / 1000;
                  const powerLimitAc = Math.min(11.0, rawPower);
                  const cellPower = powerLimitAc * (chargingEfficiency / 100) - carOverheadPowerKw;
                  const wastedPower = powerLimitAc - cellPower;
                  const wastedPercent = powerLimitAc > 0 ? (wastedPower / powerLimitAc) * 100 : 0;
                  
                  const isInefficient = wastedPercent > 18;
                  
                  return (
                    <div className={`p-2.5 rounded-lg border text-[10px] leading-normal space-y-1 ${
                      isInefficient 
                        ? 'bg-amber-950/20 border-amber-900/40 text-amber-300' 
                        : 'bg-emerald-950/10 border-emerald-900/30 text-emerald-400'
                    }`}>
                      <div className="flex items-center gap-1 font-bold">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {isInefficient ? 'Pienen latausvirran hyötysuhdehäviö' : 'Korkean hyötysuhteen lataus'}
                        </span>
                      </div>
                      <p className="text-slate-300">
                        {isInefficient ? (
                          <>
                            Auto on päällä ja kuluttaa sähköä pidempään latauksen aikana. Verkosta otettavasta <strong className="text-white">{fn(powerLimitAc, 2)} kW</strong> tehosta 
                            vain <strong className="text-white">{fn(Math.max(0, cellPower), 2)} kW</strong> saavuttaa akkukennot. 
                            <strong className="text-amber-300 ml-1 font-bold">
                              {fn(wastedPercent, 0)} % ostamastasi sähköstä kuluu muunnoshäviöihin ja lepokulutukseen!
                            </strong>
                          </>
                        ) : (
                          <>
                            Teholla <strong className="text-white">{fn(powerLimitAc, 2)} kW</strong> auto latautuu nopeasti. 
                            Lepokulutuksen osuus on pieni ja <strong className="text-emerald-400 font-bold">{fn(100 - wastedPercent, 0)} %</strong> verkkovirrasta 
                            siirtyy suoraan akkuun.
                          </>
                        )}
                      </p>
                      {acAmps < 16 && (
                        <p className="text-[9px] text-slate-400 italic mt-1 pt-1 border-t border-slate-800/50">
                          💡 <strong>Suurempi virta kannattaa</strong>: Latausvirran nostaminen 16 ampeeriin (tai 3-vaiheen käyttö) lyhentää latausaikaa ja vähentää lepokulutuksen aiheuttamaa energiahäviötä!
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Charging Curve reference panel / graph */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                    <span>Kotilatauksen Käyrä (AC)</span>
                  </div>
                  <span className="text-[10px] bg-cyan-950/60 text-cyan-400 font-mono font-bold px-2 py-0.5 rounded border border-cyan-800/40">
                    Maks: {fn(calculatedAcPower, 1)} kW
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  AC-kotilatauksessa akku latautuu tasaisella teholla (maks. <strong className="text-white">{fn(calculatedAcPower, 1)} kW</strong> valittujen vaihe- ja virta-asetusten mukaan) noin 97 % varaustasoon asti, minkä jälkeen teho laskee lopputasauksen ajaksi.
                </p>

                {/* Graph */}
                <div className="h-[140px] w-full pt-1.5">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={computedAcCurve}
                      margin={{ top: 5, right: 10, left: -25, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient id="colorCurve" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity="0.3"/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity="0"/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1c233c" />
                      <XAxis 
                        dataKey="soc" 
                        stroke="#475569" 
                        fontSize={9} 
                        fontFamily="monospace"
                        tickFormatter={(v) => `${v}%`}
                        type="number"
                        domain={[0, 100]}
                      />
                      <YAxis 
                        stroke="#475569" 
                        fontSize={9} 
                        fontFamily="monospace"
                        tickFormatter={(v) => `${v}kW`}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-slate-950 border border-slate-800 px-2.5 py-1.5 rounded-lg text-[10px] font-mono shadow-md">
                                <span className="text-slate-400 block font-sans">Akkutaso (SoC): <strong className="text-cyan-400">{data.soc} %</strong></span>
                                <span className="text-slate-400 block font-sans">
                                  AC-latausteho: <strong className="text-white">{fn(data.powerKw, 1)} kW</strong>
                                </span>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="powerKw"
                        stroke="#10b981"
                        strokeWidth={2} 
                        fill="url(#colorCurve)" 
                        fillOpacity={0.2} 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          ) : activeTab === 'electricity' ? (
            <div className="space-y-4 animate-fade-in">

              {/* Spot Price and Tariffs widget */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                    <Coins className="w-4 h-4 text-emerald-400" />
                    <span>{useLiveSpotPrice ? 'Pörssisähkö & Hinnat' : 'Sähkön Hinta & Sopimus'}</span>
                  </div>
                  {useLiveSpotPrice && spotPriceSyncedAt ? (
                    <span className="text-[9px] text-emerald-400 font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <RelativeTime timestamp={spotPriceSyncedAt} />
                    </span>
                  ) : !useLiveSpotPrice ? (
                    <span className="text-[9px] text-amber-400 font-mono font-medium flex items-center gap-1 bg-amber-950/40 border border-amber-900/30 px-2 py-0.5 rounded">
                      Kiinteä hinta
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500 font-mono">Ei päivitetty</span>
                  )}
                </div>

                {/* Spot Price Mode (Hourly vs Fixed) Toggler */}
                <div className="flex justify-between items-center bg-slate-950/40 p-2.5 rounded-lg border border-slate-900/60">
                  <span className="text-[10px] text-slate-400 font-medium">Sopimustyyppi</span>
                  <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800 text-[10px]">
                    <button
                      onClick={() => setUseLiveSpotPrice(true)}
                      className={`px-2.5 py-1 rounded font-bold transition-all cursor-pointer ${
                        useLiveSpotPrice 
                          ? 'bg-cyan-500 text-slate-950 shadow-sm font-bold' 
                          : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      Pörssisähkö
                    </button>
                    <button
                      onClick={() => setUseLiveSpotPrice(false)}
                      className={`px-2.5 py-1 rounded font-bold transition-all cursor-pointer ${
                        !useLiveSpotPrice 
                          ? 'bg-amber-500 text-slate-950 shadow-sm font-bold' 
                          : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      Kiinteä hinta
                    </button>
                  </div>
                </div>

                {/* Inputs for Spot price and margin */}
                <div className="grid grid-cols-1 gap-3">
                  {!useLiveSpotPrice ? (
                    <div className="space-y-1 animate-fade-in">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-slate-400 font-medium">Kiinteä sähkön hinta</label>
                        <span className="text-[9px] text-cyan-400 font-mono">snt/kWh</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-slate-950/60 p-1.5 rounded-lg border border-slate-800 focus-within:border-cyan-500/40">
                        <RepeatButton
                          onAction={() => setSpotPrice((prev) => Math.max(0, parseFloat((prev - 0.1).toFixed(2))))}
                          className="w-8 h-8 shrink-0 rounded bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-200 flex items-center justify-center touch-none select-none cursor-pointer"
                          title="Vähennä 0.1 snt"
                        >
                          <Minus className="w-4 h-4 stroke-[2]" />
                        </RepeatButton>
                        <input
                          type="number"
                          step="0.1"
                          value={spotPrice}
                          onChange={(e) => setSpotPrice(parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-center text-xs text-white font-mono font-bold focus:outline-none"
                        />
                        <RepeatButton
                          onAction={() => setSpotPrice((prev) => parseFloat((prev + 0.1).toFixed(2)))}
                          className="w-8 h-8 shrink-0 rounded bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-200 flex items-center justify-center touch-none select-none cursor-pointer"
                          title="Lisää 0.1 snt"
                        >
                          <Plus className="w-4 h-4 stroke-[2]" />
                        </RepeatButton>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1 animate-fade-in">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-slate-400 font-medium">Myyjän marginaali</label>
                        <span className="text-[9px] text-slate-500 font-mono">snt/kWh</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-slate-950/60 p-1.5 rounded-lg border border-slate-800 focus-within:border-cyan-500/40">
                        <RepeatButton
                          onAction={() => setRetailerMargin((prev) => Math.max(0, parseFloat((prev - 0.05).toFixed(2))))}
                          className="w-8 h-8 shrink-0 rounded bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-200 flex items-center justify-center touch-none select-none cursor-pointer"
                          title="Vähennä 0.05 snt"
                        >
                          <Minus className="w-4 h-4 stroke-[2]" />
                        </RepeatButton>
                        <input
                          type="number"
                          step="0.05"
                          value={retailerMargin}
                          onChange={(e) => setRetailerMargin(parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-center text-xs text-white font-mono font-bold focus:outline-none"
                        />
                        <RepeatButton
                          onAction={() => setRetailerMargin((prev) => parseFloat((prev + 0.05).toFixed(2)))}
                          className="w-8 h-8 shrink-0 rounded bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-200 flex items-center justify-center touch-none select-none cursor-pointer"
                          title="Lisää 0.05 snt"
                        >
                          <Plus className="w-4 h-4 stroke-[2]" />
                        </RepeatButton>
                      </div>
                    </div>
                  )}
                </div>

                {/* VAT Toggler */}
                <div className="flex justify-between items-center bg-slate-950/40 p-2.5 rounded-lg border border-slate-900/60">
                  <span className="text-[10px] text-slate-400 font-medium">Sisällytä ALV (25,5 %)?</span>
                  <button
                    onClick={() => setIncludeVat(!includeVat)}
                    className={`text-[10px] px-2.5 py-1 rounded font-bold border transition-all cursor-pointer ${
                      includeVat 
                        ? 'bg-cyan-950/50 border-cyan-500/40 text-cyan-400 font-bold' 
                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                    }`}
                  >
                    {includeVat ? 'ALV mukana' : 'Ei ALV:ia'}
                  </button>
                </div>

                {/* Total Cost in List Toggler - Only for Pörssisähkö */}
                {useLiveSpotPrice && (
                  <div className="flex justify-between items-center bg-slate-950/40 p-2.5 rounded-lg border border-slate-900/60">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-300 font-medium">Näytä kokonaishinta listassa?</span>
                      <span className="text-[8px] text-slate-500">Sisältää siirron ja verot (Caruna + sähkövero)</span>
                    </div>
                    <button
                      onClick={() => setIncludeTransferInList(!includeTransferInList)}
                      className={`text-[10px] px-2.5 py-1 rounded font-bold border transition-all cursor-pointer ${
                        includeTransferInList 
                          ? 'bg-cyan-950/50 border-cyan-500/40 text-cyan-400 font-bold' 
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      {includeTransferInList ? 'Kokonaishinta' : 'Spot + marginaali'}
                    </button>
                  </div>
                )}

                {useLiveSpotPrice ? (
                  <>
                    {/* Pörssisähkö.net Sync button */}
                    <button
                      onClick={fetchSpotPrice}
                      disabled={spotPriceLoading}
                      className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${spotPriceLoading ? 'animate-spin' : ''}`} />
                      <span>{spotPriceLoading ? 'Päivitetään Pörssisähköä...' : 'Päivitä Pörssisähkön hinnat'}</span>
                    </button>

                    {spotPriceError && (
                      <p className="text-[10px] text-rose-400 bg-rose-950/20 px-2 py-1.5 rounded border border-rose-900/30">
                        {spotPriceError}
                      </p>
                    )}

                    {/* Price Resolution Toggle & List */}
                    {spotPricesList && spotPricesList.length > 0 ? (
                      <div className="space-y-2 pt-3 border-t border-slate-800/80">
                        <div className="flex justify-between items-center pb-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                            Spot-hinnat ({priceResolution === 'hourly' ? 'Tunneittain' : '15 min'})
                          </span>
                          
                          {/* Resolution Selector Toggle */}
                          <div className="flex bg-slate-950 p-0.5 rounded border border-slate-900 text-[10px] items-center">
                            <button
                              onClick={() => setPriceResolution('hourly')}
                              className={`px-2 py-0.5 rounded-sm font-semibold transition-all cursor-pointer ${
                                priceResolution === 'hourly'
                                  ? 'bg-cyan-500 text-slate-950 font-bold'
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              Tunnit
                            </button>
                            <button
                              onClick={() => setPriceResolution('15min')}
                              className={`px-2 py-0.5 rounded-sm font-semibold transition-all cursor-pointer ${
                                priceResolution === '15min'
                                  ? 'bg-cyan-500 text-slate-950 font-bold'
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              15 min
                            </button>
                          </div>
                        </div>
                        
                        <div className="max-h-[220px] overflow-y-auto border border-slate-900 bg-slate-950/50 rounded-lg p-1.5 divide-y divide-slate-900/50 scrollbar-thin">
                          {displayedPrices.map((item) => (
                            <div 
                              key={item.key} 
                              className={`flex items-center justify-between py-1.5 px-2 text-[11px] font-mono transition-colors ${
                                item.isCurrent 
                                  ? 'bg-cyan-950/60 border border-cyan-500/30 rounded text-cyan-400 font-bold my-1' 
                                  : 'text-slate-300 hover:bg-slate-900/40'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-slate-500 font-medium">{item.dayName}</span>
                                <span className="font-semibold text-slate-200">
                                  {item.timeStr}
                                </span>
                                {item.isCurrent && (
                                  <span className="text-[9px] bg-cyan-500 text-slate-950 font-bold px-1 rounded scale-90">
                                    NYT
                                  </span>
                                )}
                              </div>
                              <div className="font-extrabold text-right flex items-center gap-1">
                                <span className={item.isCurrent ? 'text-cyan-400' : 'text-slate-100'}>{fn(item.price, 2)}</span>
                                <span className="text-[9px] font-normal text-slate-500">snt</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-slate-950/40 rounded-lg border border-slate-900/60 text-[11px] text-slate-500 italic">
                        Spot-hintoja ei ole ladattu. Napsauta ylhäältä "Päivitä Pörssisähkön hinnat" hakeaksesi tämän päivän hinnat.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-amber-950/20 border border-amber-900/20 rounded-lg p-3 text-center text-[10px] text-slate-400 space-y-1">
                    <p className="text-amber-300 font-semibold">Kiinteä hinta käytössä</p>
                    <p>Sähkön hinta on kiinteä <strong className="text-white">{fn(spotPrice, 2)} snt/kWh</strong> kaikkina vuorokaudenaikoina. Pörssisähkön tuntivaihtelut eivät vaikuta lataushintaan.</p>
                  </div>
                )}
              </div>

              {/* Caruna Network & Tariffs Card */}
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  <span>Caruna Siirto & Tariiffit</span>
                </div>

                {/* Caruna Network Region Selector */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 block font-medium">Verkkoyhtiön alue</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setCarunaRegion('OY')}
                      className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        carunaRegion === 'OY'
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400 font-bold shadow-sm shadow-cyan-950/20'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      Caruna Oy (Maaseutu)
                    </button>
                    <button
                      onClick={() => setCarunaRegion('ESPOO')}
                      className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        carunaRegion === 'ESPOO'
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400 font-bold shadow-sm shadow-cyan-950/20'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      Caruna Espoo (Kaupunki)
                    </button>
                  </div>
                </div>

                {/* Transfer Product selector */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 block font-medium">Siirtotuote</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTransferProduct('GENERAL')}
                      className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        transferProduct === 'GENERAL'
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400 font-bold'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      Yleissiirto (Kiinteä)
                    </button>
                    <button
                      onClick={() => setTransferProduct('NIGHT')}
                      className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        transferProduct === 'NIGHT'
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-400 font-bold'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      Yösiirto (Aikasähkö)
                    </button>
                  </div>
                </div>

              </div>

            </div>
          ) : (
            <>
              {/* SECTION 1: SoC Targets and Time limits input */}
          <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                Lataustapahtuman Asetukset
              </span>
              <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-900/30">
                +{Math.round(Math.max(0, simulation.finalSocReached - startSoC))} %
              </span>
            </div>

            {/* Grid of SoC Controls */}
            <div className="grid grid-cols-2 gap-3 items-end">
              {/* Start percentage input */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 font-medium block">Nykyinen varaus (SoC)</label>
                <div className="flex items-center justify-between gap-1 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 shadow-inner">
                  <RepeatButton
                    onAction={() => adjustStartSoC((prev) => prev - 1)}
                    className="w-9 h-9 shrink-0 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-100 flex items-center justify-center transition-all border border-slate-700/60 shadow-sm active:scale-95 touch-none select-none cursor-pointer"
                    title="Vähennä varausprosenttia (pidä pohjassa nopeuttaaksesi)"
                  >
                    <Minus className="w-4 h-4 stroke-[2]" />
                  </RepeatButton>

                  <div className="flex-1 flex items-center justify-center font-mono">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={startSoC}
                      onChange={(e) => adjustStartSoC(Number(e.target.value))}
                      className="w-10 text-center bg-transparent font-mono font-extrabold text-base text-white focus:outline-none focus:text-cyan-400"
                    />
                    <span className="text-xs font-bold text-slate-400 font-mono -ml-0.5">%</span>
                  </div>

                  <RepeatButton
                    onAction={() => adjustStartSoC((prev) => prev + 1)}
                    className="w-9 h-9 shrink-0 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-100 flex items-center justify-center transition-all border border-slate-700/60 shadow-sm active:scale-95 touch-none select-none cursor-pointer"
                    title="Lisää varausprosenttia (pidä pohjassa nopeuttaaksesi)"
                  >
                    <Plus className="w-4 h-4 stroke-[2]" />
                  </RepeatButton>
                </div>
              </div>

              {/* Target percentage input */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 font-medium block">Tavoitevaraustaso</label>
                <div className="flex items-center justify-between gap-1 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 shadow-inner">
                  <RepeatButton
                    onAction={() => adjustTargetSoC((prev) => prev - 1)}
                    className="w-9 h-9 shrink-0 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-100 flex items-center justify-center transition-all border border-slate-700/60 shadow-sm active:scale-95 touch-none select-none cursor-pointer"
                    title="Vähennä tavoitevarausta (pidä pohjassa nopeuttaaksesi)"
                  >
                    <Minus className="w-4 h-4 stroke-[2]" />
                  </RepeatButton>

                  <div className="flex-1 flex items-center justify-center font-mono">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={targetSoC}
                      onChange={(e) => adjustTargetSoC(Number(e.target.value))}
                      className="w-10 text-center bg-transparent font-mono font-extrabold text-base text-white focus:outline-none focus:text-emerald-400"
                    />
                    <span className="text-xs font-bold text-slate-400 font-mono -ml-0.5">%</span>
                  </div>

                  <RepeatButton
                    onAction={() => adjustTargetSoC((prev) => prev + 1)}
                    className="w-9 h-9 shrink-0 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-cyan-500 active:text-slate-950 text-slate-100 flex items-center justify-center transition-all border border-slate-700/60 shadow-sm active:scale-95 touch-none select-none cursor-pointer"
                    title="Lisää tavoitevarausta (pidä pohjassa nopeuttaaksesi)"
                  >
                    <Plus className="w-4 h-4 stroke-[2]" />
                  </RepeatButton>
                </div>
              </div>
            </div>
            
            {/* Limit Mode Toggle */}
            <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded-lg border border-slate-900/60 mt-3">
              <span className="text-[11px] text-slate-400 font-medium">Latauksen rajoitus</span>
              <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800 text-[10px]">
                <button
                  onClick={() => setLimitMode('soc')}
                  className={`px-2 py-1 rounded-sm font-semibold transition-all cursor-pointer ${
                    limitMode === 'soc'
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  Tavoitevaraus
                </button>
                <button
                  onClick={() => setLimitMode('time_range')}
                  className={`px-2 py-1 rounded-sm font-semibold transition-all cursor-pointer ${
                    limitMode === 'time_range'
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  Aikaikkuna
                </button>
              </div>
            </div>

            {/* Grid of Time Controls */}
            <div className={`grid ${limitMode === 'time_range' ? 'grid-cols-2' : 'grid-cols-1'} gap-3 pt-2 border-t border-slate-800/40 mt-3`}>
              {/* Start Time input & Day selector */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] text-slate-400 font-medium block">Aloitusaika</label>
                  <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800 text-[9px] font-mono">
                    <button
                      type="button"
                      onClick={() => setStartDayOffset(0)}
                      className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                        startDayOffset === 0
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Tänään
                    </button>
                    <button
                      type="button"
                      onClick={() => setStartDayOffset(1)}
                      disabled={useLiveSpotPrice && !hasTomorrowPrices}
                      className={`px-2 py-0.5 rounded transition-all ${
                        useLiveSpotPrice && !hasTomorrowPrices
                          ? 'opacity-40 text-slate-600 cursor-not-allowed'
                          : startDayOffset === 1
                          ? 'bg-cyan-500 text-slate-950 font-bold cursor-pointer'
                          : 'text-slate-400 hover:text-white cursor-pointer'
                      }`}
                      title={useLiveSpotPrice ? (hasTomorrowPrices ? "Valitse aloitusaika huomiselle" : "Huomisen spot-hinnat julkaistaan iltapäivällä klo 13.45 jälkeen") : "Valitse aloitusaika huomiselle"}
                    >
                      Huomenna
                    </button>
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-lg border ${isSelectedTimeInPast ? 'border-rose-500/60 bg-rose-950/20' : 'border-slate-800'}`}>
                  <Clock className={`w-3.5 h-3.5 shrink-0 ${isSelectedTimeInPast ? 'text-rose-400' : 'text-slate-500'}`} />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full text-center bg-transparent font-mono font-bold text-xs text-white focus:outline-none cursor-pointer [color-scheme:dark]"
                  />
                </div>
                <div className="flex justify-between items-center text-[9px] font-mono pt-0.5">
                  {isSelectedTimeInPast ? (
                    <span className="text-rose-400 font-bold flex items-center gap-1">
                      ⚠️ Aika on jo mennyt tänään!
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Valmis: <strong className="text-cyan-400 font-bold">{completionDetails.fullLabel}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* End / Departure Time input */}
              {limitMode === 'time_range' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-medium block">Lopetusaika (rajoitus)</label>
                  <div className="flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full text-center bg-transparent font-mono font-bold text-xs text-white focus:outline-none cursor-pointer [color-scheme:dark]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Optimized Time Suggestion Callout (Only for Pörssisähkö) */}
            {useLiveSpotPrice && sortedSuggestions.length > 0 && (() => {
              const cheapestSuggestion = validSuggestions.length > 0 ? validSuggestions[0] : sortedSuggestions[0];
              const currentCost = simulation.sessionCostCents / 100;
              const savingsEur = cheapestSuggestion ? Math.max(0, currentCost - cheapestSuggestion.costEur) : 0;
              const isAlreadyCheapest = startTime === cheapestSuggestion.startTime && startDayOffset === cheapestSuggestion.dayOffset;
              const isNearlyCheapest = !isAlreadyCheapest && savingsEur < 0.10 && !pricingDetails.isPriceUnknown && !cheapestSuggestion.hasMissingPrices;

              return (
                <div className="mt-3 pt-2.5 border-t border-slate-800/60 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Optimoitu aikaehdotus:</span>
                    </div>
                    {!isAlreadyCheapest && (
                      <button
                        onClick={() => {
                          setStartTime(cheapestSuggestion.startTime);
                          setStartDayOffset(cheapestSuggestion.dayOffset);
                          if (limitMode === 'time_range') {
                            setEndTime(cheapestSuggestion.endTime);
                          }
                        }}
                        className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/30 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <span>Käytä ehdotusta</span>
                      </button>
                    )}
                  </div>

                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-mono">
                      <div className="flex items-center gap-1 text-white font-bold">
                        <Clock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{cheapestSuggestion.displayLabel}</span>
                        {cheapestSuggestion.hasMissingPrices && (
                          <span className="text-[8px] bg-rose-950/60 text-rose-300 border border-rose-900 px-1 rounded-sm ml-1 animate-pulse" title="Seuraavan päivän hintoja puuttuu">
                            ⚠️ Hintoja puuttuu
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500">–</span>
                      <div className="flex items-center gap-1 text-slate-300 font-medium">
                        <span>{cheapestSuggestion.endDisplayLabel}</span>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      {cheapestSuggestion.hasMissingPrices ? (
                        <span className="text-amber-400 font-bold">Ei tiedossa</span>
                      ) : (
                        <span className="text-emerald-400 font-bold">{fn(cheapestSuggestion.costEur, 2)} €</span>
                      )}
                      
                      {savingsEur >= 0.10 && !pricingDetails.isPriceUnknown && !cheapestSuggestion.hasMissingPrices && (
                        <span className="text-[10px] text-amber-400 block font-normal">
                          Säästä {fn(savingsEur, 2)} €
                        </span>
                      )}
                      {savingsEur >= 0.10 && (pricingDetails.isPriceUnknown || cheapestSuggestion.hasMissingPrices) && (
                        <span className="text-[10px] text-amber-400 block font-normal text-right">
                          Edullisempi vaihtoehto
                        </span>
                      )}
                      {isAlreadyCheapest && (
                        <span className="text-[10px] text-emerald-400 block font-normal flex items-center gap-0.5 justify-end">
                          <CheckCircle className="w-3 h-3 text-emerald-400" />
                          <span>Edullisin aika</span>
                        </span>
                      )}
                      {isNearlyCheapest && (
                        <span className="text-[10px] text-teal-400 block font-normal flex items-center gap-0.5 justify-end" title="Nykyinen valinta on lähes yhtä edullinen (hintaero < 0,10 €)">
                          <CheckCircle className="w-3 h-3 text-teal-400" />
                          <span>Lähes yhtä edullinen</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* SECTION 4: Charging duration KPI result (Hero view) */}
          <div className="bg-gradient-to-br from-cyan-950/40 to-slate-900/80 rounded-2xl p-5 border border-cyan-800/40 flex flex-col items-center justify-center text-center space-y-3 shadow-xl">
            <span className="text-[11px] text-cyan-400 font-mono tracking-widest font-bold uppercase">
              Arvioitu Latausaika
            </span>
              
            <div className="flex flex-col items-center">
              <div className="text-4xl font-display font-extrabold text-white tracking-tight flex items-baseline gap-1">
                {Math.floor(simulation.totalTimeMinutes / 60) > 0 && (
                  <>
                    {Math.floor(simulation.totalTimeMinutes / 60)}
                    <span className="text-xl text-cyan-400 font-medium mr-1">h</span>
                  </>
                )}
                {Math.round(simulation.totalTimeMinutes % 60)}
                <span className="text-xl text-cyan-400 font-medium">m</span>
                <span className="text-lg text-slate-500 font-mono ml-1 font-normal">
                  {Math.round((simulation.totalTimeMinutes % 1) * 60)}s
                </span>
              </div>

              {/* Departure / End Time */}
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-300 font-mono bg-slate-950/60 px-3 py-1 rounded-full border border-slate-900">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  Arvioitu valmistumisaika:{' '}
                  <strong className="text-cyan-400 text-sm font-bold">
                    {completionDetails.fullLabel}
                  </strong>
                </span>
              </div>
            </div>

            {/* Energy audit & waste breakdown */}
            <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-900/80 w-full space-y-1.5 text-left text-[11px] leading-relaxed">
              <div className="flex justify-between">
                <span className="text-slate-400">⚡ Verkosta otettu energia (Laskutettu):</span>
                <span className="text-white font-mono font-bold">{fn(simulation.totalEnergyDrawn, 1)} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">🔋 Akkuun varastoitu energia:</span>
                <span className="text-emerald-400 font-mono font-bold">{fn(simulation.totalEnergyAdded, 1)} kWh</span>
              </div>
              <div className="flex justify-between border-t border-slate-900/80 pt-1.5">
                <span className="text-slate-500">🔥 Lataushäviö & lepokulutus:</span>
                <span className="text-amber-400 font-mono font-bold">
                  {fn(simulation.totalEnergyDrawn - simulation.totalEnergyAdded, 1)} kWh
                  <span className="text-[9px] text-slate-500 ml-1 font-normal">
                    ({simulation.totalEnergyDrawn > 0 ? fn(((simulation.totalEnergyDrawn - simulation.totalEnergyAdded) / simulation.totalEnergyDrawn) * 100, 0) : 0} %)
                  </span>
                </span>
              </div>
            </div>

            {/* Quick detail info badges */}
            <div className="grid grid-cols-2 gap-2.5 w-full pt-1.5 text-xs">
              <div className="flex flex-col items-center p-1.5 rounded-lg bg-slate-900/40">
                <span className="text-[10px] text-slate-500 uppercase font-mono">Keskiteho</span>
                <span className="font-mono text-white font-bold text-xs mt-0.5">{fn(simulation.avgPower, 1)} kW</span>
              </div>
              <div className="flex flex-col items-center p-1.5 rounded-lg bg-slate-900/40">
                <span className="text-[10px] text-slate-500 uppercase font-mono">Lisätty toimintamatka</span>
                <span className="text-emerald-400 font-bold text-xs mt-0.5">+{fn(simulation.kmAdded, 1)} km</span>
              </div>
            </div>
          </div>

          {/* SECTION 4.5: Automatic Spot Price & Caruna Transfer Cost Calculator */}
          <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                <Coins className="w-4 h-4 text-emerald-400" />
                <span>Hintalaskuri</span>
              </div>
              
              <div className="flex items-center gap-2">
                {useLiveSpotPrice ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={fetchSpotPrice}
                      disabled={spotPriceLoading}
                      title="Päivitä pörssisähkön hinnat"
                      className="p-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-400 hover:text-white rounded border border-slate-800 cursor-pointer transition-all"
                    >
                      <RefreshCw className={`w-3 h-3 ${spotPriceLoading ? 'animate-spin text-cyan-400' : ''}`} />
                    </button>
                    <span className="text-[9px] text-emerald-400 font-mono font-medium flex items-center gap-1 bg-emerald-950/40 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                      Pörssisähkö
                    </span>
                  </div>
                ) : (
                  <span className="text-[9px] text-amber-400 font-mono font-medium flex items-center gap-1 bg-amber-950/40 border border-amber-900/30 px-1.5 py-0.5 rounded" title="Käytetään manuaalista kiinteää hintaa">
                    Manuaalinen
                  </span>
                )}
              </div>
            </div>

            {!useLiveSpotPrice && (
              <div className="flex items-center justify-between bg-slate-950/40 p-2 rounded-lg border border-slate-900/60 text-[11px] animate-fade-in">
                <span className="text-slate-400 font-medium">Kiinteä sähkön hinta:</span>
                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-900 focus-within:border-cyan-500/30">
                  <input
                    type="number"
                    step="0.1"
                    value={spotPrice}
                    onChange={(e) => setSpotPrice(parseFloat(e.target.value) || 0)}
                    className="w-14 bg-transparent text-right text-xs text-white font-mono font-bold focus:outline-none"
                  />
                  <span className="text-[9px] text-slate-500 font-mono">snt/kWh</span>
                </div>
              </div>
            )}

            {/* Hero pricing metrics */}
            <div className={`p-3.5 bg-gradient-to-br rounded-xl border flex justify-between items-center ${pricingDetails.isPastTime ? 'from-rose-950/40 to-slate-900/80 border-rose-800/60' : pricingDetails.isPriceUnknown ? 'from-amber-950/40 to-slate-900/80 border-amber-800/60' : 'from-emerald-950/40 to-teal-950/30 border-emerald-800/60'}`}>
              <div className="space-y-1">
                <span className="text-xs text-slate-300 block uppercase font-mono font-bold tracking-wider">Latauskustannus (lataus)</span>
                {pricingDetails.isPastTime ? (
                  <span className="text-lg font-mono font-extrabold text-rose-400 leading-none" title="Valittu aloitusaika on jo mennyt tänään – menneisyyden ajoille ei näytetä hintaa">Aika mennyt</span>
                ) : pricingDetails.isPriceUnknown ? (
                  <span className="text-xl font-mono font-extrabold text-amber-400 leading-none" title="Pörssisähkön hintatietoja puuttuu latauksen ajalta">Ei tiedossa</span>
                ) : (
                  <span className="text-2xl font-mono font-extrabold text-emerald-400 leading-none">{fn(pricingDetails.sessionCostEur, 2)} €</span>
                )}
              </div>
              <div className="text-right space-y-1">
                <span className="text-xs text-teal-200 block uppercase font-mono font-extrabold tracking-wider">Hinta seuraavalle 100 km</span>
                {pricingDetails.isPastTime ? (
                  <span className="text-xs font-mono font-bold text-rose-400">Ei saatavilla</span>
                ) : pricingDetails.isPriceUnknown ? (
                  <span className="text-sm font-mono font-bold text-amber-400">Ei tiedossa</span>
                ) : (
                  <span className="text-lg font-mono font-extrabold text-teal-300">~{fn(pricingDetails.costPer100km, 2)} €</span>
                )}
                <span className="text-[10px] text-slate-300 block font-mono font-medium">
                  ({fn(activeVehicle.consumptionRate / 10, 1)} kWh/100 km)
                </span>
              </div>
            </div>

            {pricingDetails.isPastTime && (
              <div className="p-3 bg-rose-950/30 border border-rose-900/50 rounded-xl space-y-2 text-xs text-rose-300">
                <div className="flex items-center gap-1.5 font-bold text-rose-400">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>Valittu aloitusaika (klo {startTime}) on jo mennyt tänään</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Menneisyyden aikojen hintaa ei näytetä, sillä latausta ei voi enää aloittaa menneisyydessä. Valitse tuleva aika tai siirrä lataus huomiselle.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => {
                      const now = new Date();
                      const curH = now.getHours().toString().padStart(2, '0');
                      const curM = now.getMinutes().toString().padStart(2, '0');
                      setStartTime(`${curH}:${curM}`);
                      setStartDayOffset(0);
                    }}
                    className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[10px] rounded-lg transition-all cursor-pointer"
                  >
                    Aseta kuluvaan aikaan ({new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')})
                  </button>
                  {validSuggestions.length > 0 && (
                    <button
                      onClick={() => {
                        setStartTime(validSuggestions[0].startTime);
                        setStartDayOffset(validSuggestions[0].dayOffset);
                      }}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] rounded-lg transition-all cursor-pointer"
                    >
                      Valitse edullisin tuleva aika ({validSuggestions[0].displayLabel})
                    </button>
                  )}
                </div>
              </div>
            )}

            {!pricingDetails.isPastTime && pricingDetails.isPriceUnknown && (
              <div className="p-2.5 bg-amber-950/20 border border-amber-900/30 rounded-lg text-[10px] text-amber-300 leading-relaxed font-sans">
                ⚠️ <strong>Hintoja puuttuu</strong>: Osa latausajasta ajoittuu tunneille, joille ei ole vielä pörssisähkön hintoja (seuraavan päivän hinnat julkaistaan klo 13.45–14.00). Hintaa ei voida laskea ennen hintojen saapumista.
              </div>
            )}

            {/* Cost break down summary */}
            <div className="pt-2 border-t border-slate-800/40 space-y-2">
              <div className="p-2.5 bg-slate-950/60 border border-slate-900/80 rounded-lg space-y-1.5 font-mono text-[10px] text-slate-400">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{useLiveSpotPrice ? 'Pörssisähkö Spot:' : 'Sähkön hinta:'}</span>
                    {pricingDetails.isPriceUnknown ? (
                      <span className="text-amber-400 font-bold">Ei tiedossa</span>
                    ) : (
                      <span className="text-white font-bold">{fn(pricingDetails.spotComponent, 3)} snt/kWh</span>
                    )}
                  </div>
                  {useLiveSpotPrice && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Myyjän marginaali:</span>
                      <span className="text-white font-bold">{fn(pricingDetails.marginComponent, 3)} snt/kWh</span>
                    </div>
                  )}
                  <div className="flex justify-between" title={pricingDetails.transferNetName}>
                    <span className="text-slate-500 truncate max-w-[170px]">{pricingDetails.transferNetName}:</span>
                    <span className="text-white font-bold">{fn(pricingDetails.transferComponent, 3)} snt/kWh</span>
                  </div>
                  <div className="flex justify-between" title="Suomen sähkövero luokka 1 (kotitaloudet)">
                    <span className="text-slate-500">Sähkövero:</span>
                    <span className="text-white font-bold">{fn(pricingDetails.taxComponent, 3)} snt/kWh</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-slate-800 text-[10px]">
                    <span className="font-bold text-slate-300 uppercase">Kokonaishinta:</span>
                    {pricingDetails.isPriceUnknown ? (
                      <span className="text-amber-400 font-extrabold">Ei tiedossa</span>
                    ) : (
                      <span className="text-cyan-400 font-extrabold">{fn(pricingDetails.totalPricePerKwh, 3)} snt/kWh</span>
                    )}
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800/80 text-[10px]" title="Arvioitu ajokustannus autosi keskikulutuksella ja lataushäviöillä">
                    <span className="text-teal-300 font-bold">Hinta seur. 100 km ({fn(activeVehicle.consumptionRate / 10, 1)} kWh/100 km):</span>
                    {pricingDetails.isPriceUnknown || pricingDetails.isPastTime ? (
                      <span className="text-amber-400 font-bold">Ei tiedossa</span>
                    ) : (
                      <span className="text-teal-300 font-extrabold">~{fn(pricingDetails.costPer100km, 2)} €</span>
                    )}
                  </div>
                </div>
              </div>

              {spotPriceError && (
                <div className="p-2 bg-rose-950/20 text-rose-400 text-[9px] rounded border border-rose-900/30">
                  {spotPriceError}
                </div>
              )}
            </div>

          {/* SECTION 4.6: Smart Charging Optimizer & Cheapest Time Suggester (Only for Pörssisähkö) */}
          {useLiveSpotPrice && (
            startSoC < targetSoC ? (
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-display">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span>Älykäs Latausoptimointi</span>
                  </div>
                  {sortedSuggestions.length > 0 && (
                    <span className="text-[9px] bg-amber-950/60 text-amber-400 font-mono font-bold px-2 py-0.5 rounded border border-amber-800/40">
                      AC-kotilatausvinkki
                    </span>
                  )}
                </div>

                {/* Status Banner for Next Day Spot Prices Availability */}
                {hasTomorrowPrices ? (
                  <div className="p-2.5 bg-emerald-950/20 border border-emerald-900/40 rounded-xl text-[10.5px] text-emerald-400 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Seuraavan päivän (huomisen) spot-hinnat mukana laskennassa!</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded shrink-0">
                      Vahvistettu 48h
                    </span>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-1.5 text-xs text-amber-300">
                    <div className="flex items-center justify-between font-bold">
                      <div className="flex items-center gap-1.5 text-amber-400">
                        <Info className="w-4 h-4 shrink-0" />
                        <span>Seuraavan päivän spot-hintoja ei ole vielä julkaistu</span>
                      </div>
                      <button
                        onClick={fetchSpotPrice}
                        disabled={spotPriceLoading}
                        className="text-[9.5px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 px-2 py-0.5 rounded flex items-center gap-1 transition-all cursor-pointer font-bold"
                      >
                        <RefreshCw className={`w-3 h-3 ${spotPriceLoading ? 'animate-spin' : ''}`} />
                        <span>Päivitä hinnat</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                      Nord Pool julkaisee huomisen pörssisähkön hinnat klo 13.45–14.00. Optimoija laskee tällä hetkellä edullisimman latausajan kuluvan päivän hintojen pohjalta.
                    </p>
                  </div>
                )}

                {sortedSuggestions.length > 0 ? (() => {
                  const cheapestSuggestion = validSuggestions.length > 0 ? validSuggestions[0] : sortedSuggestions[0];
                  const currentCost = simulation.sessionCostCents / 100;
                  const savingsEur = cheapestSuggestion ? Math.max(0, currentCost - cheapestSuggestion.costEur) : 0;
                  const isAlreadyCheapest = startTime === cheapestSuggestion.startTime && startDayOffset === cheapestSuggestion.dayOffset;
                  const isNearlyCheapest = !isAlreadyCheapest && savingsEur < 0.10 && !pricingDetails.isPriceUnknown && !cheapestSuggestion.hasMissingPrices;

                  return (
                    <div className="space-y-3.5">
                      {/* Hero Recommendation Card */}
                      <div className="p-3.5 bg-gradient-to-br from-amber-950/25 to-slate-950/90 border border-amber-500/30 rounded-xl space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="space-y-0.5">
                            <span className="text-[9px] text-slate-400 uppercase font-mono tracking-wider block">Suositeltu aloitusaika</span>
                            <span className="text-xl font-mono font-extrabold text-amber-400">{cheapestSuggestion.displayLabel}</span>
                          </div>
                          <div className="text-right space-y-0.5">
                            <span className="text-[9px] text-slate-400 uppercase font-mono tracking-wider block">Optimoitu hinta</span>
                            {cheapestSuggestion.hasMissingPrices ? (
                              <span className="text-sm font-mono font-bold text-amber-400" title="Seuraavan päivän hintoja puuttuu">Ei tiedossa</span>
                            ) : (
                              <span className="text-base font-mono font-bold text-emerald-400">{fn(cheapestSuggestion.costEur, 2)} €</span>
                            )}
                          </div>
                        </div>

                        {/* Savings callout banner */}
                        {isAlreadyCheapest ? (
                          <div className="p-2 bg-emerald-950/20 border border-emerald-900/30 rounded-lg text-[10px] text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Hienoa! Valittu aikasi (<strong className="text-white">{cheapestSuggestion.displayLabel}</strong>) on edullisin.</span>
                          </div>
                        ) : isNearlyCheapest ? (
                          <div className="p-2 bg-teal-950/20 border border-teal-900/30 rounded-lg text-[10px] text-teal-300 flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 flex-1">
                              <CheckCircle className="w-3.5 h-3.5 shrink-0 text-teal-400" />
                              <span>Valitsemasi aika on lähes yhtä edullinen (hintaero alle 0,10 €).</span>
                            </div>
                            <button
                              onClick={() => {
                                setStartTime(cheapestSuggestion.startTime);
                                setStartDayOffset(cheapestSuggestion.dayOffset);
                                if (limitMode === 'time_range') {
                                  setEndTime(cheapestSuggestion.endTime);
                                }
                              }}
                              className="bg-teal-600 hover:bg-teal-500 text-slate-950 font-extrabold px-2 py-0.5 rounded text-[9.5px] transition-all shrink-0 cursor-pointer shadow-sm"
                            >
                              Käytä silti
                            </button>
                          </div>
                        ) : (
                          <div className="p-2 bg-amber-950/30 border border-amber-900/40 rounded-lg text-[10px] text-amber-300 flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 flex-1">
                              <Sparkles className="w-3.5 h-3.5 shrink-0 animate-pulse text-amber-400" />
                              <span>
                                {pricingDetails.isPriceUnknown || cheapestSuggestion.hasMissingPrices ? (
                                  <>Siirrä lataus ajankohtaan <strong className="text-white">{cheapestSuggestion.displayLabel.toLowerCase()}</strong> säästääksesi sähkölaskussa!</>
                                ) : (
                                  <>Säästä <strong className="text-white">{fn(savingsEur, 2)} €</strong> aloittamalla {cheapestSuggestion.displayLabel.toLowerCase()}!</>
                                )}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                setStartTime(cheapestSuggestion.startTime);
                                setStartDayOffset(cheapestSuggestion.dayOffset);
                                if (limitMode === 'time_range') {
                                  setEndTime(cheapestSuggestion.endTime);
                                }
                              }}
                              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold px-2.5 py-1 rounded text-[9.5px] transition-all shrink-0 cursor-pointer shadow-sm"
                            >
                              Käytä
                            </button>
                          </div>
                        )}

                        {/* Spec table snippet */}
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-900">
                          <div>
                            <span className="text-slate-500 block">Keskihinta:</span>
                            {cheapestSuggestion.hasMissingPrices ? (
                              <span className="text-amber-400 font-bold">Ei tiedossa</span>
                            ) : (
                              <span className="text-white font-bold">{fn(cheapestSuggestion.avgPricePerKwh, 1)} snt/kWh</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500 block">Valmis:</span>
                            <span className="text-cyan-400 font-bold">klo {cheapestSuggestion.endDisplayLabel}</span>
                          </div>
                        </div>
                      </div>

                      {/* Expandable alternative hours list */}
                      <div className="space-y-2 pt-1 border-t border-slate-900/60">
                        <button
                          onClick={() => setShowAltHours(!showAltHours)}
                          className="w-full py-1.5 flex items-center justify-between text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <span className="font-semibold uppercase tracking-wider block">Vertaile muita aloitusaikoja</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-cyan-400 font-bold">
                              {showAltHours ? 'Piilota' : `Näytä kaikki (${cheapestTimeSuggestions.length}h)`}
                            </span>
                            <span className={`transform transition-transform duration-200 text-cyan-400 font-bold ${showAltHours ? 'rotate-180' : ''}`}>
                              ▼
                            </span>
                          </div>
                        </button>

                        {showAltHours && (
                          <div className="space-y-2.5 animate-fade-in">
                            {/* Sort toggle buttons */}
                            <div className="flex justify-between items-center bg-slate-950 p-0.5 rounded border border-slate-900 text-[10px]">
                              <span className="text-slate-500 pl-1.5 font-medium">Järjestys:</span>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => setAltHoursSort('cost')}
                                  className={`px-2 py-0.5 rounded-sm font-semibold transition-all cursor-pointer ${
                                    altHoursSort === 'cost'
                                      ? 'bg-amber-500 text-slate-950 font-bold'
                                      : 'text-slate-400 hover:text-slate-300'
                                  }`}
                                >
                                  Edullisin ensin
                                </button>
                                <button
                                  onClick={() => setAltHoursSort('time')}
                                  className={`px-2 py-0.5 rounded-sm font-semibold transition-all cursor-pointer ${
                                    altHoursSort === 'time'
                                      ? 'bg-amber-500 text-slate-950 font-bold'
                                      : 'text-slate-400 hover:text-slate-300'
                                  }`}
                                >
                                  Aikajärjestys
                                </button>
                              </div>
                            </div>

                            {/* Hour items scrollable grid */}
                            <div className="max-h-[220px] overflow-y-auto border border-slate-900 bg-slate-950/50 rounded-lg p-1 divide-y divide-slate-900/60 scrollbar-thin">
                              {(altHoursSort === 'cost' ? sortedSuggestions : cheapestTimeSuggestions).map((item) => {
                                const isCurrent = item.startTime === startTime && item.dayOffset === startDayOffset;
                                const isCheapest = item.id === cheapestSuggestion.id;

                                return (
                                  <div
                                    key={item.id}
                                    className={`flex items-center justify-between py-1.5 px-2 text-[10.5px] font-mono transition-colors ${
                                      isCurrent
                                        ? 'bg-cyan-950/40 border border-cyan-500/30 rounded text-cyan-400 font-bold my-1'
                                        : isCheapest
                                        ? 'bg-amber-950/30 border border-amber-500/20 rounded text-amber-300 font-bold my-1'
                                        : 'text-slate-300 hover:bg-slate-900/40'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-extrabold">{item.displayLabel}</span>
                                      {isCheapest && (
                                        <span className="text-[8px] bg-amber-500 text-slate-950 font-bold px-1 rounded-sm tracking-wide">
                                          HALVIN
                                        </span>
                                      )}
                                      {isCurrent && (
                                        <span className="text-[8px] bg-cyan-500 text-slate-950 font-bold px-1 rounded-sm tracking-wide">
                                          VALITTU
                                        </span>
                                      )}
                                      {item.hasMissingPrices && (
                                        <span className="text-[8px] bg-rose-950/60 text-rose-300 border border-rose-900 px-1 rounded-sm">
                                          ⚠️ Puuttuu
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2.5 text-right font-semibold">
                                      <div className="flex flex-col text-right">
                                        <span className={isCheapest ? 'text-emerald-400 font-extrabold' : 'text-slate-300'}>
                                          {item.hasMissingPrices ? 'Ei tiedossa' : `${fn(item.costEur, 2)} €`}
                                        </span>
                                        <span className="text-[8px] text-slate-500 font-normal">
                                          {item.hasMissingPrices ? 'Hintoja puuttuu' : `${fn(item.avgPricePerKwh, 1)} snt/kWh`}
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => {
                                          setStartTime(item.startTime);
                                          setStartDayOffset(item.dayOffset);
                                          if (limitMode === 'time_range') {
                                            setEndTime(item.endTime);
                                          }
                                        }}
                                        disabled={isCurrent}
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
                                          isCurrent
                                            ? 'border-transparent text-slate-500 bg-transparent cursor-not-allowed'
                                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                                        }`}
                                      >
                                        Valitse
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <p className="text-[11px] font-mono text-slate-500 italic text-center py-2">
                    Lasketaan optimointisuosituksia...
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-[#12182F] rounded-xl p-4 border border-slate-900 text-center py-5">
                <Sparkles className="w-5 h-5 text-slate-500 mx-auto mb-1.5 animate-pulse" />
                <p className="text-[11px] text-slate-400">
                  Aseta tavoitevaraus suuremmaksi kuin nykyinen varaus nähdäksesi älykkään latauksen optimointivinkit.
                </p>
              </div>
            )
          )}


            </>
          )}

        </div>

        {/* Mini Footer branding block */}
        <div className="p-4 border-t border-slate-900 bg-[#070A13] text-center text-[10px] text-slate-500 flex flex-col items-center gap-1.5">
          <button
            onClick={() => setShowAboutModal(true)}
            className="flex items-center gap-1 text-slate-400 hover:text-white font-semibold cursor-pointer my-0.5"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Tietoa sovelluksesta</span>
          </button>
        </div>

        {/* About / Info Modal */}
        {showAboutModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#0E1326] border border-cyan-800/60 rounded-2xl max-w-md w-full p-5 space-y-4 text-left shadow-2xl relative max-h-[90vh] overflow-y-auto">
              
              <button
                onClick={() => setShowAboutModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-cyan-500 rounded-xl">
                  <Info className="w-5 h-5 text-slate-950 font-bold" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-display">Tietoa sovelluksesta</h3>
                  <p className="text-[11px] text-cyan-400 font-mono">Latauskaveri &copy; 2026</p>
                </div>
              </div>

              <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                  <p>Kaikki valinnat ja asetukset tallentuvat automaattisesti tälle laitteelle.</p>
                  <p className="text-slate-400 font-mono pt-2 border-t border-slate-800">Tekijä: Jokke Heikkilä / Google AI Studio</p>
                </div>

                <div className="p-3 bg-slate-900/80 border border-cyan-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300 flex items-center gap-1">
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                      Asenna sovellukseksi
                    </span>
                    {deferredPrompt && (
                      <button
                        onClick={handleInstallClick}
                        className="px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg font-bold text-[10px] cursor-pointer"
                      >
                        Asenna Nyt
                      </button>
                    )}
                  </div>
                  <p className="text-slate-300 text-[11px]">
                    Sovellus noudattaa PWA-standardia. Voit asentaa sen suoraan kotinäytölle ilman latauksia tai sovelluskauppaa!
                  </p>
                  <ol className="list-decimal list-inside text-[11px] text-slate-400 space-y-1 pt-1 font-sans">
                    <li>Avaa tämä sivu Android-puhelimesi selaimessa.</li>
                    <li>Napsauta selaimen oikean yläkulman valikkoa (⋮).</li>
                    <li>Valitse <strong className="text-white">"Asenna sovellus"</strong> tai <strong className="text-white">"Lisää aloitusnäyttöön"</strong>.</li>
                  </ol>

                  <div className="pt-2 mt-2 border-t border-cyan-900/30">
                    <span className="font-bold text-slate-200 flex items-center gap-1 mb-1.5">
                      <Download className="w-3.5 h-3.5 text-slate-400" />
                      Muunna APK:ksi
                    </span>
                    <p className="text-[11px] text-slate-400 mb-1.5">
                      Jos haluat julkaista sovelluksen tai tarvitset .apk -tiedoston:
                    </p>
                    <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-1 font-sans">
                      <li>Kopioi tämän sovelluksen verkko-osoite (URL).</li>
                      <li>Syötä osoite ilmaisessa palvelussa <strong className="text-cyan-400 font-mono">PWABuilder.com</strong></li>
                    </ul>
                  </div>
                </div>

              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Sulje
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}
