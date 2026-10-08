# EnergyRoom 3D — architecture overview

The project is organized around a few clear responsibilities: data models, energy logic, scene rendering, UI handling, and project persistence.

## High-level structure

- `js/data/` — catalogs and static models for furniture, devices, tariffs, electrical components, and building materials
- `js/energy/` — simulation logic for solar, schedule, battery, building energy, and overall dispatch
- `js/scene/` — 3D construction of rooms, objects, environmental systems, and rendering helpers
- `js/ui/` — panels and interaction tools for editing the home design and installation
- `js/project/` — project save/load and migration logic
- `js/i18n/` — translation and content catalog system
- `tests/` — targeted checks for logic, UI workflows, and integration flows

## Core flow

1. The user creates the building via the designer and/or room builder.
2. The scene system turns the building model into visible objects.
3. The data layer defines available devices, solar setups, and installation components.
4. The energy modules calculate generation, demand, battery operation, and grid exchange.
5. The UI exposes tables, alerts, and summary metrics.
6. The project manager saves and restores the current house configuration.

## Main simulation concerns

### Energy and dispatch

The energy system is responsible for how loads, PV, storage, and the grid interact. It tracks load allocation order, curtailment, reserve levels, and import/export limits.

### Solar and shading

Solar calculations depend on time, date, weather, roof geometry, and the shade model. The shading model approximates how surrounding elements reduce direct irradiation on PV surfaces.

### Electrical safety

The installation subsystem models protection devices, circuit loading, breaker behavior, conductor resistance, and fault conditions. This is important because the project aims to be plausible as a real design tool, not just a toy energy dashboard.

### Building geometry

The building model handles rooms, floors, walls, roof planes, openings, stairs, and environmental geometry. This allows solar access and shadowing to be evaluated in a more meaningful way than a simple flat plan.

## Why the system is modular

The project is intentionally separated into domains so that:

- logic is easier to test
- the UI can evolve without destroying the model
- new features can be added without rewriting the entire simulator
- simulation behavior can be validated independently from rendering

## Best places to start when editing

- `js/energy/SimulationEngine.js` — central energy flow and priority logic
- `js/energy/SolarCalculator.js` — production and irradiation calculations
- `js/energy/ElectricalSystem.js` — circuit logic and protection math
- `js/scene/RoomBuilder.js` and `EnvironmentBuilder.js` — building and scene composition
- `js/project/ProjectManager.js` — versioned persistence and migrations
- `js/ui/UIManager.js` — overall user interaction layer

## Design principle

The strongest architectural choice is to keep logic deterministic and testable. The code is split into clean modules with distinct responsibilities, which makes the project easier to evolve and reason about over time.
