# Store KPIs · Mappedin demo

**How is each store doing, seen on the mall map?** A web demo on Mappedin JS v6 that puts the numbers a mall gets from its people counters and its tenants' daily reports on the map: footfall in front of each store, entries, live occupancy, capture rate, conversion rate and occupancy cost.

- Live (Spanish): https://store-kpis-demo.atlas-lac.com/ (once published)

## Where the numbers come from

Each store has a **Vivotek people counter** over its door with two counting lines:

- **Door line:** people in and out. Entries give the store's footfall; entries minus exits give the **live occupancy** (reset at closing time).
- **Corridor line:** people walking past the store front in both directions. Only the **sum of both directions** is shown.

Each store also reports its **tickets** and **sales** for the day. From those:

| KPI | Formula |
|---|---|
| Capture rate | entries ÷ passers-by |
| Conversion rate | tickets ÷ entries (needs the daily report, so today shows "al cierre") |
| Occupancy cost | (rent + common charges) ÷ sales. Up to 10 % healthy, 10–15 % watch, over 15 % at risk |

Every KPI is shown for **today (live)**, **yesterday**, **the last 7 or 30 days** or **a custom date range**, compared with the previous period of the same length (a single day compares with the same weekday of the week before).

## What it shows

- **The map coloured by the chosen KPI**, one hue from light to dark, or healthy / watch / at risk for occupancy cost. Each store has its logo and its value.
- **The counter on the store front.** Picking a store zooms to it and draws the door line (blue) and the corridor line (black) with the flows: passing, entering and inside now.
- **Store card** with the six KPIs, their change and a chart of entries per hour (one day) or per day (a range), with the full reading in the tooltip.
- **Ranking** of the stores by the chosen KPI.
- **Replay the day** to watch the live occupancy and flows move from 10:00 to 22:00.

## Map and data

- Mappedin's Enterprise demo venue **Mall** (`mappedin-demo-mall`) with the public demo key from the [Mappedin docs](https://developer.mappedin.com/docs/demo-keys-and-maps). Override with `VITE_MAPPEDIN_KEY`, `VITE_MAPPEDIN_SECRET`, `VITE_MAPPEDIN_MAP_ID` in `.env`.
- The demo map's Canadian store names and the wordmarks painted on the anchors' roofs (Nordstrom, H&M, Zara…) are removed. Twenty stores on the Lower Level take Peruvian brands with their logos (`src/brands.ts`, the same logos as the Theme Trails demo). **Illustrative only: the brands do not take part in or endorse this demo.**
- The demo map has no doors, so the store front is where the walking route to the nearest mall entrance leaves the store. With a real venue it would be the counter's position.
- Counts, tickets and sales are simulated per store and day (`src/model.ts`): lunch and evening peaks, weekends and paydays busier, restaurants peaking at meal times, and a stay time per category that turns entries into exits. Rents are set from each category's typical occupancy cost on an average corridor, so stores that capture or convert better end up healthier.

## Run

```bash
npm install
npm run dev
```

`npm run build` type-checks and builds to `dist/`. Pushing to `main` deploys to GitHub Pages.

Built by Felipe Chavarri. Companion to [Predictive Parking](https://github.com/fchavarrix/mappedin-predictive-parking) and [Theme Trails](https://github.com/fchavarrix/mappedin-theme-trails).
