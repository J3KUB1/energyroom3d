# Instrukcja obsługi EnergyRoom 3D

## 1. O aplikacji

EnergyRoom 3D to interaktywny symulator domu, w którym można zaprojektować pomieszczenia, ustawić meble i urządzenia, skonfigurować instalację elektryczną, panele fotowoltaiczne oraz magazyny energii.

Aplikacja oblicza między innymi:

- aktualne zużycie energii,
- produkcję energii z paneli PV,
- bilans energii,
- zużycie w kWh,
- koszt energii w PLN,
- szacowany koszt miesiąca i roku,
- szacowaną emisję CO2,
- pracę magazynu energii,
- zużycie poszczególnych urządzeń.

Aplikacja działa w przeglądarce i może być używana bez konta.

## 2. Uruchomienie

1. Otwórz stronę EnergyRoom 3D.
2. Wybierz przycisk wejścia do symulatora.
3. Po uruchomieniu pojawi się widok domu 3D.
4. Na początku dostępny jest tryb Edycja.
5. Zaznacz obiekt lub pomieszczenie, aby rozpocząć pracę.

Aplikacja może również zostać zainstalowana jako aplikacja przeglądarkowa na urządzeniu obsługującym PWA.

## 3. Główny ekran

### Górny pasek

W górnym pasku znajdują się:

- **Edycja** - budowanie i zmienianie domu.
- **Symulacja** - uruchamianie obliczeń zużycia energii.
- **Cofnij** - cofa ostatnią zmianę.
- **Ponów** - przywraca cofniętą zmianę.
- **Zapisz** - zapisuje projekt na urządzeniu.
- **Wczytaj** - wczytuje zapisany projekt.
- **Pokój** - ustawienia pomieszczeń.
- **Smart Home** - ustawienia automatyzacji.
- **Dashboard** - szczegółowe informacje o energii.
- **Instalacja PV** - ustawianie paneli fotowoltaicznych.
- **Projektant** - rozbudowa domu.
- **Instalacja** - konfiguracja instalacji elektrycznej.
- **Ustawienia** - ustawienia aplikacji i symulacji.

Nazwę projektu można zmienić, klikając nazwę projektu w górnej części ekranu.

## 4. Pomieszczenia

Na pasku pod górnym menu znajdują się pomieszczenia.

Kliknięcie pomieszczenia pokazuje jego widok.

Dostępne są między innymi:

- pokój,
- garaż,
- kuchnia,
- łazienka,
- salon,
- biuro,
- pomieszczenie gospodarcze,
- piwnica,
- balkon,
- taras,
- ogród.

W zależności od projektu dostępne mogą być również dodatkowe poziomy domu.

### Widok całego domu

Przycisk **Cały dom** pokazuje wszystkie pomieszczenia jednocześnie.

### Widoczność ścian

Suwak znajdujący się po prawej stronie paska pomieszczeń pozwala zmienić widoczność ścian.

- zamknięty widok pokazuje pełne ściany,
- częściowe przesunięcie suwaka pokazuje ściany częściowo,
- otwarty widok pozwala oglądać wnętrze domu z większej perspektywy.

## 5. Dodawanie urządzeń i mebli

Po lewej stronie znajduje się lista elementów.

Elementy są podzielone na kategorie.

Aby dodać element:

1. Wybierz kategorię.
2. Znajdź urządzenie lub mebel.
3. Dodaj go do sceny.
4. Zaznacz dodany obiekt.
5. Ustaw jego położenie i właściwości.

Aplikacja posiada dużą bibliotekę urządzeń oraz mebli.

## 6. Zaznaczanie obiektu

Kliknij obiekt w scenie 3D.

Po zaznaczeniu po prawej stronie pojawi się panel właściwości.

Można tam zmieniać informacje dotyczące obiektu, w tym jego ustawienia oraz stan pracy, jeśli dany obiekt jest urządzeniem.

Urządzenie można również szybko włączyć lub wyłączyć przez podwójne kliknięcie.

## 7. Przesuwanie, obracanie i skalowanie

Narzędzia nad sceną pozwalają zmienić obiekt.

### Przesuwanie

Wybierz **Move** albo użyj klawisza **W**.

Następnie przeciągaj uchwyty obiektu.

### Obracanie

Wybierz **Rotate** albo użyj klawisza **E**.

### Skalowanie

Wybierz **Scale** albo użyj klawisza **R**.

### Pozostałe narzędzia

- **Focus / F** - skupia widok na zaznaczonym obiekcie.
- **Duplikuj / Ctrl+D** - tworzy kopię obiektu.
- **Usuń / Delete** - usuwa zaznaczony obiekt.

## 8. Siatka i przyciąganie

Podczas pracy można włączyć lub wyłączyć siatkę.

Dostępne są ustawienia:

- siatka,
- przyciąganie do siatki,
- odstęp siatki 0,1 m,
- odstęp siatki 0,25 m,
- odstęp siatki 0,5 m,
- obrót co 15 stopni,
- obrót co 30 stopni,
- obrót co 45 stopni.

Siatka ułatwia równe ustawianie elementów.

## 9. Widok kamery

Dostępne są podstawowe widoki:

- Home,
- Top,
- Front,
- Left,
- Right.

Pozwalają szybko przełączać perspektywę.

## 10. Cykl dnia i nocy

Pod sceną znajduje się suwak czasu.

Można ustawić godzinę od 00:00 do 24:00.

Zmiana godziny wpływa na wygląd sceny:

- położenie słońca,
- jasność,
- cienie,
- wygląd nieba,
- widoczność gwiazd,
- oświetlenie pomieszczeń,
- działanie paneli PV.

Dzięki temu wygląd sceny jest powiązany z czasem symulacji.

## 11. Tryb symulacji

Przełącz się z **Edycji** na **Symulację**.

Pojawią się dodatkowe elementy sterowania czasem.

### Przyciski

- **Play** - uruchamia symulację.
- **Pause** - zatrzymuje symulację.
- **1x** - normalna prędkość.
- **10x** - szybsza symulacja.
- **60x** - bardzo szybka symulacja.
- **600x** - maksymalne przyspieszenie.

Można również przejść bezpośrednio do:

- 06:00,
- 12:00,
- 18:00,
- 00:00.

## 12. Monitor energii

Na dole ekranu znajduje się monitor energii.

Pokazuje:

- **Zużycie teraz** - aktualną moc pobieraną przez urządzenia.
- **Produkcja PV** - aktualną produkcję paneli.
- **Bilans netto** - różnicę pomiędzy produkcją a zużyciem.
- **Dzisiaj** - energię zużytą w bieżącym dniu.
- **Koszt netto dziś** - bieżący koszt netto.
- **Koszt miesiąca** - szacowany koszt miesięczny.
- **Koszt roku** - szacowany koszt roczny.
- **Aktywne** - liczbę aktywnych urządzeń.
- **CO2** - szacowaną emisję CO2.
- **Magazyn energii** - stan baterii, jeśli magazyn jest używany.

## 13. Dashboard

Otwórz **Dashboard** w górnym menu.

Dashboard zawiera kilka sekcji.

### Wykresy

Pokazują między innymi:

- moc w czasie,
- zużycie według godzin,
- zużycie według urządzeń,
- koszty w czasie,
- porównania dni,
- dane tygodniowe,
- dane miesięczne.

### Ranking urządzeń

Pozwala sprawdzić:

- urządzenie,
- moc,
- zużycie na dzień,
- zużycie na miesiąc,
- koszt miesięczny,
- udział urządzenia w całym zużyciu.

### Efektywność

Pokazuje informacje pomagające ocenić sposób wykorzystania energii.

### Energia

Sekcja dotycząca produkcji i wykorzystania energii z paneli PV oraz magazynu energii.

### Statystyki

Pozwalają analizować dane z różnych okresów.

### Oszczędności

Pokazują potencjalne oszczędności wynikające ze zmiany sposobu korzystania z urządzeń.

### Scenariusze

Pozwalają porównywać różne warianty działania domu.

### Co jeśli?

Służy do sprawdzania, jak zmiana wybranych ustawień może wpłynąć na zużycie i koszty.

### Porównanie

Pozwala zestawić wybrane warianty ze sobą.

## 14. Panele fotowoltaiczne

Przycisk **Instalacja PV** uruchamia tryb ustawiania paneli.

Panele mogą produkować energię zależnie od:

- godziny,
- daty,
- położenia słońca,
- pogody,
- zachmurzenia,
- zacienienia,
- ustawienia panelu.

Dostępne są również ustawienia dotyczące wykorzystania wyprodukowanej energii.

## 15. Kolejność wykorzystania energii PV

Aplikacja pozwala określić kolejność wykorzystania energii.

Można ustawić trzy miejsca:

1. dom,
2. magazyn energii,
3. sieć energetyczna.

Kolejność można zmieniać w ustawieniach.

Przykładowo energia może być najpierw wykorzystana przez urządzenia domu, następnie skierowana do baterii, a nadwyżka przekazana do sieci.

## 16. Magazyn energii

Magazyn energii może przechowywać nadwyżkę energii z paneli.

W ustawieniach można uwzględnić między innymi:

- poziom naładowania,
- minimalny poziom rezerwy,
- wykorzystanie energii w domu,
- ładowanie magazynu,
- oddawanie energii do sieci.

Stan magazynu jest widoczny w monitorze energii, gdy magazyn znajduje się w projekcie.

## 17. Taryfy energii

Aplikacja obsługuje taryfy:

- G11,
- G12,
- G12w,
- G13.

Każda taryfa może mieć własne ceny oraz harmonogram godzin.

Oznacza to, że koszt urządzenia może zależeć nie tylko od jego zużycia, ale również od godziny pracy.

## 18. Instalacja elektryczna

Przycisk **Instalacja** otwiera konfigurację instalacji elektrycznej.

Można tworzyć elementy takie jak:

- rozdzielnica,
- obwody,
- gniazdka,
- listwy zasilające,
- liczniki,
- zabezpieczenia,
- przewody,
- połączenia urządzeń.

Urządzenia mogą być przypisane do odpowiednich obwodów.

System może również wykrywać problemy związane z przeciążeniem lub konfiguracją instalacji.

## 19. Projektant domu

Przycisk **Projektant** pozwala rozbudować konstrukcję domu.

Można pracować z:

- poziomami,
- pomieszczeniami,
- ścianami,
- drzwiami,
- oknami,
- ściankami działowymi,
- schodami,
- dachami,
- balkonami,
- tarasami,
- ogrodem.

Projektant pozwala przygotować bardziej rozbudowany model domu zamiast korzystania tylko z gotowego układu pomieszczeń.

## 20. Smart Home

Panel **Smart Home** służy do automatyzacji urządzeń.

Automatyzacja może sterować urządzeniami na podstawie ustalonych warunków i harmonogramów.

Przykładowo można ustawić pracę urządzenia tylko w określonych godzinach.

## 21. Harmonogramy urządzeń

Wybrane urządzenia mogą mieć własny harmonogram.

Harmonogram określa, kiedy urządzenie ma pracować.

Można dzięki temu symulować rzeczywiste zachowanie domu, np. urządzenie pracujące tylko rano lub wieczorem.

## 22. Pogoda

Symulacja uwzględnia warunki pogodowe.

Pogoda może wpływać na:

- wygląd nieba,
- światło,
- produkcję PV,
- zacienienie,
- warunki pracy instalacji.

Aktualny stan pogody może być widoczny jako oznaczenie w interfejsie.

## 23. Zwierzak sieciowy

W prawym dolnym obszarze sceny znajduje się zwierzak sieciowy.

Jest to pomocniczy element aplikacji.

Może:

- pokazywać porady,
- reagować na postęp użytkownika,
- wykonywać zadania,
- zdobywać doświadczenie,
- odblokowywać elementy,
- informować o możliwościach oszczędzania energii.

Można zmienić jego nazwę.

## 24. Zapisywanie projektu

Kliknij przycisk **Zapisz**.

Projekt jest zapisywany lokalnie na używanym urządzeniu.

Zapisywane są między innymi:

- pomieszczenia,
- obiekty,
- ich położenie,
- urządzenia,
- meble,
- panele PV,
- magazyny energii,
- ustawienia energii,
- taryfy,
- harmonogramy,
- automatyzacje,
- instalacja elektryczna,
- postęp symulacji.

## 25. Eksport i import projektu

Projekt można zapisać również jako plik JSON.

Plik może zawierać cały projekt wraz z ustawieniami i postępem symulacji.

Dzięki temu projekt można przenieść na inne urządzenie.

Przy imporcie aplikacja odczytuje zapisane dane i odtwarza projekt.

## 26. Cofanie zmian

Przycisk **Cofnij** lub skrót **Ctrl+Z** cofa ostatnią zmianę projektu.

Przycisk **Ponów** lub skrót **Ctrl+Y** przywraca cofniętą zmianę.

Historia zmian dotyczy zmian projektu, a nie cofania czasu samej symulacji.

## 27. Najprostszy sposób rozpoczęcia pracy

Jeżeli uruchamiasz aplikację pierwszy raz:

1. Zostań w trybie **Edycja**.
2. Wybierz pomieszczenie.
3. Dodaj kilka mebli.
4. Dodaj urządzenia elektryczne.
5. Ustaw urządzenia w odpowiednich miejscach.
6. Włącz wybrane urządzenia.
7. Ustaw taryfę energii.
8. Opcjonalnie dodaj panele PV.
9. Opcjonalnie dodaj magazyn energii.
10. Otwórz **Dashboard**.
11. Przełącz się na **Symulację**.
12. Uruchom symulację przyciskiem Play.
13. Obserwuj zużycie, produkcję PV i koszty.
14. Zmieniaj ustawienia i sprawdzaj różnice.

## 28. Przykładowy scenariusz

Aby sprawdzić działanie aplikacji:

1. Utwórz pokój.
2. Dodaj komputer, monitor i lampę.
3. Ustaw ich położenie.
4. Włącz urządzenia.
5. Ustaw ich harmonogram.
6. Dodaj panel PV.
7. Ustaw kolejność wykorzystania energii.
8. Przejdź do trybu Symulacja.
9. Uruchom symulację z prędkością 60x.
10. Otwórz Dashboard.
11. Sprawdź wykresy i ranking urządzeń.
12. Zmień godziny pracy urządzeń.
13. Uruchom symulację ponownie.
14. Porównaj koszty.

## 29. Przydatne skróty

| Skrót | Działanie |
|---|---|
| W | Przesuwanie obiektu |
| E | Obracanie obiektu |
| R | Skalowanie obiektu |
| F | Skupienie widoku na obiekcie |
| G | Siatka |
| Ctrl+Z | Cofnięcie zmiany |
| Ctrl+Y | Ponowienie zmiany |
| Ctrl+D | Duplikowanie obiektu |
| Delete | Usunięcie obiektu |
| Space | Start / pauza symulacji |

## 30. Wskazówki

- Najpierw zaprojektuj pomieszczenia, a dopiero później ustawiaj urządzenia.
- Korzystaj z siatki, gdy chcesz dokładnie ustawiać obiekty.
- Używaj harmonogramów, aby symulacja bardziej przypominała rzeczywiste korzystanie z domu.
- Dashboard najlepiej otwierać po przeprowadzeniu dłuższej symulacji.
- Przy analizie kosztów sprawdzaj również wybraną taryfę.
- Przy panelach PV zwracaj uwagę na godzinę, pogodę i zacienienie.
- Regularnie zapisuj projekt.
- Eksport JSON warto wykonać przed większymi zmianami projektu.

## 31. Rozwiązywanie problemów

### Obiekt jest w złym miejscu

Zaznacz go i użyj narzędzia Move. Możesz również włączyć siatkę i Snap.

### Nie można znaleźć urządzenia

Sprawdź inne kategorie w panelu po lewej stronie.

### Symulacja nie działa

Sprawdź, czy jesteś w trybie **Symulacja**, a następnie kliknij Play.

### Koszt energii jest nieprawidłowy

Sprawdź wybraną taryfę, ceny oraz harmonogram taryfy.

### Panel PV produkuje mało energii

Sprawdź godzinę, datę, pogodę, położenie panelu oraz zacienienie.

### Nie ma zapisanego projektu

Sprawdź, czy projekt został wcześniej zapisany na tym samym urządzeniu i w tej samej przeglądarce.

### Chcesz wrócić do poprzedniego ustawienia

Użyj **Cofnij** lub Ctrl+Z.

## 32. Najważniejsze elementy aplikacji

EnergyRoom 3D można podzielić na kilka głównych części:

1. **Projektowanie domu** - pomieszczenia, ściany, drzwi, okna i wyposażenie.
2. **Urządzenia** - sprzęt elektryczny i jego parametry.
3. **Symulacja** - działanie domu w czasie.
4. **Energia** - zużycie, produkcja PV, magazynowanie i bilans.
5. **Instalacja elektryczna** - obwody, gniazdka, przewody i zabezpieczenia.
6. **Smart Home** - automatyzacja urządzeń.
7. **Dashboard** - wykresy, koszty, statystyki i porównania.
8. **Projektant** - rozbudowa konstrukcji domu.
9. **Zwierzak sieciowy** - porady, zadania i element grywalizacji.
10. **Zapisywanie projektu** - zapis lokalny oraz eksport i import danych.

## 33. Cel aplikacji

Celem EnergyRoom 3D jest pokazanie w prosty i interaktywny sposób, jak wygląd domu, urządzenia, ich harmonogramy, taryfa energii, fotowoltaika, magazyn energii oraz instalacja elektryczna wpływają na zużycie energii i koszty.

