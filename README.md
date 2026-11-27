# Latauskaveri

An EV charging planner, charging-curve simulator, and electricity cost optimizer built with React, Vite, and Express. Includes live Finnish electricity spot prices ([porssisahko.net](https://porssisahko.net)), transfer tariff estimation, and smart start-time recommendations.

**Live app:** https://latauskaveri.johei.fi

> **Note:** The application UI is currently available **in Finnish only**.

## Run locally

```bash
npm install
npm run dev
```

Or with Docker:

```bash
docker build -t latauskaveri .
docker run -p 3000:3000 latauskaveri
```
