# Instrukcja obsługi EnergyRoom 3D

> Instrukcja dla aktualnej wersji projektu znajdującej się w katalogu **EnergyRoom3D 7.11**.

## 1. O aplikacji

EnergyRoom 3D to interaktywny symulator domu. Pozwala projektować pomieszczenia, ustawiać meble i urządzenia, konfigurować instalację elektryczną, fotowoltaikę, magazyn energii i automatyzacje.

Aplikacja pokazuje zużycie energii, produkcję PV, pobór i oddanie do sieci, bilans, koszty, magazyn energii, pogodę, dzień i noc, zacienienie PV, instalację elektryczną, harmonogramy, modernizacje, audyt, wyzwania i raporty.

## 2. Uruchomienie

Uruchom aplikację w przeglądarce. Przy pierwszym uruchomieniu wybierz tryb, cenę energii i opcjonalnie nazwę zwierzaka. Dostępne są tryby **Arcade**, **Realistic** i **Edukacyjny**. Tryb można później zmienić.

## 3. Główny ekran

Górny pasek zawiera: **Edycja**, **Symulacja**, **Cofnij**, **Ponów**, **Zapisz**, **Wczytaj**, **Pokój**, **Smart Home**, **Dashboard**, **Plan dnia**, **Dom**, **Wyzwania**, **Audyt**, **Modernizacje**, **Raport**, **Instalacja PV**, **Projektant**, **Instalacja**, **Ustawienia** i przycisk **Instrukcja**. Funkcje zaawansowane mogą być ukryte w trybie Edukacyjnym.

## 4. Tryby pracy

**Arcade** upraszcza korzystanie z symulatora. **Realistic** uwzględnia bardziej szczegółowo pogodę, temperaturę, sezon, ogrzewanie, PV, baterię, taryfy i instalację. **Edukacyjny** upraszcza interfejs i zawiera Małe laboratorium energii oraz przewodnik.

## 5. Pomieszczenia i poziomy

Przełączaj pomieszczenia na pasku nad sceną. W rozbudowanym domu można przełączać poziomy. Dostępne są m.in. pokój, garaż, kuchnia, łazienka, salon, biuro, piwnica, balkon, taras i ogród. Widok **Cały dom** pokazuje całość, a suwak ścian zmienia ich widoczność.

## 6. Dodawanie urządzeń i mebli

W lewej bibliotece wybierz kategorię, kliknij element i zostanie on dodany do aktywnego pomieszczenia. Następnie zaznacz go i ustaw położenie oraz właściwości.

## 7. Obiekty i transformacje

Kliknięcie obiektu otwiera panel właściwości. **W** przesuwa, **E** obraca, **R** skaluje, **F** skupia kamerę, **Ctrl+D** duplikuje, a **Delete** usuwa. Podwójne kliknięcie urządzenia może przełączać jego stan.

## 8. Siatka i kamera

Siatka obsługuje odstępy 0,1 m, 0,25 m i 0,5 m. Obrót może być ustawiony na 15, 30 lub 45 stopni. **G** przełącza siatkę. Widoki kamery: Home, Top, Front, Left i Right. W aktualnej wersji siatka może startować jako wyłączona.

## 9. Dzień, noc, pogoda i sezon

Suwak czasu zmienia słońce, jasność, cienie, niebo, gwiazdy, księżyc, oświetlenie i produkcję PV. Pogoda wpływa na światło, temperaturę i PV. W trybie Realistic sezon wpływa także na temperaturę oraz zapotrzebowanie na ogrzewanie i chłodzenie.

## 10. Symulacja

W trybie **Symulacja** użyj **Play**, **Pause**, **1x**, **10x**, **60x** lub **600x**. Dostępne są szybkie przejścia do 06:00, 12:00, 18:00 i 00:00. **Space** uruchamia lub zatrzymuje symulację.

## 11. Monitor energii

Dolny monitor pokazuje m.in. zużycie teraz, produkcję PV, bilans netto, dzisiejsze zużycie, zużycie miesięczne, pobór z sieci, oddanie do sieci, cenę teraz, koszt dziś, miesiąca i roku, liczbę aktywnych urządzeń, CO2 oraz stan baterii. Panel można rozwinąć i zwinąć.

## 12. Dashboard

Dashboard zawiera wykresy mocy, zużycia, kosztów, PV, przepływu z siecią i baterią. Ranking pokazuje urządzenie, moc, kWh/dzień, kWh/miesiąc, koszt i udział w zużyciu. Dodatkowe zakładki to **Efektywność**, **Energia**, **Statystyki**, **Ceny energii**, **Oszczędności**, **Scenariusze**, **Co jeśli?** i **Porównanie**.

## 13. Taryfy i ceny

Obsługiwane są **G11, G12, G12w i G13**. Ceny mogą zależeć od godziny. Ma to wpływ na urządzenia, samochód elektryczny, baterię i harmonogramy.

## 14. Plan dnia

**Plan dnia** służy do planowania pracy urządzeń i czynności zależnych od czasu. Pozwala sprawdzać wpływ godzin pracy na zużycie, koszty, PV i baterię.

## 15. Panele PV

**Instalacja PV** służy do montażu paneli. Na produkcję wpływają godzina, data, słońce, pogoda, zachmurzenie, orientacja, nachylenie i zacienienie. Panele mogą być montowane na odpowiednich połaciach dachu.

## 16. Zacienienie PV

Produkcję mogą ograniczać budynki, ściany, dachy, drzewa, inne panele i inne przeszkody. Konstrukcja domu może więc bezpośrednio zmieniać produkcję PV.

## 17. Priorytet energii PV

Można ustawić kolejność wykorzystania energii między **Domem**, **Baterią** i **Siecią**, np. **Dom → Bateria → Sieć** albo **Bateria → Dom → Sieć**. Wybrany priorytet zmienia przepływy energii.

## 18. Magazyn energii

Magazyn obsługuje poziom naładowania, rezerwę, maksymalną moc ładowania i rozładowania oraz pracę z taryfami. Przy taryfach z tańszymi godzinami może korzystać z tańszych okien. Przy taryfie płaskiej nie ma korzyści z samego przesuwania ładowania w czasie.

## 19. Samochód elektryczny

Ładowarka uwzględnia pojemność baterii, poziom naładowania, maksymalną moc, limit poboru domu, źródło energii i taryfę. Ładowanie jest ograniczane przez ustawiony limit poboru domu.

## 20. Instalacja elektryczna

Model obejmuje sieć, licznik, wyłącznik główny, rozdzielnicę, zabezpieczenia, obwody, przewody, gniazdka, listwy i urządzenia. System może wykrywać przeciążenia oraz problemy z połączeniami. Przewody są wizualizowane.

## 21. Projektant domu

Projektant obsługuje poziomy, pomieszczenia, ściany, drzwi, okna, ścianki działowe, schody, dachy, balkony, tarasy i ogród. Konstrukcja wpływa na PV, cienie i instalację.

## 22. Smart Home i harmonogramy

Smart Home automatyzuje urządzenia na podstawie czasu, harmonogramów i warunków symulacji. Harmonogramy pozwalają np. uruchamiać komputer po południu, światło wieczorem albo ładować samochód w tańszej taryfie.

## 23. Dom i utrzymanie

Panel **Dom** obejmuje funkcje związane z mieszkańcami, utrzymaniem, scenariuszami i działaniem gospodarstwa.

## 24. Modernizacje

Panel **Modernizacje** pozwala instalować ulepszenia, np. energooszczędne oświetlenie, efektywniejsze urządzenia, modernizację klimatyzacji, rozbudowę PV i baterii. Ulepszenia mogą zmieniać zużycie, produkcję, pojemność lub koszty.

## 25. Audyt energetyczny

**Audyt** analizuje zużycie, koszty, PV, wykorzystanie własnej energii, pobór z sieci, instalację i cele budżetowe. Część wyników wymaga pełnego dnia danych z symulacji.

## 26. Wyzwania

**Wyzwania** zawierają cele do wykonania podczas symulacji. Niektóre są ograniczone do konkretnych trybów. Przykładowo wyzwanie awarii sieci wymaga trybu Realistic i sprawdza działanie domu bez sieci.

## 27. Raport

**Raport** podsumowuje zapisane dane symulacji, m.in. całkowite zużycie, koszt, PV, pobór, oddanie do sieci, koszt ładowania EV i wynik efektywności.

## 28. Osiągnięcia

Osiągnięcia mogą dotyczyć niskiego zużycia, PV, maksymalnej mocy, działania podczas awarii, produkcji solarnej i bilansu energii. Postęp i punkty są zapisywane.

## 29. Zwierzak

Zwierzak pokazuje porady, reaguje na symulację, wykonuje zadania i może zdobywać doświadczenie. Nazwę można ustawić przy pierwszym uruchomieniu. W trybie Edukacyjnym może pełnić funkcję przewodnika.

## 30. Zapis, import i eksport

**Zapisz** przechowuje projekt lokalnie, w tym pomieszczenia, poziomy, konstrukcję, urządzenia, PV, baterię, instalację, taryfy, harmonogramy, automatyzacje i ustawienia. Projekt można eksportować i importować jako JSON. Przed większymi zmianami warto wykonać kopię.

## 31. Cofanie zmian

**Ctrl+Z** cofa zmianę, a **Ctrl+Y** ją ponawia. Historia zmian projektu nie cofa czasu przeprowadzonej symulacji.

## 32. Szybki start

1. Wybierz tryb. 2. Wybierz pomieszczenie. 3. Dodaj meble i urządzenia. 4. Ustaw harmonogramy. 5. Wybierz taryfę. 6. Dodaj PV i baterię, jeśli są potrzebne. 7. Ustaw priorytet PV. 8. Uruchom symulację. 9. Sprawdź Dashboard. 10. Użyj Audytu i Raportu.

## 33. Przykładowy scenariusz

W trybie Realistic dodaj komputer, monitor i lampę, ustaw ich harmonogram, zamontuj PV na dachu, sprawdź zacienienie, dodaj baterię, ustaw priorytet PV, uruchom symulację 60x, sprawdź Dashboard, Audyt i Raport, a następnie zmień harmonogram i porównaj wyniki.

## 34. Skróty

| Skrót | Działanie |\n|---|---|\n| W | Przesuwanie |\n| E | Obracanie |\n| R | Skalowanie |\n| F | Skupienie widoku |\n| G | Siatka |\n| Ctrl+Z | Cofnięcie |\n| Ctrl+Y | Ponowienie |\n| Ctrl+D | Duplikowanie |\n| Delete | Usunięcie |\n| Space | Start / pauza symulacji |

## 35. Rozwiązywanie problemów

**Obiekt jest w złym miejscu:** użyj Move, Grid i Snap. **Nie ma urządzenia:** sprawdź inne kategorie. **Symulacja nie działa:** wybierz Symulację i Play. **Koszt jest nieprawidłowy:** sprawdź taryfę, ceny, czas i pobór z sieci. **PV produkuje mało:** sprawdź godzinę, pogodę, sezon, orientację, nachylenie i cień. **Bateria nie ładuje się:** sprawdź SOC, rezerwę, moc, priorytet PV i produkcję. **EV ładuje się wolno:** sprawdź moc, limit domu, SOC, źródło, taryfę i harmonogram. **Audyt nie kończy się:** wykonaj pełny dzień symulacji. **Wyzwanie nie zalicza się:** sprawdź wymagany tryb. **Brak projektu:** sprawdź tę samą przeglądarkę albo użyj JSON.

## 36. Najważniejsze części

Projektowanie domu, urządzenia, symulacja, energia, PV, magazyn energii, instalacja elektryczna, Smart Home, Dashboard, Projektant, Plan dnia, Modernizacje, Audyt, Wyzwania, Raport, Osiągnięcia, Zwierzak, tryby Arcade/Realistic/Edukacyjny oraz zapis projektu.

## 37. Cel aplikacji

EnergyRoom 3D łączy projektowanie domu z symulacją energetyczną. Pozwala sprawdzać, jak urządzenia, harmonogramy, pogoda, taryfa, PV, bateria, instalacja elektryczna i konstrukcja domu wpływają na zużycie energii i koszty.

