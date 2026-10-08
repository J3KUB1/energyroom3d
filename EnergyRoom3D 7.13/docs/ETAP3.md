# EnergyRoom 3D – Etap 3 (projektant domu, piętra, ściany, drzwi, okna, dach)

## Nowe pliki
| Plik | Rola |
|---|---|
| `js/data/building.js` | Materiały ścian (λ, gęstość, ciepło właściwe), szyby (U, g), drzwi, dachy, stałe konstrukcyjne, nowe typy pomieszczeń (gospodarcze, piwnica, balkon, taras, ogród) |
| `js/energy/BuildingModel.js` | Czysta logika: piętra, sąsiedztwo pomieszczeń i wspólne ściany, otwory (walidacja), przegrody, schody, dach (połacie), obwiednia cieplna, geometria cieni, migracja starych domów |
| `js/ui/DesignerPanel.js` | Panel „Projektant domu”: piętra i pomieszczenia, ściany i otwory, przegrody i schody, dach, bilans cieplny |
| `tests/building.test.js`, `roombuilder.test.js`, `integration_stage3.test.js`, `browser_designer.test.js`, `fakeapp.js` | 29 + 13 + 9 + 25 testów |

## Model danych domu (zapis v6)
`house = { rooms[], levels[], stairs[], layout: 'auto'|'free', levelView, activeLevelId }`.
Pokój: `levelId`, `offsetX`, `offsetZ`, `design = { walls{N,E,S,W:{material, insulationCm}}, frontWall, openings[], partitions[], floorInsulationCm, roof{type,pitchDeg,overhang,facing,pvSlope,insulationCm} }`.
Pozycja otworu `pos` liczona od pierwszego rogu ściany, idąc zgodnie z ruchem wskazówek zegara patrząc z góry (N: zachód→wschód, E: północ→południe, S: wschód→zachód, W: południe→północ).
Stare projekty: jedno piętro („Parter”), projekt każdego pokoju odtwarza dotychczasowy wygląd (okno na N, drzwi na E, brama garażowa i dach jednospadowy w garażu), układ `auto` (pokoje obok siebie z przerwą 1,4 m).

## Wpływ elementów budynku na symulację (już działa)
- **Dach → PV:** panele montują się na każdej połaci jedno- lub dwuspadowej (połać A / B); orientacja paneli wynika z prawdziwej geometrii połaci; panel pokazuje przydatność połaci (rocznie względem optimum).
- **Piętra, dachy, ściany, drzewa → cienie:** cała bryła (wszystkie piętra, połacie, tarasy) trafia do `ShadeModel`, więc np. wyższy blok zacienia dach garażu, a dach przykryty piętrem znika.
- **Instalacja:** gniazdka i rozdzielnica mogą być na dowolnym piętrze; długość i koszt przewodów liczone z prawdziwych wysokości, `offsetZ` i przejść między piętrami.
## Gotowe dla Etapu 4 (temperatura)
`BuildingModel.compile(house)` (dostępne jako `window.EnergyRoom3D.getBuilding()`) zwraca dla każdego pomieszczenia: UA ścian/okien/drzwi/podłogi/dachu, wentylację, pojemność cieplną, sprzężenia z sąsiadami (ściana, drzwi, strop, podłoga), powierzchnie i azymuty okien, `designHeatLossW()` i `solarGainW()`.

## Zmiana zachowania (błąd w oryginale)
Dach garażu był nachylony w złą stronę (`rotation.x = -pitch`): panele patrzyły na **północ** (azymut 0°), choć komentarz i konwencja sceny zakładały front = południe. Nowy dach (`+pitch`) daje azymut 180°. Test regresji: `roombuilder.test.js`.
