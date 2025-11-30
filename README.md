# Gas Stop Planner (OpenStreetMap Edition)

A free, fully client-side web app that helps you plan fuel stops for long road trips.  
Enter a **start location**, **destination**, and your **vehicle’s driving range**, and the app will:

- Calculate your route (OpenRouteService)
- Predict where your tank will run low based on your range
- Find nearby gas stations using live OpenStreetMap data (Overpass API)
- Display the full route and all recommended fuel stops on an interactive map (Leaflet)

No backend. No billing. No credit card.  
Runs completely in the browser.

---

## 🚀 Features

- **Free routing** using OpenRouteService  
- **Free gas station lookup** using Overpass API  
- **OpenStreetMap tiles** with Leaflet  
- **Dark-mode UI**  
- **Distance-based fuel stop planning**  
- **Works on GitHub Pages or any static host**  
- **Zero costs — fully open-source stack**

---

## 🛠 Tech Stack

| Part | Service |
|------|---------|
| Map rendering | Leaflet.js + OpenStreetMap |
| Routing | OpenRouteService (ORS) |
| Geocoding | ORS Geocoding API |
| Gas stations | Overpass API (OSM POI data) |
| Frontend | HTML, CSS, JavaScript |

---

## 🙌 Credits

This project would not be possible without:

- **OpenStreetMap** — free map data & community contributions

- **Leaflet.js** — lightweight open-source interactive maps

- **OpenRouteService** — free routing and geocoding APIs

- **Overpass API** — free OSM data querying (gas stations, POIs)

- **Open Source Community** — tools, docs, and support

Special thanks to the OSM community for keeping the world’s map data open and accessible for everyone.
