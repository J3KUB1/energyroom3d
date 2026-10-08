# EnergyRoom 3D — documentation hub

This folder keeps the key project documentation in one place. It explains what the project is, what it simulates, how the system is organized, and which phases of development introduced the major features.

## Documentation map

- `USER_GUIDE.md` — quick start and practical usage guide for new users
- `ARCHITECTURE.md` — overview of the model, logic, and data flow
- `ETAP1.md` — daylight, shading, PV priority, translations, and simulation details
- `ETAP2.md` — electrical installation, protection logic, wiring, and safety behavior
- `ETAP3.md` — building design, rooms, openings, roofs, and environmental geometry

## Project goals

EnergyRoom 3D helps users understand how a house performs as a complete energy system:

- how much power devices consume at different times of day
- how much solar energy the roof can generate
- how storage shifts demand and reduces bill peaks
- how wiring and protection influence reliability and safety
- how building design and layout affect thermal and solar conditions

## Recommended reading order

1. Read `USER_GUIDE.md` for a practical introduction.
2. Read `ARCHITECTURE.md` to understand where the logic lives.
3. Dive into the relevant ETAP document depending on the feature you want to study.

## Common project terminology

- PV: photovoltaic panels
- SOC: state of charge for the battery
- Curtailment: limiting solar production when there is no demand or export capacity
- Grid import/export: energy purchased from or sold to the external grid
- Shade model: simplified representation of shadows cast on PV surfaces

## Suggested workflow for contributors

- start with the user guide to understand the product intent
- inspect the architecture to locate the module you need
- read the latest ETAP document for the feature area under change
- validate with the relevant test group in `tests/`

## A quick structure reminder

The simulator is split by concern rather than by page only:

- data modules define building, devices, tariffs, and electrical catalogs
- energy modules compute generation, consumption, and flows
- scene modules transform the model into visible 3D rooms and elements
- UI modules expose editing and installation tools to the user
