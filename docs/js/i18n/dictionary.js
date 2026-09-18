/**
 * TRANSLATION DICTIONARY (PL / EN)
 * Namespaced keys (dot notation) grouped by feature area. Kept in its
 * own file, separate from the I18n engine, purely so it's easy to find
 * and extend - adding a language means adding one more top-level key
 * here (e.g. `de: {...}`) plus wiring a NAME_XX table in I18n.js.
 */
const I18N_DICT = {
  pl: {
    // ---------- common ----------
    'common.save':'Zapisz', 'common.cancel':'Anuluj', 'common.close':'Zamknij', 'common.confirm':'Potwierdź',
    'common.delete':'Usuń', 'common.add':'Dodaj', 'common.edit':'Edytuj', 'common.yes':'Tak', 'common.no':'Nie',
    'common.moreInfo':'Więcej informacji', 'common.lessInfo':'Mniej informacji', 'common.details':'Szczegóły',
    'common.back':'Wstecz', 'common.next':'Dalej', 'common.finish':'Zakończ', 'common.start':'Rozpocznij',
    'common.today':'Dzisiaj', 'common.yesterday':'Wczoraj', 'common.week':'7 dni', 'common.month':'Miesiąc', 'common.year':'Rok',
    'common.forecast':'Prognoza', 'common.active':'Aktywny', 'common.inactive':'Nieaktywny', 'common.enabled':'Włączony',
    'common.disabled':'Wyłączony', 'common.name':'Nazwa', 'common.currency':'Waluta', 'common.all':'Wszystko',
    'common.average':'Średnio', 'common.total':'Razem', 'common.perDay':'na dzień', 'common.perMonth':'na miesiąc',
    'common.perYear':'na rok', 'common.reset':'Resetuj', 'common.apply':'Zastosuj', 'common.copy':'Kopiuj',
    'common.since':'Łącznie od początku symulacji', 'common.estimate':'Szacunek', 'common.real':'Zmierzone',
    'common.hours':'godz.', 'common.minutes':'min', 'common.free':'Wolny', 'common.custom': 'Własne',

    // ---------- topbar / navigation ----------
    'mode.edit':'Edycja', 'mode.sim':'Symulacja',
    'nav.undo':'Cofnij', 'nav.redo':'Ponów', 'nav.save':'Zapisz projekt', 'nav.load':'Wczytaj projekt',
    'nav.roomSettings':'Pokój', 'nav.smartHome':'Smart Home', 'nav.dashboard':'Dashboard', 'nav.settings':'Ustawienia',
    'nav.newSim':'Nowa symulacja', 'nav.wholeHouse':'Cały dom', 'nav.wallsOpen':'Otwarty', 'nav.wallsClosed':'Zamknięty',

    // ---------- days / months ----------
    'dayshort.0':'Nd','dayshort.1':'Pn','dayshort.2':'Wt','dayshort.3':'Śr','dayshort.4':'Cz','dayshort.5':'Pt','dayshort.6':'So',
    'daylong.0':'Niedziela','daylong.1':'Poniedziałek','daylong.2':'Wtorek','daylong.3':'Środa','daylong.4':'Czwartek','daylong.5':'Piątek','daylong.6':'Sobota',
    'day.all':'Cały tydzień', 'day.workdays':'Dni robocze', 'day.weekend':'Weekend', 'day.single':'Pojedynczy dzień',
    'month.0':'Styczeń','month.1':'Luty','month.2':'Marzec','month.3':'Kwiecień','month.4':'Maj','month.5':'Czerwiec',
    'month.6':'Lipiec','month.7':'Sierpień','month.8':'Wrzesień','month.9':'Październik','month.10':'Listopad','month.11':'Grudzień',
    'season.spring':'Wiosna', 'season.summer':'Lato', 'season.autumn':'Jesień', 'season.winter':'Zima',

    // ---------- categories ----------
    'category.lighting':'Oświetlenie', 'category.rtv':'RTV', 'category.agd':'AGD', 'category.computers':'Komputery',
    'category.climate':'Klimatyzacja', 'category.heating':'Ogrzewanie', 'category.smarthome':'Smart Home',
    'category.ogrod':'Ogród', 'category.other':'Inne', 'category.furniture':'Meble', 'category.solar':'Energia',

    // ---------- device runtime states ----------
    'devstate.on':'Włączony','devstate.off':'Wyłączony','devstate.standby':'Czuwanie','devstate.idle':'Bezczynny',
    'devstate.idlePlugged':'Podłączony (bezczynny)','devstate.charging':'Ładowanie','devstate.discharging':'Rozładowanie',
    'devstate.generating':'Produkcja','devstate.active':'Aktywny','devstate.running':'Pracuje','devstate.heating':'Grzanie',
    'devstate.cooking':'Gotowanie','devstate.washing':'Pranie','devstate.spinning':'Wirowanie','devstate.drying':'Suszenie',
    'devstate.blending':'Miksowanie','devstate.brewing':'Parzenie','devstate.browsing':'Przeglądanie','devstate.gaming':'Granie',
    'devstate.cleaning':'Sprzątanie','devstate.cooldown':'Wychładzanie','devstate.compressor':'Sprężarka pracuje',
    'devstate.compressorOn':'Sprężarka pracuje','devstate.fan':'Wentylator','devstate.flameOnly':'Sam płomień',
    'devstate.high':'Wysoka moc','devstate.low':'Niska moc','devstate.maintaining':'Podtrzymanie','devstate.menu':'Menu',
    'devstate.preheat':'Nagrzewanie','devstate.printing':'Drukowanie','devstate.pumping':'Pompowanie','devstate.sleep':'Uśpiony',
    'devstate.toasting':'Opiekanie','devstate.heavy':'Wysokie obciążenie',

    // ---------- tariffs (section 2) ----------
    'tariff.title':'Taryfa energetyczna', 'tariff.G11.name':'G11', 'tariff.G11.desc':'Cena stała przez całą dobę',
    'tariff.G12.name':'G12', 'tariff.G12.desc':'Dwie strefy: dzienna i tańsza nocna',
    'tariff.G12w.name':'G12w', 'tariff.G12w.desc':'Jak G12, ale cały weekend w cenie niższej',
    'tariff.G13.name':'G13', 'tariff.G13.desc':'Trzy strefy: szczyt, dzień, noc',
    'tariff.rate.flat':'Cena całodobowa', 'tariff.rate.day':'Strefa dzienna', 'tariff.rate.night':'Strefa nocna', 'tariff.rate.peak':'Szczyt',
    'tariff.pricePerKWh':'Cena za kWh', 'tariff.viewSchedule':'Zobacz dokładny harmonogram', 'tariff.editSchedule':'Edytuj godziny taryfy',
    'tariff.monthlyCost':'Koszt energii miesięcznie', 'tariff.yearlyCost':'Koszt energii rocznie',
    'tariff.pvImpact':'Wpływ na opłacalność PV', 'tariff.cheapHours':'Godziny tańszej energii', 'tariff.expensiveHours':'Godziny droższej energii',
    'tariff.weekendNote':'Cały weekend w cenie nocnej', 'tariff.currentRate':'Aktualna taryfa',
    'tariff.extraFees':'Opłaty dodatkowe / mies.', 'tariff.exportPrice':'Rozliczenie energii oddanej do sieci (cena/kWh)',

    // ---------- schedule editor (section 3) ----------
    'sched.title':'Harmonogram urządzenia', 'sched.active':'Harmonogram aktywny', 'sched.days':'Dni tygodnia',
    'sched.intervals':'Przedziały czasowe', 'sched.addInterval':'Dodaj przedział', 'sched.removeInterval':'Usuń',
    'sched.copyTo':'Kopiuj na inne dni', 'sched.applyToOthers':'Zastosuj do wybranych dni', 'sched.save':'Zapisz harmonogram',
    'sched.selectAll':'Cały tydzień', 'sched.selectWorkdays':'Dni robocze', 'sched.selectWeekend':'Weekend', 'sched.selectSingle':'Jeden dzień',
    'sched.noIntervals':'Brak aktywnych przedziałów tego dnia', 'sched.timeline':'Podgląd na osi czasu',
    'sched.start':'Początek', 'sched.end':'Koniec', 'sched.summary':'Podsumowanie', 'sched.wrapNote':'(przechodzi przez północ)',
    'sched.editButton':'🕐 Harmonogram', 'sched.perDayHint':'Każdy dzień można ustawić niezależnie, z kilkoma przedziałami dziennie.',

    // ---------- PV install (sections 14/15) ----------
    'pv.installMode':'Instalacja PV', 'pv.startInstall':'Rozpocznij instalację PV', 'pv.finishInstall':'Zakończ instalację',
    'pv.installHint':'Wybierz panel z listy po lewej i kliknij dach garażu, aby go umieścić. Przeciągnij, obróć i pochyl panel gizmem, aby zoptymalizować produkcję.',
    'pv.notInstalledYet':'Nie zainstalowano jeszcze żadnych paneli PV. Rozpocznij instalację, aby zacząć produkować energię.',
    'pv.panelCount':'Liczba paneli', 'pv.panelPower':'Moc panelu', 'pv.totalPower':'Łączna moc instalacji',
    'pv.orientation':'Orientacja', 'pv.tilt':'Kąt nachylenia', 'pv.aimQuality':'Jakość ustawienia',
    'pv.aimExcellent':'Świetne ustawienie', 'pv.aimGood':'Dobre ustawienie', 'pv.aimPoor':'Słabe ustawienie — spróbuj zmienić kierunek/kąt',
    'pv.compass':'Kierunek', 'pv.idealNote':'Optymalnie dla tej szerokości geograficznej: kierunek południowy, kąt ok. 35°.',
    'pv.production':'Produkcja', 'pv.efficiency':'Sprawność', 'pv.maxProduction':'Maksymalna produkcja', 'pv.avgProduction':'Średnia produkcja',

    // ---------- weather (sections 9/10/11) ----------
    'weather.clear':'Bezchmurnie', 'weather.lightClouds':'Lekko zachmurzone', 'weather.cloudy':'Pochmurno',
    'weather.overcast':'Bardzo pochmurno', 'weather.rain':'Deszcz', 'weather.stormCond':'Burza', 'weather.snow':'Śnieg',
    'weather.event.storm':'Burza', 'weather.event.gale':'Silny wiatr', 'weather.event.heatwave':'Fala upałów', 'weather.event.coldsnap':'Mróz',
    'weather.event.storm.desc':'Silne opady i zachmurzenie ograniczają produkcję PV.',
    'weather.event.gale.desc':'Silny wiatr — produkcja PV lekko ograniczona, wzrasta zużycie ogrzewania.',
    'weather.event.heatwave.desc':'Wysokie temperatury — więcej klimatyzacji, mniej ogrzewania.',
    'weather.event.coldsnap.desc':'Mróz — więcej ogrzewania, produkcja PV lekko ograniczona (możliwy szron/śnieg na panelach).',
    'weather.effectNote':'wpływa teraz na zużycie i produkcję PV.',
    'weather.sunrise':'Wschód słońca', 'weather.sunset':'Zachód słońca', 'weather.dayLength':'Długość dnia',
    'weather.pvFactorHint':'Aktualny wpływ pogody na produkcję PV.',

    // ---------- PV priority (section 6) ----------
    'priority.title':'Priorytet wykorzystania energii PV', 'priority.home_first':'Dom → Bateria → Sieć',
    'priority.battery_first':'Bateria → Dom → Sieć', 'priority.home_firstDesc':'Energia PV najpierw pokrywa bieżące zużycie domu, nadwyżka ładuje baterię, reszta trafia do sieci.',
    'priority.battery_firstDesc':'Energia PV najpierw ładuje baterię, nawet kosztem chwilowego poboru z sieci przez dom.',

    // ---------- settings ----------
    'settings.title':'Ustawienia', 'settings.language':'Język', 'settings.tariffSection':'Taryfa i koszty energii',
    'settings.pvSection':'Fotowoltaika i priorytety', 'settings.generalSection':'Ogólne',
    'settings.dangerZone':'Strefa zagrożenia', 'settings.resetSim':'Resetuj symulację', 'settings.resetConfirm':'Czy na pewno chcesz zresetować całą symulację? Ta operacja jest nieodwracalna i usunie cały postęp, urządzenia oraz statystyki.',
    'settings.co2Factor':'Współczynnik CO₂ (kg/kWh)', 'settings.avgHousehold':'Średnie zużycie gospodarstwa (kWh/rok)',

    // ---------- stats / dashboard (sections 7/8/13/20/21/22/23) ----------
    'stats.range.today':'Dzisiaj', 'stats.range.week':'7 dni', 'stats.range.month':'Miesiąc', 'stats.range.year':'Rok',
    'stats.consumption':'Zużycie', 'stats.production':'Produkcja PV', 'stats.gridImport':'Pobór z sieci', 'stats.gridExport':'Oddanie do sieci',
    'stats.cost':'Koszt', 'stats.savings':'Oszczędności', 'stats.today':'Dzisiaj', 'stats.yesterday':'Wczoraj',
    'stats.thisWeek':'Ten tydzień', 'stats.thisMonth':'Ten miesiąc', 'stats.thisYear':'Ten rok', 'stats.yearForecast':'Prognoza roczna',
    'stats.withoutPV':'Bez PV', 'stats.withPV':'Z PV', 'stats.reduction':'Redukcja kosztów', 'stats.lifetimeSavings':'Oszczędności łącznie (od startu)',
    'stats.vsAverage':'na tle przeciętnego gospodarstwa', 'stats.estimatedMonth':'Miesiąc szacowany (brak jeszcze pełnych danych)',
    'stats.realMonth':'Miesiąc zmierzony w symulacji', 'stats.byRoom':'Podział wg pomieszczeń', 'stats.byCategory':'Podział wg kategorii',
    'stats.byDevice':'Podział wg urządzeń', 'stats.comparePeriod':'Porównanie okresów', 'stats.compareDevices':'Porównanie urządzeń',
    'stats.previousPeriod':'Poprzedni okres', 'stats.currentPeriod':'Obecny okres', 'stats.change':'Zmiana',
    'stats.runtime':'Czas pracy', 'stats.avgPower':'Średnia moc', 'stats.shareOfTotal':'Udział w całkowitym zużyciu',

    // ---------- panels (section 4) ----------
    'panel.energy':'Panel energii', 'panel.pv':'Panel PV', 'panel.cost':'Panel kosztów',
    'panel.currentUsage':'Aktualne zużycie', 'panel.currentProduction':'Aktualna produkcja PV', 'panel.netCost':'Aktualny koszt',

    // ---------- dashboard tabs / footer ----------
    'dash.tab.charts':'Wykresy', 'dash.tab.ranking':'Ranking urządzeń', 'dash.tab.score':'Efektywność',
    'dash.tab.stats':'Statystyki', 'dash.tab.savings':'Oszczędności', 'dash.tab.scenarios':'Scenariusze',
    'dash.tab.whatif':'Co jeśli?', 'dash.tab.compare':'Porównanie',
    'footer.usageNow':'ZUŻYCIE TERAZ', 'footer.pvProduction':'PRODUKCJA PV', 'footer.netBalance':'BILANS NETTO',
    'footer.today':'DZISIAJ', 'footer.netCostToday':'KOSZT NETTO DZIŚ', 'footer.costMonth':'KOSZT MIESIĄCA',
    'footer.costYear':'KOSZT ROKU', 'footer.active':'AKTYWNE', 'footer.co2Year':'CO₂ (rok, szac.)', 'footer.battery':'MAGAZYN ENERGII',

    // ---------- pet / progression (sections 16-19) ----------
    'pet.title':'Asystent', 'pet.level':'Poziom', 'pet.xp':'Doświadczenie', 'pet.feed':'Nakarm', 'pet.tips':'Porady',
    'pet.quests':'Zadania', 'pet.noTips':'Brak nowych porad — wszystko wygląda dobrze!', 'pet.unlocks':'Odblokowane funkcje',
    'pet.nextUnlock':'Następne odblokowanie', 'pet.questCompleted':'Zadanie ukończone!', 'pet.questClaim':'Odbierz nagrodę',
    'pet.questProgress':'Postęp',
    'pet.trick.spin':'Zawirowanie', 'pet.trick.pulse':'Puls danych', 'pet.trick.burst':'Wybuch bitów',
    'pet.trick.shimmer':'Migotanie', 'pet.trick.aura':'Aura energii', 'pet.trick.legend':'Forma legendarna',
    'pet.leveledUp':'awansował na poziom {level}: {stage}!',
    'pet.xpReason.dailyOutcome':'wynik dnia', 'pet.xpReason.schedule':'zapisany harmonogram', 'pet.xpReason.pvInstall':'instalacja PV',
    'pet.xpReason.quest':'ukończone zadanie', 'pet.xpReason.analysis':'analiza danych', 'pet.xpReason.efficiency':'poprawa efektywności',
    'unlock.tipsBasic':'Podstawowe porady asystenta', 'unlock.tipTrends':'Porady oparte o trendy tygodniowe',
    'unlock.schedulePresets':'Szybkie szablony harmonogramów', 'unlock.tipSeasonal':'Porady sezonowe dot. PV',
    'unlock.compareOverlay':'Nakładka porównania ze średnią gospodarstwa', 'unlock.tipEfficiency':'Porady o zmianie efektywności',
    'unlock.questMaster':'Dodatkowe, trudniejsze zadania',
    'quest.firstPv.title':'Pierwsza instalacja PV', 'quest.firstPv.desc':'Zainstaluj przynajmniej jeden panel fotowoltaiczny.',
    'quest.firstSchedule.title':'Pierwszy harmonogram', 'quest.firstSchedule.desc':'Zapisz własny harmonogram dla dowolnego urządzenia.',
    'quest.firstBattery.title':'Magazyn energii', 'quest.firstBattery.desc':'Zainstaluj domowy magazyn energii (baterię).',
    'quest.frugalMorning.title':'Oszczędny poranek', 'quest.frugalMorning.desc':'Zmniejsz zużycie energii między 06:00 a 09:00 o co najmniej 15% względem przeciętnego dnia.',
    'quest.sunShift.title':'Wykorzystaj słońce', 'quest.sunShift.desc':'Osiągnij co najmniej 60% autokonsumpcji energii z PV w ciągu dnia.',
    'quest.cheapTariff.title':'Tania taryfa', 'quest.cheapTariff.desc':'Zużyj większość energii w tańszych godzinach taryfy.',
    'quest.maxSelfuse.title':'Maksymalna autokonsumpcja', 'quest.maxSelfuse.desc':'Osiągnij co najmniej 80% autokonsumpcji energii z PV.',

    // ---------- advisor tips (section 16) ----------
    'advisor.expensiveDevice':'{name} działa obecnie w drogim przedziale taryfy {tariff}. Możesz przenieść jego harmonogram na godziny tańszej energii (od {time}).',
    'advisor.expensiveDeviceGeneric':'{name} działa obecnie w drogim przedziale taryfy {tariff}. Rozważ przeniesienie jego harmonogramu na tańsze godziny.',
    'advisor.pvSurplus':'Twoja produkcja PV jest obecnie wysoka (nadwyżka {watts}). Dobrym pomysłem może być uruchomienie urządzeń o dużym poborze energii.',
    'advisor.longRunning':'{name} działa nieprzerwanie od {hours} godzin. Czy na pewno nadal jest potrzebne?',
    'advisor.trendUp':'W ostatnich dniach zużycie energii wzrosło o {pct}% względem poprzedniego tygodnia.',
    'advisor.poorAim':'Twoja instalacja PV produkuje mniej niż mogłaby ze względu na niekorzystne ustawienie paneli (jakość ustawienia: {pct}%).',
    'advisor.seasonWinter':'Zima krótkie dni i częste zachmurzenie — produkcja PV będzie niższa niż latem, to normalne.',
    'advisor.seasonSummer':'Lato długie dni i wysokie nasłonecznienie — to najlepszy czas na wysoką autokonsumpcję PV.',
    'advisor.scoreImproved':'Twoja ocena efektywności energetycznej poprawiła się o {delta} punktów. Dobra robota!',
    'advisor.noPv':'Nie masz jeszcze zainstalowanej instalacji fotowoltaicznej. Rozpocznij instalację PV w dowolnej chwili z paska górnego.',

    // ---------- new simulation (section 29) ----------
    'newsim.title':'Nowa symulacja', 'newsim.projectName':'Nazwa projektu', 'newsim.tariff':'Taryfa startowa',
    'newsim.budget':'Budżet (informacyjnie)', 'newsim.confirmStart':'Rozpocznij nową symulację',
    'newsim.warning':'Spowoduje to usunięcie obecnego projektu (urządzeń, PV, postępu). Zapisz najpierw, jeśli chcesz go zachować.',

    // ---------- log / toast messages ----------
    'log.simStarted':'Symulacja wystartowała', 'log.simPaused':'Symulacja zatrzymana',
    'log.simSpeed':'Prędkość symulacji: {mult}x', 'log.skippedTo':'Przewinięto do {time}',
    'log.deviceStateChange':'{name} → {state}',
    'log.projectSaved':'Projekt zapisany lokalnie.', 'log.projectSaveError':'Błąd zapisu projektu.',
    'log.noSavedProject':'Brak zapisanego projektu.', 'log.projectLoaded':'Projekt wczytany.',
    'log.projectLoadError':'Błąd wczytywania projektu (uszkodzony JSON).', 'log.projectExported':'Projekt wyeksportowany do pliku.',
    'log.projectImported':'Projekt zaimportowany.', 'log.projectImportError':'Błąd importu: nieprawidłowy plik JSON.',
    'log.fileReadError':'Nie udało się odczytać pliku.', 'log.newProjectCreated':'Utworzono nowy projekt.',
    'log.simulationReset':'Symulacja została zresetowana.', 'log.nothingToUndo':'Nic do cofnięcia.',
    'log.undone':'Cofnięto (Ctrl+Z).', 'log.nothingToRedo':'Nic do ponowienia.', 'log.redone':'Ponowiono (Ctrl+Y).',

    // ---------- energy score / alerts ----------
    'score.noDevices':'Brak urządzeń.', 'score.addDevices':'Dodaj urządzenia, aby zobaczyć analizę.',
    'score.biggestProblem':'{name} odpowiada za {pct}% miesięcznego zużycia.', 'score.noProblems':'Brak istotnych problemów.',
    'score.biggestOpportunity':'Automatyczne wyłączanie „{name}” ze standby ({watts}W) mogłoby ograniczyć zużycie jałowe.',
    'score.addMorePV':'Rozważ dodanie kolejnych paneli PV, aby zwiększyć autokonsumpcję.',
    'score.automateNight':'Rozważ automatyzacje wyłączające urządzenia w nocy.',
    'alert.runningHours':'{name} działa od {hours} godzin.', 'alert.standbyHours':'{name} pozostaje w standby przez {hours} godzin.',
    'alert.topShare':'{name} odpowiada za {pct}% dzisiejszego zużycia.',
    'alert.washerTip':'Pralka zużywa najwięcej energii podczas podgrzewania wody.',
    'alert.pvSurplus':'Panele PV pokrywają teraz 100% zużycia i eksportują {watts} nadwyżki.',
  },

  en: {
    // ---------- common ----------
    'common.save':'Save', 'common.cancel':'Cancel', 'common.close':'Close', 'common.confirm':'Confirm',
    'common.delete':'Delete', 'common.add':'Add', 'common.edit':'Edit', 'common.yes':'Yes', 'common.no':'No',
    'common.moreInfo':'More information', 'common.lessInfo':'Less information', 'common.details':'Details',
    'common.back':'Back', 'common.next':'Next', 'common.finish':'Finish', 'common.start':'Start',
    'common.today':'Today', 'common.yesterday':'Yesterday', 'common.week':'7 days', 'common.month':'Month', 'common.year':'Year',
    'common.forecast':'Forecast', 'common.active':'Active', 'common.inactive':'Inactive', 'common.enabled':'Enabled',
    'common.disabled':'Disabled', 'common.name':'Name', 'common.currency':'Currency', 'common.all':'All',
    'common.average':'Average', 'common.total':'Total', 'common.perDay':'per day', 'common.perMonth':'per month',
    'common.perYear':'per year', 'common.reset':'Reset', 'common.apply':'Apply', 'common.copy':'Copy',
    'common.since':'Total since simulation start', 'common.estimate':'Estimate', 'common.real':'Measured',
    'common.hours':'h', 'common.minutes':'min', 'common.free':'Free', 'common.custom':'Custom',

    // ---------- topbar / navigation ----------
    'mode.edit':'Edit', 'mode.sim':'Simulation',
    'nav.undo':'Undo', 'nav.redo':'Redo', 'nav.save':'Save project', 'nav.load':'Load project',
    'nav.roomSettings':'Room', 'nav.smartHome':'Smart Home', 'nav.dashboard':'Dashboard', 'nav.settings':'Settings',
    'nav.newSim':'New simulation', 'nav.wholeHouse':'Whole house', 'nav.wallsOpen':'Open', 'nav.wallsClosed':'Closed',

    // ---------- days / months ----------
    'dayshort.0':'Su','dayshort.1':'Mo','dayshort.2':'Tu','dayshort.3':'We','dayshort.4':'Th','dayshort.5':'Fr','dayshort.6':'Sa',
    'daylong.0':'Sunday','daylong.1':'Monday','daylong.2':'Tuesday','daylong.3':'Wednesday','daylong.4':'Thursday','daylong.5':'Friday','daylong.6':'Saturday',
    'day.all':'Every day', 'day.workdays':'Weekdays', 'day.weekend':'Weekend', 'day.single':'Single day',
    'month.0':'January','month.1':'February','month.2':'March','month.3':'April','month.4':'May','month.5':'June',
    'month.6':'July','month.7':'August','month.8':'September','month.9':'October','month.10':'November','month.11':'December',
    'season.spring':'Spring', 'season.summer':'Summer', 'season.autumn':'Autumn', 'season.winter':'Winter',

    // ---------- categories ----------
    'category.lighting':'Lighting', 'category.rtv':'TV & Audio', 'category.agd':'Appliances', 'category.computers':'Computers',
    'category.climate':'Cooling', 'category.heating':'Heating', 'category.smarthome':'Smart Home',
    'category.ogrod':'Garden', 'category.other':'Other', 'category.furniture':'Furniture', 'category.solar':'Energy',

    // ---------- device runtime states ----------
    'devstate.on':'On','devstate.off':'Off','devstate.standby':'Standby','devstate.idle':'Idle',
    'devstate.idlePlugged':'Plugged in (idle)','devstate.charging':'Charging','devstate.discharging':'Discharging',
    'devstate.generating':'Generating','devstate.active':'Active','devstate.running':'Running','devstate.heating':'Heating',
    'devstate.cooking':'Cooking','devstate.washing':'Washing','devstate.spinning':'Spinning','devstate.drying':'Drying',
    'devstate.blending':'Blending','devstate.brewing':'Brewing','devstate.browsing':'Browsing','devstate.gaming':'Gaming',
    'devstate.cleaning':'Cleaning','devstate.cooldown':'Cooling down','devstate.compressor':'Compressor running',
    'devstate.compressorOn':'Compressor running','devstate.fan':'Fan','devstate.flameOnly':'Pilot flame only',
    'devstate.high':'High power','devstate.low':'Low power','devstate.maintaining':'Maintaining','devstate.menu':'Menu',
    'devstate.preheat':'Preheating','devstate.printing':'Printing','devstate.pumping':'Pumping','devstate.sleep':'Sleep',
    'devstate.toasting':'Toasting','devstate.heavy':'Heavy load',

    // ---------- tariffs ----------
    'tariff.title':'Electricity tariff', 'tariff.G11.name':'G11', 'tariff.G11.desc':'Flat rate around the clock',
    'tariff.G12.name':'G12', 'tariff.G12.desc':'Two zones: day and cheaper night',
    'tariff.G12w.name':'G12w', 'tariff.G12w.desc':'Like G12, but the whole weekend at the cheaper rate',
    'tariff.G13.name':'G13', 'tariff.G13.desc':'Three zones: peak, day, night',
    'tariff.rate.flat':'Flat rate', 'tariff.rate.day':'Day rate', 'tariff.rate.night':'Night rate', 'tariff.rate.peak':'Peak rate',
    'tariff.pricePerKWh':'Price per kWh', 'tariff.viewSchedule':'View exact schedule', 'tariff.editSchedule':'Edit tariff hours',
    'tariff.monthlyCost':'Monthly energy cost', 'tariff.yearlyCost':'Yearly energy cost',
    'tariff.pvImpact':'Impact on PV payback', 'tariff.cheapHours':'Cheaper hours', 'tariff.expensiveHours':'More expensive hours',
    'tariff.weekendNote':'Whole weekend at the night rate', 'tariff.currentRate':'Current rate',
    'tariff.extraFees':'Extra fees / month', 'tariff.exportPrice':'Grid feed-in settlement (price/kWh)',

    // ---------- schedule editor ----------
    'sched.title':'Device schedule', 'sched.active':'Schedule active', 'sched.days':'Days of week',
    'sched.intervals':'Time intervals', 'sched.addInterval':'Add interval', 'sched.removeInterval':'Remove',
    'sched.copyTo':'Copy to other days', 'sched.applyToOthers':'Apply to selected days', 'sched.save':'Save schedule',
    'sched.selectAll':'Every day', 'sched.selectWorkdays':'Weekdays', 'sched.selectWeekend':'Weekend', 'sched.selectSingle':'Single day',
    'sched.noIntervals':'No active intervals on this day', 'sched.timeline':'Timeline preview',
    'sched.start':'Start', 'sched.end':'End', 'sched.summary':'Summary', 'sched.wrapNote':'(crosses midnight)',
    'sched.editButton':'🕐 Schedule', 'sched.perDayHint':'Each day can be configured independently, with several intervals per day.',

    // ---------- PV install ----------
    'pv.installMode':'PV Installation', 'pv.startInstall':'Start PV installation', 'pv.finishInstall':'Finish installation',
    'pv.installHint':'Pick a panel from the list on the left and click the garage roof to place it. Drag, rotate and tilt it with the gizmo to optimize production.',
    'pv.notInstalledYet':'No PV panels installed yet. Start the installation to begin generating power.',
    'pv.panelCount':'Panel count', 'pv.panelPower':'Panel power', 'pv.totalPower':'Total installed power',
    'pv.orientation':'Orientation', 'pv.tilt':'Tilt angle', 'pv.aimQuality':'Aim quality',
    'pv.aimExcellent':'Excellent placement', 'pv.aimGood':'Good placement', 'pv.aimPoor':'Poor placement — try changing direction/tilt',
    'pv.compass':'Direction', 'pv.idealNote':'Optimal for this latitude: facing south, tilt around 35°.',
    'pv.production':'Production', 'pv.efficiency':'Efficiency', 'pv.maxProduction':'Peak production', 'pv.avgProduction':'Average production',

    // ---------- weather ----------
    'weather.clear':'Clear sky', 'weather.lightClouds':'Light clouds', 'weather.cloudy':'Cloudy',
    'weather.overcast':'Heavily overcast', 'weather.rain':'Rain', 'weather.stormCond':'Storm', 'weather.snow':'Snow',
    'weather.event.storm':'Storm', 'weather.event.gale':'Gale', 'weather.event.heatwave':'Heatwave', 'weather.event.coldsnap':'Cold snap',
    'weather.event.storm.desc':'Heavy rain and cloud cover limit PV production.',
    'weather.event.gale.desc':'Strong wind — PV production slightly reduced, heating use increases.',
    'weather.event.heatwave.desc':'High temperatures — more air conditioning, less heating.',
    'weather.event.coldsnap.desc':'Cold snap — more heating, PV production slightly reduced (possible frost/snow on panels).',
    'weather.effectNote':'is currently affecting consumption and PV production.',
    'weather.sunrise':'Sunrise', 'weather.sunset':'Sunset', 'weather.dayLength':'Day length',
    'weather.pvFactorHint':'Current weather impact on PV production.',

    // ---------- PV priority ----------
    'priority.title':'PV usage priority', 'priority.home_first':'Home → Battery → Grid',
    'priority.battery_first':'Battery → Home → Grid', 'priority.home_firstDesc':'PV output first covers the home\'s current usage, surplus charges the battery, the rest goes to the grid.',
    'priority.battery_firstDesc':'PV output charges the battery first, even at the cost of the home briefly importing from the grid.',

    // ---------- settings ----------
    'settings.title':'Settings', 'settings.language':'Language', 'settings.tariffSection':'Tariff & energy costs',
    'settings.pvSection':'Solar & priorities', 'settings.generalSection':'General',
    'settings.dangerZone':'Danger zone', 'settings.resetSim':'Reset simulation', 'settings.resetConfirm':'Are you sure you want to reset the whole simulation? This cannot be undone and will remove all progress, devices and statistics.',
    'settings.co2Factor':'CO₂ factor (kg/kWh)', 'settings.avgHousehold':'Average household usage (kWh/year)',

    // ---------- stats / dashboard ----------
    'stats.range.today':'Today', 'stats.range.week':'7 days', 'stats.range.month':'Month', 'stats.range.year':'Year',
    'stats.consumption':'Consumption', 'stats.production':'PV production', 'stats.gridImport':'Grid import', 'stats.gridExport':'Grid export',
    'stats.cost':'Cost', 'stats.savings':'Savings', 'stats.today':'Today', 'stats.yesterday':'Yesterday',
    'stats.thisWeek':'This week', 'stats.thisMonth':'This month', 'stats.thisYear':'This year', 'stats.yearForecast':'Yearly forecast',
    'stats.withoutPV':'Without PV', 'stats.withPV':'With PV', 'stats.reduction':'Cost reduction', 'stats.lifetimeSavings':'Total savings (since start)',
    'stats.vsAverage':'vs. average household', 'stats.estimatedMonth':'Estimated month (not fully played yet)',
    'stats.realMonth':'Measured in simulation', 'stats.byRoom':'Breakdown by room', 'stats.byCategory':'Breakdown by category',
    'stats.byDevice':'Breakdown by device', 'stats.comparePeriod':'Period comparison', 'stats.compareDevices':'Device comparison',
    'stats.previousPeriod':'Previous period', 'stats.currentPeriod':'Current period', 'stats.change':'Change',
    'stats.runtime':'Runtime', 'stats.avgPower':'Average power', 'stats.shareOfTotal':'Share of total consumption',

    // ---------- panels ----------
    'panel.energy':'Energy panel', 'panel.pv':'PV panel', 'panel.cost':'Cost panel',
    'panel.currentUsage':'Current usage', 'panel.currentProduction':'Current PV production', 'panel.netCost':'Current cost',

    // ---------- dashboard tabs / footer ----------
    'dash.tab.charts':'Charts', 'dash.tab.ranking':'Device ranking', 'dash.tab.score':'Efficiency',
    'dash.tab.stats':'Statistics', 'dash.tab.savings':'Savings', 'dash.tab.scenarios':'Scenarios',
    'dash.tab.whatif':'What if?', 'dash.tab.compare':'Comparison',
    'footer.usageNow':'USAGE NOW', 'footer.pvProduction':'PV PRODUCTION', 'footer.netBalance':'NET BALANCE',
    'footer.today':'TODAY', 'footer.netCostToday':'NET COST TODAY', 'footer.costMonth':'COST THIS MONTH',
    'footer.costYear':'COST THIS YEAR', 'footer.active':'ACTIVE', 'footer.co2Year':'CO₂ (year, est.)', 'footer.battery':'ENERGY STORAGE',

    // ---------- pet / progression ----------
    'pet.title':'Assistant', 'pet.level':'Level', 'pet.xp':'Experience', 'pet.feed':'Feed', 'pet.tips':'Tips',
    'pet.quests':'Quests', 'pet.noTips':'No new tips — everything looks good!', 'pet.unlocks':'Unlocked features',
    'pet.nextUnlock':'Next unlock', 'pet.questCompleted':'Quest completed!', 'pet.questClaim':'Claim reward',
    'pet.questProgress':'Progress',
    'pet.trick.spin':'Spin', 'pet.trick.pulse':'Data pulse', 'pet.trick.burst':'Bit burst',
    'pet.trick.shimmer':'Shimmer', 'pet.trick.aura':'Energy aura', 'pet.trick.legend':'Legendary form',
    'pet.leveledUp':'leveled up to {level}: {stage}!',
    'pet.xpReason.dailyOutcome':'day outcome', 'pet.xpReason.schedule':'schedule saved', 'pet.xpReason.pvInstall':'PV installed',
    'pet.xpReason.quest':'quest completed', 'pet.xpReason.analysis':'data analysis', 'pet.xpReason.efficiency':'efficiency improved',
    'unlock.tipsBasic':'Basic assistant tips', 'unlock.tipTrends':'Tips based on weekly trends',
    'unlock.schedulePresets':'Quick schedule templates', 'unlock.tipSeasonal':'Seasonal PV tips',
    'unlock.compareOverlay':'Household-average comparison overlay', 'unlock.tipEfficiency':'Efficiency-change tips',
    'unlock.questMaster':'Extra, harder quests',
    'quest.firstPv.title':'First PV installation', 'quest.firstPv.desc':'Install at least one solar panel.',
    'quest.firstSchedule.title':'First schedule', 'quest.firstSchedule.desc':'Save a custom schedule for any device.',
    'quest.firstBattery.title':'Energy storage', 'quest.firstBattery.desc':'Install a home battery storage unit.',
    'quest.frugalMorning.title':'Frugal morning', 'quest.frugalMorning.desc':'Cut energy use between 06:00 and 09:00 by at least 15% vs. a typical day.',
    'quest.sunShift.title':'Chase the sun', 'quest.sunShift.desc':'Reach at least 60% self-consumption of PV energy during the day.',
    'quest.cheapTariff.title':'Cheap tariff', 'quest.cheapTariff.desc':'Use most of your energy during the tariff\'s cheaper hours.',
    'quest.maxSelfuse.title':'Maximum self-consumption', 'quest.maxSelfuse.desc':'Reach at least 80% self-consumption of PV energy.',

    // ---------- advisor tips ----------
    'advisor.expensiveDevice':'{name} is currently running in the expensive {tariff} band. You could move its schedule to cheaper hours (from {time}).',
    'advisor.expensiveDeviceGeneric':'{name} is currently running in the expensive {tariff} band. Consider moving its schedule to cheaper hours.',
    'advisor.pvSurplus':'Your PV production is currently high (surplus {watts}). It could be a good idea to run high-power devices now.',
    'advisor.longRunning':'{name} has been running continuously for {hours} hours. Is it still needed?',
    'advisor.trendUp':'Energy consumption has risen {pct}% over the last few days compared to the previous week.',
    'advisor.poorAim':'Your PV installation is producing less than it could due to unfavorable panel placement (aim quality: {pct}%).',
    'advisor.seasonWinter':'Winter means short days and frequent clouds — PV production will be lower than in summer, that\'s normal.',
    'advisor.seasonSummer':'Summer means long days and strong sunshine — this is the best time for high PV self-consumption.',
    'advisor.scoreImproved':'Your energy efficiency score improved by {delta} points. Nice work!',
    'advisor.noPv':'You don\'t have a solar installation yet. You can start a PV installation any time from the top bar.',

    // ---------- new simulation ----------
    'newsim.title':'New simulation', 'newsim.projectName':'Project name', 'newsim.tariff':'Starting tariff',
    'newsim.budget':'Budget (informational)', 'newsim.confirmStart':'Start new simulation',
    'newsim.warning':'This will remove the current project (devices, PV, progress). Save it first if you want to keep it.',

    // ---------- log / toast messages ----------
    'log.simStarted':'Simulation started', 'log.simPaused':'Simulation paused',
    'log.simSpeed':'Simulation speed: {mult}x', 'log.skippedTo':'Skipped to {time}',
    'log.deviceStateChange':'{name} → {state}',
    'log.projectSaved':'Project saved locally.', 'log.projectSaveError':'Error saving project.',
    'log.noSavedProject':'No saved project.', 'log.projectLoaded':'Project loaded.',
    'log.projectLoadError':'Error loading project (corrupt JSON).', 'log.projectExported':'Project exported to file.',
    'log.projectImported':'Project imported.', 'log.projectImportError':'Import error: invalid JSON file.',
    'log.fileReadError':'Could not read the file.', 'log.newProjectCreated':'New project created.',
    'log.simulationReset':'Simulation has been reset.', 'log.nothingToUndo':'Nothing to undo.',
    'log.undone':'Undone (Ctrl+Z).', 'log.nothingToRedo':'Nothing to redo.', 'log.redone':'Redone (Ctrl+Y).',

    // ---------- energy score / alerts ----------
    'score.noDevices':'No devices.', 'score.addDevices':'Add devices to see an analysis.',
    'score.biggestProblem':'{name} accounts for {pct}% of monthly consumption.', 'score.noProblems':'No significant issues.',
    'score.biggestOpportunity':'Automatically switching off "{name}" standby ({watts}W) could cut idle consumption.',
    'score.addMorePV':'Consider adding more PV panels to increase self-consumption.',
    'score.automateNight':'Consider automations that turn devices off overnight.',
    'alert.runningHours':'{name} has been running for {hours} hours.', 'alert.standbyHours':'{name} has been in standby for {hours} hours.',
    'alert.topShare':'{name} accounts for {pct}% of today\'s consumption.',
    'alert.washerTip':'The washing machine uses the most energy while heating water.',
    'alert.pvSurplus':'PV panels currently cover 100% of usage and export {watts} of surplus.',
  },
};
