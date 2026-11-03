import { getMapData, show3dMap, type MapData, type MapView, type Space } from '@mappedin/mappedin-js';
import '@mappedin/mappedin-js/lib/index.css';
import './style.css';
import { brands, type Brand } from './brands';
import { BIN, BINS, CLOSE, COMMON_FEE, OPEN, PROFILES, leaseRent, simulateDay, type StoreSim } from './model';

// Public Enterprise demo credentials from Mappedin's developer docs (they only work with demo maps).
const MAP_OPTIONS = {
  key: import.meta.env.VITE_MAPPEDIN_KEY ?? '5eab30aa91b055001a68e996',
  secret: import.meta.env.VITE_MAPPEDIN_SECRET ?? 'RJyRXKcryCMy4erZqqCbuB1NbR66QTGNXVE0x3Pg6oCIlUR1',
  mapId: import.meta.env.VITE_MAPPEDIN_MAP_ID ?? 'mappedin-demo-mall',
};

// Sequential ramp (one hue, light to dark) for magnitudes; status colours for occupancy cost.
const RAMP = ['#dbe7ff', '#adc6ff', '#7aa2ff', '#4677f0', '#1f4fd1'];
const STATUS = { good: '#1f9d6b', warning: '#f2b233', critical: '#e0483f' };
const NO_DATA = '#d5dae2';
const LINES = { door: '#2266ff', corridor: '#0b1220' };

type LngLat = [number, number];
type Kpi = 'capture' | 'conversion' | 'enter' | 'pass' | 'occupancy' | 'cost';
type Period = 'live' | '1' | '7' | '30' | 'range';

type Store = {
  brand: Brand;
  space: Space;
  sim: StoreSim;
  /** Door line of the counter and the corridor line a few metres outside it, drawn as thin strips. */
  door?: { line: LngLat[]; corridor: LngLat[]; outside: LngLat };
  marker: ReturnType<MapView['Markers']['add']>;
};

type Totals = {
  pass: number;
  enter: number;
  /** Tickets and sales arrive with the store's daily report, so they are null until the day closes. */
  tickets: number | null;
  sales: number | null;
  /** Live: people inside now. Past periods: highest occupancy reached. */
  occupancy: number;
  /** Rent plus common charges for the period, S/. */
  rent: number;
};

const KPI_LABEL: Record<Kpi, string> = {
  capture: 'Captación',
  conversion: 'Conversión',
  enter: 'Ingresos',
  pass: 'Pasillo',
  occupancy: 'Aforo',
  cost: 'Costo de ocupación',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  clock: $('clock'),
  periodButtons: document.querySelectorAll<HTMLButtonElement>('[data-period]'),
  kpiButtons: document.querySelectorAll<HTMLButtonElement>('[data-kpi]'),
  liveRow: $('liveRow'),
  time: $<HTMLInputElement>('time'),
  play: $<HTMLButtonElement>('play'),
  rangeRow: $('rangeRow'),
  from: $<HTMLInputElement>('from'),
  to: $<HTMLInputElement>('to'),
  mall: $('mall'),
  legend: $('legend'),
  store: $('store'),
  ranking: $('ranking'),
  tip: $('tip'),
};

let mapData: MapData;
let mapView: MapView;
const stores: Store[] = [];
let period: Period = 'live';
let kpi: Kpi = 'capture';
let selected = 'topitop';
// The counter lines and flows only make sense up close, so they appear once a store is picked.
let zoomed = false;
let lineShapes: ReturnType<MapView['Shapes']['add']>[] = [];
let flowMarker: ReturnType<MapView['Markers']['add']> | undefined;

const DAY = 86400000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const yesterday = addDays(today, -1);
const HISTORY = 90;
const realNow = new Date().getHours() * 60 + new Date().getMinutes();
// "Now" for the live view: the real time, kept inside opening hours so the demo always has data.
let now = Math.min(CLOSE, Math.max(OPEN + 60, Math.floor(realNow / BIN) * BIN));

// ---- Formatting ----

const nf = new Intl.NumberFormat('es-PE');
const int = (n: number) => nf.format(Math.round(n));
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;
const money = (n: number) =>
  n >= 1e6 ? `S/ ${(n / 1e6).toFixed(1)} M` : n >= 1e4 ? `S/ ${Math.round(n / 1e3)} mil` : `S/ ${int(n)}`;
const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayFmt = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// ---- Periods ----

/** Days of the selected period, and the readings of each day that count (all of them, except live). */
function periodDays(): { dates: Date[]; bins: number } {
  if (period === 'live') return { dates: [today], bins: (now - OPEN) / BIN };
  if (period === 'range') {
    let from = parseDate(ui.from.value), to = parseDate(ui.to.value);
    if (from > to) [from, to] = [to, from];
    const n = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    return { dates: Array.from({ length: n }, (_, i) => addDays(from, i)), bins: BINS };
  }
  const n = Number(period);
  return { dates: Array.from({ length: n }, (_, i) => addDays(yesterday, i - n + 1)), bins: BINS };
}

/** Same length, just before; a single day compares with the same weekday of the week before. */
const previous = (dates: Date[]) => dates.map((d) => addDays(d, -Math.max(7, dates.length)));

function totals(store: Store, dates: Date[], bins: number): Totals {
  const t: Totals = { pass: 0, enter: 0, tickets: bins === BINS ? 0 : null, sales: bins === BINS ? 0 : null, occupancy: 0, rent: 0 };
  for (const date of dates) {
    const day = simulateDay(store.sim, date);
    let inside = 0;
    for (let b = 0; b < bins; b++) {
      t.pass += day.pass[b];
      t.enter += day.enter[b];
      inside += day.enter[b] - day.exit[b];
      if (bins === BINS) t.occupancy = Math.max(t.occupancy, inside);
    }
    if (bins !== BINS) t.occupancy = inside;
    if (t.tickets !== null) t.tickets += day.tickets;
    if (t.sales !== null) t.sales += day.sales;
  }
  t.rent = ((store.sim.rent + COMMON_FEE) * store.sim.area * dates.length) / 30.4;
  return t;
}

function sum(list: Totals[]): Totals {
  const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
  return list.reduce((a, t) => ({
    pass: a.pass + t.pass,
    enter: a.enter + t.enter,
    tickets: add(a.tickets, t.tickets),
    sales: add(a.sales, t.sales),
    occupancy: a.occupancy + t.occupancy,
    rent: a.rent + t.rent,
  }));
}

function value(t: Totals, k: Kpi): number | null {
  switch (k) {
    case 'capture':
      return t.pass ? t.enter / t.pass : null;
    case 'conversion':
      return t.tickets === null || !t.enter ? null : t.tickets / t.enter;
    case 'cost':
      return t.sales ? t.rent / t.sales : null;
    case 'enter':
      return t.enter;
    case 'pass':
      return t.pass;
    case 'occupancy':
      return t.occupancy;
  }
}

const isRate = (k: Kpi) => k === 'capture' || k === 'conversion' || k === 'cost';
const show = (k: Kpi, v: number | null) => (v === null ? 'al cierre' : isRate(k) ? pct(v) : int(v));

/** Change against the previous period: points for rates, percent for counts. Lower cost is better. */
function delta(k: Kpi, cur: number | null, prev: number | null) {
  if (cur === null || prev === null || !prev) return '';
  const d = isRate(k) ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return '<span class="delta">= sin cambio</span>';
  const better = k === 'cost' ? d < 0 : d > 0;
  const text = `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${isRate(k) ? ' pp' : ' %'}`;
  return `<span class="delta ${better ? 'up' : 'down'}">${text}</span>`;
}

const costStatus = (c: number) => (c <= 0.1 ? 'good' : c <= 0.15 ? 'warning' : 'critical');
const STATUS_LABEL = { good: 'Sano', warning: 'En observación', critical: 'En riesgo' };

// ---- Map ----

const logoUrl = (b: Brand) => `${import.meta.env.BASE_URL}logos/${b.logo}`;
const logo = (b: Brand, size = '') => `<span class="logo-badge ${size} ${b.dark ? 'dark' : ''}"><img src="${logoUrl(b)}" alt="${b.name}" /></span>`;
const coord = ([lng, lat]: LngLat) => mapView.createCoordinate({ latitude: lat, longitude: lng, floorId: mapView.currentFloor.id });
const polygons = (rings: LngLat[][]) => ({
  type: 'FeatureCollection' as const,
  features: rings.map((ring) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } })),
});

function sheetOffsets() {
  const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
  const wide = innerWidth >= 900;
  return { top: 80, bottom: wide ? 16 : innerHeight - sheet.top + 8, left: 16, right: wide ? innerWidth - sheet.left + 8 : 16 };
}

/** Colour for each store, and the legend that explains it. */
function colours(values: (number | null)[]) {
  if (kpi === 'cost') {
    ui.legend.innerHTML = (['good', 'warning', 'critical'] as const)
      .map((s, i) => `<span><i style="background:${STATUS[s]}"></i>${STATUS_LABEL[s]} ${['≤ 10 %', '10–15 %', '> 15 %'][i]}</span>`)
      .join('');
    return values.map((v) => (v === null ? NO_DATA : STATUS[costStatus(v)]));
  }
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) {
    ui.legend.innerHTML = `<span><i style="background:${NO_DATA}"></i>${KPI_LABEL[kpi]} se calcula al cierre, con los tickets del día</span>`;
    return values.map(() => NO_DATA);
  }
  const lo = Math.min(...known), hi = Math.max(...known);
  ui.legend.innerHTML = `<span class="ramp">${show(kpi, lo)}<b style="background:linear-gradient(90deg,${RAMP.join(',')})"></b>${show(kpi, hi)}</span>`;
  return values.map((v) => (v === null ? NO_DATA : RAMP[Math.min(RAMP.length - 1, Math.floor(((v - lo) / (hi - lo || 1)) * RAMP.length))]));
}

/** The two counting lines of the selected store and its live flows. */
function drawCounter(store: Store, t: Totals) {
  lineShapes.forEach((s) => mapView.Shapes.remove(s));
  lineShapes = [];
  if (flowMarker) mapView.Markers.remove(flowMarker);
  flowMarker = undefined;
  if (!store.door || !zoomed) return;
  const floor = mapView.currentFloor;
  lineShapes.push(mapView.Shapes.add(polygons([store.door.line]), { color: LINES.door, height: 0.25 }, floor));
  lineShapes.push(mapView.Shapes.add(polygons([store.door.corridor]), { color: LINES.corridor, height: 0.25 }, floor));
  const inside = period === 'live' ? `<span>👥 <b>${int(t.occupancy)}</b> adentro ahora</span>` : `<span>👥 <b>${int(t.occupancy)}</b> aforo máx.</span>`;
  flowMarker = mapView.Markers.add(
    coord(store.door.outside),
    `<div class="flow"><span>⇄ <b>${int(t.pass)}</b> pasan</span><span class="in">↘ <b>${int(t.enter)}</b> entran</span>${inside}</div>`,
    { rank: 'always-visible', placement: ['center'] },
  );
}

// ---- Panel ----

function tile(label: string, k: Kpi, cur: number | null, prev: number | null, note = '') {
  return `<div class="tile"><small>${label}</small><strong>${show(k, cur)}</strong>${delta(k, cur, prev)}${note}</div>`;
}

function renderMall(cur: Totals, prev: Totals) {
  const live = period === 'live';
  const cost = value(cur, 'cost');
  ui.mall.innerHTML = [
    tile('Pasillo frente a tiendas', 'pass', cur.pass, prev.pass),
    tile('Ingresos a tiendas', 'enter', cur.enter, prev.enter),
    tile('Captación', 'capture', value(cur, 'capture'), value(prev, 'capture')),
    tile('Conversión', 'conversion', value(cur, 'conversion'), value(prev, 'conversion')),
    live
      ? tile('Aforo en tiendas ahora', 'occupancy', cur.occupancy, prev.occupancy)
      : `<div class="tile"><small>Ventas declaradas</small><strong>${money(cur.sales ?? 0)}</strong>${delta('enter', cur.sales, prev.sales)}</div>`,
    tile('Costo de ocupación', 'cost', cost, value(prev, 'cost'), cost === null ? '' : `<em class="st ${costStatus(cost)}">${STATUS_LABEL[costStatus(cost)]}</em>`),
  ].join('');
}

/** Entries per hour (one day) or per day (a range), with the rest of the reading in the tooltip. */
function chart(store: Store, dates: Date[], bins: number) {
  type Bar = { label: string; value: number | null; tip: string };
  let bars: Bar[];
  if (dates.length === 1) {
    const day = simulateDay(store.sim, dates[0]);
    let inside = 0;
    bars = Array.from({ length: BINS / 4 }, (_, h) => {
      const from = h * 4, to = Math.min(from + 4, bins);
      const hour = `${fmtTime(OPEN + h * 60)}–${fmtTime(OPEN + (h + 1) * 60)}`;
      if (to <= from) return { label: hour, value: null, tip: '' };
      let pass = 0, enter = 0;
      for (let b = from; b < to; b++) {
        pass += day.pass[b];
        enter += day.enter[b];
        inside += day.enter[b] - day.exit[b];
      }
      const tip = `<b>${hour}</b><span>Ingresos <b>${int(enter)}</b></span><span>Pasillo <b>${int(pass)}</b></span><span>Captación <b>${pct(enter / (pass || 1))}</b></span><span>Aforo al cierre de la hora <b>${int(inside)}</b></span>`;
      return { label: hour, value: enter, tip };
    });
  } else {
    bars = dates.map((d) => {
      const day = simulateDay(store.sim, d);
      const pass = day.pass.reduce((a, b) => a + b, 0), enter = day.enter.reduce((a, b) => a + b, 0);
      const tip = `<b>${weekdayFmt.format(d)}</b><span>Ingresos <b>${int(enter)}</b></span><span>Pasillo <b>${int(pass)}</b></span><span>Captación <b>${pct(enter / pass)}</b></span><span>Tickets <b>${int(day.tickets)}</b></span><span>Conversión <b>${pct(day.tickets / enter)}</b></span>`;
      return { label: dayFmt.format(d), value: enter, tip };
    });
  }

  const W = 360, H = 112, top = 14, base = H - 18;
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0));
  const slot = W / bars.length, w = Math.max(2, slot - 2);
  const r = Math.min(3, w / 2);
  const marks = bars
    .map((b, i) => {
      const x = i * slot + (slot - w) / 2;
      const h = b.value ? Math.max(r, ((base - top) * b.value) / max) : 0;
      const y = base - h;
      const bar = h ? `<path d="M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z" />` : '';
      const hit = b.value === null ? '' : `<rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${base}" data-i="${i}" />`;
      return bar + hit;
    })
    .join('');
  const ticks =
    dates.length === 1
      ? [0, 3, 6, 9].map((h) => `<text x="${h * 4 * (W / BINS) + 2}" y="${H - 4}">${fmtTime(OPEN + h * 60)}</text>`).join('')
      : `<text x="0" y="${H - 4}">${bars[0].label}</text><text x="${W}" y="${H - 4}" text-anchor="end">${bars[bars.length - 1].label}</text>`;
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos ${dates.length === 1 ? 'por hora' : 'por día'}">
    <line class="grid" x1="0" x2="${W}" y1="${top}" y2="${top}" /><text x="0" y="${top - 4}">${int(max)}</text>
    <g class="bars">${marks}</g><line class="axis" x1="0" x2="${W}" y1="${base}" y2="${base}" />${ticks}</svg>`;
  return { svg, bars };
}

function renderStore(store: Store, cur: Totals, prev: Totals, dates: Date[], bins: number) {
  const p = store.sim.profile;
  const cost = value(cur, 'cost');
  const { svg, bars } = chart(store, dates, bins);
  const live = period === 'live';
  ui.store.innerHTML = `
    <header>${logo(store.brand, 'big')}<div><strong>${store.brand.name}</strong><small>${p.label} · ${int(store.sim.area)} m² · contador Vivotek en la puerta</small></div></header>
    <div class="tiles">
      ${tile('Pasillo', 'pass', cur.pass, prev.pass)}
      ${tile('Ingresos', 'enter', cur.enter, prev.enter)}
      ${tile('Captación', 'capture', value(cur, 'capture'), value(prev, 'capture'))}
      ${tile(live ? 'Aforo ahora' : 'Aforo máx.', 'occupancy', cur.occupancy, prev.occupancy)}
      ${tile('Conversión', 'conversion', value(cur, 'conversion'), value(prev, 'conversion'), cur.tickets === null ? '' : `<em>${int(cur.tickets)} tickets</em>`)}
      ${tile('Costo de ocupación', 'cost', cost, value(prev, 'cost'), cost === null ? '' : `<em class="st ${costStatus(cost)}">${STATUS_LABEL[costStatus(cost)]} · ventas ${money(cur.sales!)}</em>`)}
    </div>
    <h3>Ingresos ${dates.length === 1 ? 'por hora' : 'por día'}${live ? ` hasta las ${fmtTime(now)}` : ''}</h3>
    ${svg}`;
  ui.store.querySelectorAll<SVGRectElement>('.hit').forEach((rect) => {
    const bar = bars[Number(rect.dataset.i)];
    const showTip = (e: PointerEvent) => {
      ui.tip.innerHTML = bar.tip;
      ui.tip.hidden = false;
      const { width, height } = ui.tip.getBoundingClientRect();
      ui.tip.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, e.clientX - width / 2))}px`;
      ui.tip.style.top = `${Math.max(8, e.clientY - height - 12)}px`;
      rect.classList.add('on');
    };
    rect.addEventListener('pointerenter', showTip);
    rect.addEventListener('pointermove', showTip);
    rect.addEventListener('pointerleave', () => {
      ui.tip.hidden = true;
      rect.classList.remove('on');
    });
  });
}

function renderRanking(rows: { store: Store; v: number | null; prev: number | null }[]) {
  const max = Math.max(...rows.map((r) => r.v ?? 0)) || 1;
  const sorted = rows.slice().sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  ui.ranking.innerHTML = `<h3>${KPI_LABEL[kpi]} por tienda${kpi === 'cost' ? ' · mayor primero' : ''}</h3>`;
  for (const r of sorted) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rank';
    b.setAttribute('aria-pressed', String(r.store.brand.id === selected));
    const width = r.v === null ? 0 : (r.v / max) * 100;
    b.innerHTML = `${logo(r.store.brand, 'small')}<span class="name">${r.store.brand.name}<small>${r.store.sim.profile.label}</small><i style="width:${width}%"></i></span><span class="val">${show(kpi, r.v)}${delta(kpi, r.v, r.prev)}</span>`;
    b.addEventListener('click', () => select(r.store.brand.id));
    ui.ranking.append(b);
  }
}

function render() {
  const { dates, bins } = periodDays();
  const before = previous(dates);
  ui.clock.innerHTML =
    period === 'live'
      ? `<span class="dot"></span>${fmtTime(now)}`
      : dates.length === 1
        ? dayFmt.format(dates[0])
        : `${dayFmt.format(dates[0])} – ${dayFmt.format(dates[dates.length - 1])}`;

  const cur = stores.map((s) => totals(s, dates, bins));
  const prev = stores.map((s) => totals(s, before, bins));
  renderMall(sum(cur), sum(prev));

  const values = cur.map((t) => value(t, kpi));
  const fill = colours(values);
  stores.forEach((s, i) => {
    mapView.updateState(s.space, { color: fill[i], interactive: true });
    const chip = s.marker.contentEl.querySelector('.pin')!;
    chip.classList.toggle('selected', s.brand.id === selected);
    const v = values[i];
    const status = kpi === 'cost' && v !== null ? ` ${costStatus(v)}` : '';
    chip.querySelector('b')!.className = `val${status}`;
    chip.querySelector('b')!.textContent = v === null ? '—' : show(kpi, v);
  });

  const i = stores.findIndex((s) => s.brand.id === selected);
  renderStore(stores[i], cur[i], prev[i], dates, bins);
  drawCounter(stores[i], cur[i]);
  renderRanking(stores.map((store, j) => ({ store, v: values[j], prev: value(prev[j], kpi) })));
}

function select(id: string) {
  selected = id;
  zoomed = true;
  render();
  const s = stores.find((x) => x.brand.id === id)!;
  // Frame the store together with its counter and flows outside the door.
  const frame = s.door ? [s.space.center, ...[...s.door.corridor, s.door.outside].map(coord)] : [s.space.center];
  void mapView.Camera.focusOn(frame, { screenOffsets: sheetOffsets(), maxZoomLevel: 19.5 });
}

// ---- Setup ----

const metres = (a: LngLat, b: LngLat) => {
  const kx = Math.cos((a[1] * Math.PI) / 180) * 111320;
  return [(b[0] - a[0]) * kx, (b[1] - a[1]) * 110540] as [number, number];
};

function area(space: Space) {
  const ring = (space.geoJSON.geometry as { coordinates: LngLat[][] }).coordinates[0];
  let a = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = metres(ring[0], ring[i - 1]);
    const [x1, y1] = metres(ring[0], ring[i]);
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

function inside([x, y]: LngLat, ring: LngLat[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The counter sits on the store's front: one line on the door, one on the corridor outside. The
 * demo map has no doors, so the front is where the walking route to the nearest mall entrance
 * leaves the store.
 */
async function counterLines(space: Space, entrance: Space | undefined): Promise<Store['door']> {
  if (!entrance) return undefined;
  const route = await mapData.getDirections(space, entrance);
  const ring = (space.geoJSON.geometry as { coordinates: LngLat[][] }).coordinates[0];
  const pts = (route?.coordinates ?? []).map((c): LngLat => [c.longitude, c.latitude]);
  const k = pts.findIndex((p, i) => i > 0 && inside(pts[i - 1], ring) && !inside(p, ring));
  if (k < 1) return undefined;
  const [p, q] = [pts[k - 1], pts[k]];

  // The edge of the store the route crosses, and the crossing point on it.
  for (let i = 1; i < ring.length; i++) {
    const [a, b] = [ring[i - 1], ring[i]];
    const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
    if (!d) continue;
    const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
    const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const x: LngLat = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    const [ex, ey] = metres(a, b);
    const edge = Math.hypot(ex, ey);
    // Normal to the edge, pointing out of the store (towards the route's outside point).
    let [nx, ny] = [-ey / edge, ex / edge];
    const [ox, oy] = metres(x, q);
    if (nx * ox + ny * oy < 0) [nx, ny] = [-nx, -ny];
    const kx = Math.cos((x[1] * Math.PI) / 180) * 111320, ky = 110540;
    const at = (along: number, out: number): LngLat => [x[0] + ((ex / edge) * along + nx * out) / kx, x[1] + ((ey / edge) * along + ny * out) / ky];
    const half = Math.min(1.6, edge * 0.4);
    // The corridor line is wider than the door and a few metres out, so it reads both directions.
    const strip = (len: number, out: number, thick: number): LngLat[] => [
      at(-len, out - thick), at(len, out - thick), at(len, out + thick), at(-len, out + thick), at(-len, out - thick),
    ];
    return { line: strip(half, 0.7, 0.3), corridor: strip(half * 2.6, 4, 0.22), outside: at(0, 9) };
  }
  return undefined;
}

async function init() {
  mapData = await getMapData(MAP_OPTIONS);
  const lower = mapData.getByType('floor').find((f) => f.elevation === 0) ?? mapData.getByType('floor')[0];
  // The demo map paints the anchors' Canadian wordmarks (Nordstrom, H&M, Zara…) on their roofs. They
  // are dropped before the map is drawn so only the Peruvian logos show. Internal data: if a future
  // SDK moves it, the wordmarks simply come back.
  const internal = (mapData as unknown as { internal?: { floorImagesByAnchorId?: Map<string, unknown>; floorImageRecordsByFloorId?: Record<string, unknown> } }).internal;
  internal?.floorImagesByAnchorId?.clear();
  if (internal?.floorImageRecordsByFloorId) for (const k of Object.keys(internal.floorImageRecordsByFloorId)) internal.floorImageRecordsByFloorId[k] = [];
  mapView = await show3dMap($('map'), mapData, { initialFloor: lower });

  // The demo map's store names are Canadian: logos of Peruvian stores take their place (illustrative only).
  mapView.Labels.removeAll();
  const spaces = mapData.getByType('space').filter((s) => s.floor.id === lower.id);
  const entrances = spaces.filter((s) => s.name === 'Entrance');
  const placed = brands.flatMap((brand) => {
    const space = spaces.find((s) => s.name === brand.store);
    return space ? [{ brand, space }] : [];
  });
  const nearestEntrance = (space: Space) => {
    const center: LngLat = [space.center.longitude, space.center.latitude];
    const distance = (e: Space) => Math.hypot(...metres(center, [e.center.longitude, e.center.latitude]));
    const e = entrances.slice().sort((a, b) => distance(a) - distance(b))[0];
    return { entrance: e, distance: e ? distance(e) : 400 };
  };
  const doors = await Promise.all(placed.map(({ space }) => counterLines(space, nearestEntrance(space).entrance).catch(() => undefined)));
  for (const [i, { brand, space }] of placed.entries()) {
    const door = doors[i];
    // Corridors near the mall doors carry more people; anchors also draw their own visitors.
    const toEntrance = Math.min(400, nearestEntrance(space).distance);
    const anchor = brand.category === 'super' || brand.category === 'hogar' ? 1.7 : 1;
    const traffic = (3600 + 6500 / (1 + toEntrance / 70)) * anchor;
    const marker = mapView.Markers.add(space, `<button type="button" class="pin">${logo(brand)}<b class="val"></b></button>`, {
      rank: 'always-visible',
      interactive: 'pointer-events-auto',
    });
    marker.contentEl.querySelector('button')!.addEventListener('click', () => select(brand.id));
    stores.push({ brand, space, door, marker, sim: { id: brand.id, profile: PROFILES[brand.category], traffic, area: area(space), rent: 0, performance: 1 } });
  }
  // Leases are priced on the average corridor; each store then does better or worse than its category.
  const averageTraffic = stores.reduce((a, s) => a + s.sim.traffic, 0) / stores.length;
  stores.forEach((s, i) => {
    s.sim.rent = leaseRent(s.sim.profile, s.sim.area, averageTraffic * (s.brand.category === 'super' || s.brand.category === 'hogar' ? 1.7 : 1));
    s.sim.performance = [1.15, 0.8, 1.05, 0.7, 1.2, 0.95, 0.85, 1.1, 0.9, 1.0][i % 10];
  });
  mapView.on('click', ({ spaces: hit }) => {
    const s = stores.find((x) => hit?.includes(x.space));
    if (s) select(s.brand.id);
  });

  void mapView.Camera.focusOn(stores.map((s) => s.space), { screenOffsets: sheetOffsets() });
  render();
  if (import.meta.env.DEV) Object.assign(window, { mapData, mapView, stores });
}

// ---- Controls ----

ui.from.min = ui.to.min = isoDate(addDays(today, -HISTORY));
ui.from.max = ui.to.max = isoDate(yesterday);
ui.from.value = isoDate(addDays(yesterday, -13));
ui.to.value = isoDate(yesterday);
ui.time.value = String(now);

ui.periodButtons.forEach((b) =>
  b.addEventListener('click', () => {
    period = b.dataset.period as Period;
    ui.periodButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    ui.liveRow.hidden = period !== 'live';
    ui.rangeRow.hidden = period !== 'range';
    if (period !== 'live') stopPlay();
    if (stores.length) render();
  }),
);
ui.kpiButtons.forEach((b) =>
  b.addEventListener('click', () => {
    kpi = b.dataset.kpi as Kpi;
    ui.kpiButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (stores.length) render();
  }),
);
for (const input of [ui.from, ui.to]) input.addEventListener('change', () => stores.length && render());
ui.time.addEventListener('input', () => {
  now = Number(ui.time.value);
  if (stores.length) render();
});

let timer: number | undefined;
function stopPlay() {
  clearInterval(timer);
  timer = undefined;
  ui.play.textContent = '▶ Reproducir';
}
ui.play.addEventListener('click', () => {
  if (timer) return stopPlay();
  ui.play.textContent = '❚❚ Pausa';
  timer = window.setInterval(() => {
    now = now >= CLOSE ? OPEN + BIN : now + BIN;
    ui.time.value = String(now);
    render();
  }, 700);
});

init().catch((e) => {
  console.error(e);
  ui.store.textContent = 'No se pudo cargar el mapa. Revisa la conexión y vuelve a intentar.';
});
