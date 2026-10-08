# EnergyRoom 3D – Etap 2 (instalacja elektryczna)

## Łańcuch zasilania (fizyczny model)
Sieć → licznik → wyłącznik główny → rozdzielnica → zabezpieczenia (MCB) → obwody → przewody → gniazdka → (listwy) → urządzenia.

## Nowe pliki
| Plik | Rola |
|---|---|
| `js/data/electrical.js` | Katalog: gniazdko, listwa, rozdzielnica, licznik; przewody YDY 1,5–10 mm² (obciążalność, cena, robocizna); zabezpieczenia 6–40 A (B/C); wyłączniki główne 16–63 A; stałe |
| `js/energy/ElectricalSystem.js` | Cała logika (czysta, bez THREE/DOM): przepływ prądu, spadek napięcia i straty I²R, krzywe czasowo-prądowe, zabezpieczenia, koszty, diagnostyka, ślad zasilania, autoinstalacja |
| `js/scene/WireRenderer.js` | Rysowanie przewodów (rury 3D po tej samej trasie, którą mierzy i wycenia logika; kolor = obciążenie) |
| `js/ui/InstallationPanel.js` | Okno „Instalacja”: obwody i zabezpieczenia, gniazdka i przewody, urządzenia, koszt |
| `tests/electrical.test.js`, `integration_stage2.test.js`, `browser_installation.test.js`, `models.test.js` | 33 + 12 + 21 + 2 testy |

## Zachowanie
- Gniazdka, listwy, rozdzielnica i licznik to zwykłe obiekty sceny (`kind:'electrical'`): zaznaczanie, przesuwanie, przyciąganie do siatki, cofnij/ponów i zapis działają jak dla reszty.
- Każdy obwód: napięcie, prąd i moc maksymalna (min. z zabezpieczenia i przewodu), prąd/moc aktualne, stan zabezpieczenia.
- Zabezpieczenie: charakterystyka termiczna (≤1,13 In brak zadziałania, ~60 min przy 1,45 In, ~30 s przy 2,55 In) + człon zwarciowy (B: 5 In, C: 10 In). Mały nadmiar trwa godzinami, duży sekundy.
- Zbyt duże zabezpieczenie na cienkim przewodzie: przewód się przegrzewa i ulega uszkodzeniu (wymiana kosztuje), zabezpieczenie nie zadziała.
- Listwa: własne zabezpieczenie 10 A. Wyłącznik główny chroni cały dom.
- Zadziałanie odcina urządzenia w tej samej minucie; do czasu ręcznego załączenia obwód jest martwy.
- Straty w przewodach (I²R) są realną, rozliczaną energią (kategoria „Instalacja”).
- Koszt: przewody (z rzeczywistej długości), gniazdka, rozdzielnica, zabezpieczenia, robocizna; amortyzacja na 25 lat wchodzi do rocznego kosztu projektu (dashboard).

## Migracja
Zapis v5. Starsze projekty (v3/v4) dostają wygenerowaną instalację: licznik + rozdzielnica, 4 gniazdka w każdym pokoju (dawne dekoracyjne gniazdka są teraz prawdziwe) na obwodzie B16/2,5 mm², urządzenia ≥ 3 kW na własnym obwodzie, wszystkie urządzenia podpięte do najbliższych gniazdek.
Tryb „wymagaj gniazdka” (domyślnie włączony) można wyłączyć w oknie Instalacja (tryb zgodności: urządzenia bez gniazdka działają bez limitów).

## Wydajność
Cache harmonogramów (`ScheduleManager.normalizeShared`), pozycji słońca i rezystancji przewodów. 120 dni symulacji bez instalacji: 3,8 s → 0,9 s.
