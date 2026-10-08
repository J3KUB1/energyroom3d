# EnergyRoom 3D – Etap 1 (tłumaczenia, priorytet PV, dzień/noc, siatka, cieniowanie PV)

## Nowe pliki
| Plik | Rola |
|---|---|
| `js/energy/ShadeModel.js` | Uproszczony model geometryczny cieni (OBB + sfery, promień na próbkę panelu, cache) – czysta matematyka, testowalna w Node |
| `js/scene/DayNightCycle.js` | Słońce z daty (SunPosition), kolor/intensywność światła, kopuła nieba, gwiazdy, księżyc, fazy dnia |
| `js/ui/PriorityList.js` | Wizualna, przeciągana lista 3 pozycji (Dom / Bateria / Sieć) |
| `js/i18n/catalog_en.js` | Angielskie opisy edukacyjne i noty źródłowe katalogu urządzeń/PV/baterii |
| `tests/*` | 5 zestawów testów (69 testów), `tests/run_all.sh` |

## Rozbudowane istniejące systemy (bez duplikatów)
- `SimulationEngine`: jeden alokator `_allocate()` zastępuje dwie gałęzie home_first/battery_first. Obsługuje 6 kolejności,
  limit eksportu/importu, rezerwę SOC, awarię sieci (`gridOnline`), ograniczanie PV (curtailment), `flows` i `unservedW`.
- `SolarCalculator`: udział światła rozproszonego + bezpośredniego (cień obniża tylko bezpośrednie), `resolveDetailed()`.
- `ObjectManager`, `RoomBuilder`, `EnvironmentBuilder`: geometria paneli, okluzory budynków i drzew, sezonowy wygląd, drzewa deterministyczne.
- `TransformManager`: przyciąganie w układzie pomieszczenia (dokładnie do linii siatki).
- `SceneManager`: stary `GridHelper` usunięty (siatka w RoomBuilder), niebo/oświetlenie przez DayNightCycle.
- `ProjectManager`: wersja zapisu 4 + migracja z v3 (`pvPriority` -> `pvOrder`, limity, rezerwa baterii).
- `I18n`: liczba mnoga PL/EN, `roomType`, `petStage`, `deviceEdu`, `sourceNote`, formatery.

## Format zapisu v4 (energy)
`pvOrder: ['home'|'battery'|'grid' x3]`, `exportLimitW`, `importLimitW` (null = brak), `batteryReservePct`.
Stare projekty: `battery_first` -> `['battery','home','grid']`, rezerwa 0 % (zachowanie jak dotąd).
Nowe projekty: rezerwa baterii 10 %.
