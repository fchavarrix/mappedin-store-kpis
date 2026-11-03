// Simulated counts for each store, as a people-counting camera would report them, plus the daily
// tickets and sales the store reports to the mall. Every number is deterministic per store and
// date, so the same day always shows the same figures.
//
// The counter at each store has two lines:
// - the door line, counting people in and out (entries, exits and, from both, the live occupancy);
// - the corridor line in front of the store, counting passers-by in both directions. Only the sum
//   of both directions is used.

import type { Category } from './brands';

export const OPEN = 600; // 10:00
export const CLOSE = 1320; // 22:00
export const BIN = 15; // minutes per counter reading
export const BINS = (CLOSE - OPEN) / BIN;

export type Profile = {
  label: string;
  /** Share of passers-by that walk in. */
  capture: number;
  /** Tickets over entries. Groups pay one bill, so restaurants sit well below 100 %. */
  conversion: number;
  /** Average ticket, S/. */
  ticket: number;
  /** Average stay inside, minutes. */
  dwell: number;
  /** Typical occupancy cost of the category (rent + common charges over sales), used to set the rent. */
  cost: number;
  /** Restaurants: entries peak at lunch and dinner. */
  meals?: boolean;
};

/** Common area charges, S/ per m² per month, the same for every store. */
export const COMMON_FEE = 26;

export const PROFILES: Record<Category, Profile> = {
  super: { label: 'Supermercado', capture: 0.3, conversion: 0.86, ticket: 92, dwell: 32, cost: 0.04 },
  hogar: { label: 'Mejoramiento del hogar', capture: 0.2, conversion: 0.46, ticket: 175, dwell: 28, cost: 0.06 },
  moda: { label: 'Moda', capture: 0.13, conversion: 0.24, ticket: 118, dwell: 16, cost: 0.12 },
  calzado: { label: 'Calzado y accesorios', capture: 0.11, conversion: 0.27, ticket: 155, dwell: 13, cost: 0.13 },
  alpaca: { label: 'Alpaca y vicuña', capture: 0.05, conversion: 0.19, ticket: 390, dwell: 12, cost: 0.15 },
  tecno: { label: 'Tecnología', capture: 0.09, conversion: 0.11, ticket: 640, dwell: 15, cost: 0.07 },
  farmacia: { label: 'Farmacia', capture: 0.14, conversion: 0.72, ticket: 46, dwell: 6, cost: 0.09 },
  belleza: { label: 'Belleza', capture: 0.08, conversion: 0.41, ticket: 72, dwell: 9, cost: 0.13 },
  restaurante: { label: 'Restaurante', capture: 0.07, conversion: 0.42, ticket: 165, dwell: 48, cost: 0.11, meals: true },
  rapida: { label: 'Comida rápida', capture: 0.12, conversion: 0.62, ticket: 39, dwell: 20, cost: 0.12, meals: true },
  cafe: { label: 'Café y panadería', capture: 0.09, conversion: 0.64, ticket: 31, dwell: 22, cost: 0.12 },
  chocolates: { label: 'Chocolates', capture: 0.07, conversion: 0.55, ticket: 44, dwell: 6, cost: 0.14 },
  libreria: { label: 'Librería y útiles', capture: 0.1, conversion: 0.49, ticket: 41, dwell: 11, cost: 0.1 },
  barrio: { label: 'Tienda de barrio', capture: 0.12, conversion: 0.8, ticket: 21, dwell: 7, cost: 0.09 },
};

export type StoreSim = {
  id: string;
  profile: Profile;
  /** Passers-by on an average weekday, both directions. */
  traffic: number;
  /** Leasable area, m². */
  area: number;
  /** Rent in the lease, S/ per m² per month. */
  rent: number;
  /** How well this store does against its category (capture multiplier). */
  performance: number;
};

export type Day = {
  date: string;
  pass: number[];
  enter: number[];
  exit: number[];
  tickets: number;
  sales: number;
};

// Sunday first, as Date.getDay().
const WEEKDAY = [1.24, 0.82, 0.8, 0.86, 0.9, 1.06, 1.38];

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const gauss = (t: number, mu: number, sd: number) => Math.exp(-(((t - mu) / sd) ** 2) / 2);

/** Mall traffic over the day: slow morning, lunch peak, bigger evening peak, last hour winding down. */
const CURVE = (() => {
  const raw = Array.from({ length: BINS }, (_, b) => {
    const t = OPEN + (b + 0.5) * BIN;
    return 0.45 + 0.6 * gauss(t, 810, 60) + 0.9 * gauss(t, 1170, 95) - 0.25 * gauss(t, CLOSE, 30) - 0.2 * gauss(t, OPEN, 30);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
})();

/** Share of visitors that leave d bins after the bin they came in (gamma, shape 2). */
function dwellKernel(mean: number) {
  const theta = mean / 2 / BIN;
  const k = Array.from({ length: BINS }, (_, d) => {
    const x = d + 0.5;
    return (x / theta) * Math.exp(-x / theta);
  });
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((v) => v / sum);
}

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Rent per m² as a mall would set it: the category's typical occupancy cost applied to the sales a
 * store of that size would make on an average corridor. Stores that capture or convert better than
 * that end up with a lower occupancy cost, and the weak ones with a higher one.
 */
export function leaseRent(p: Profile, area: number, traffic: number) {
  const monthlySales = traffic * p.capture * p.conversion * p.ticket * 30.4;
  return Math.max(40, Math.round((p.cost * monthlySales) / area - COMMON_FEE));
}

const cache = new Map<string, Day>();

export function simulateDay(store: StoreSim, date: Date): Day {
  const key = `${store.id}|${dateKey(date)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(key);
  const noise = (spread: number) => 1 + (r() * 2 - 1) * spread;
  const p = store.profile;

  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const payday = date.getDate() === 15 || date.getDate() === lastDay || date.getDate() === 1 ? 1.12 : 1;
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const daily = store.traffic * WEEKDAY[date.getDay()] * payday * noise(0.08);
  const capture = p.capture * store.performance * noise(0.12);

  const pass: number[] = [];
  const enterRaw: number[] = [];
  for (let b = 0; b < BINS; b++) {
    const t = OPEN + (b + 0.5) * BIN;
    const n = Math.round(daily * CURVE[b] * noise(0.18));
    pass.push(n);
    const meal = p.meals ? 0.55 + 1.3 * gauss(t, 795, 45) + 1.0 * gauss(t, 1200, 60) : 1;
    enterRaw.push(n * capture * meal * noise(0.25));
  }
  // Rounded so that the running total matches, which keeps the counts whole numbers.
  const whole = (raw: number[]) => {
    let acc = 0, done = 0;
    return raw.map((v) => {
      acc += v;
      const n = Math.round(acc) - done;
      done += n;
      return n;
    });
  };
  const enter = whole(enterRaw);

  // Everyone still inside at closing time leaves in the last reading.
  const kernel = dwellKernel(p.dwell * noise(0.15));
  const exitRaw = new Array<number>(BINS).fill(0);
  enter.forEach((n, b) => kernel.forEach((k, d) => (exitRaw[Math.min(BINS - 1, b + d)] += n * k)));
  const exit = whole(exitRaw);

  const visitors = enter.reduce((a, b) => a + b, 0);
  // Weekends bring more browsing, so conversion dips a little.
  const tickets = Math.round(visitors * p.conversion * (weekend ? 0.93 : 1) * noise(0.1));
  const sales = Math.round(tickets * p.ticket * noise(0.12));

  const day = { date: dateKey(date), pass, enter, exit, tickets, sales };
  cache.set(key, day);
  return day;
}
