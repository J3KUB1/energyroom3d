# EnergyRoom 3D

EnergyRoom 3D is a browser-based home energy design simulator. It lets you place rooms, furniture, appliances, solar panels, batteries, and electrical installation elements, then model energy flows, costs, tariffs, and comfort over time.

## Why this project matters

The core value is not only the 3D visualization, but the educational simulation of how a real home behaves:

- devices consume power according to realistic operating profiles
- PV generation changes with time of day, season, and shading
- battery storage shifts load between solar generation and later demand
- electrical installation affects safety, losses, and total cost
- design decisions can be evaluated with clear cost and energy KPIs

## Quick start

1. Open `index.html` in a browser, or use a local static server.
2. Create rooms and furniture in the designer.
3. Add appliances and PV/battery installation.
4. Run the simulation and review energy, cost, and import/export balances.
5. Iterate on building layout and equipment to improve performance.

## Main folders

- `js/` — application logic and modules
- `css/` — styling for the app and docs
- `docs/` — project documentation, architecture, and release notes
- `tests/` — unit and integration tests
- `icons/` — app icons and manifest assets

## Documentation

- `docs/README.md` — documentation hub
- `docs/USER_GUIDE.md` — beginner-focused quick guide
- `docs/ARCHITECTURE.md` — system structure overview
- `docs/ETAP1.md` — PV / daylight / shading / priority updates
- `docs/ETAP2.md` — electrical installation and protection logic
- `docs/ETAP3.md` — building designer and roof geometry work

## Typical user flow

- Design the building layout
- Place rooms, walls, openings, and roof elements
- Add electrical points, devices, and appliances
- Define PV and storage configuration
- Run the simulation and compare scenarios
- Optimize the home for energy bill reduction and system reliability

## Project status

This project is a structured experimental prototype with modular logic and a growing set of validated scenarios. The most developed parts are the simulation engine, building model, electrical system, and seasonal / solar behavior.

## Running tests

The project includes browser-oriented and Node-friendly test files in `tests/`.

Typical usage:

```bash
cd "nowy/EnergyRoom3D 7.12"
./tests/run_all.sh
```

If the shell script is not executable, run it via Bash:

```bash
bash ./tests/run_all.sh
```
