/**
 * I18N ENGINE
 * Two supported languages (PL/EN) today, built so a third is just
 * another key in I18N_DICT + NAME_EN-style lookup table - no code
 * changes needed elsewhere (spec section 1: "System powinien być
 * przygotowany tak, aby w przyszłości można było łatwo dodać kolejne
 * języki"). Every piece of UI text in the app should go through
 * I18n.t(key, params) rather than being hard-coded, so switching
 * languages re-renders the whole interface consistently with no mixing.
 * Pure logic - no DOM writes here; UIManager re-renders itself on
 * I18n.onChange().
 */
const I18n = {
  lang: 'pl',
  _listeners: [],
  FALLBACK: 'pl',

  init(){
    const saved = (typeof localStorage!=='undefined') ? localStorage.getItem('energyroom_lang') : null;
    this.lang = (saved==='en'||saved==='pl') ? saved : 'pl';
    document.documentElement.setAttribute('lang', this.lang);
    this.applyStatic();
  },
  setLang(lang){
    if (lang!==('en') && lang!=='pl') return;
    this.lang = lang;
    try{ localStorage.setItem('energyroom_lang', lang); }catch(e){}
    document.documentElement.setAttribute('lang', lang);
    this.applyStatic();
    this._listeners.forEach(cb=>cb(lang));
  },
  onChange(cb){ this._listeners.push(cb); },
  /** Re-applies translations to every element carrying data-i18n (textContent) or
   *  data-i18n-title (title attribute) - the simple, scalable path for static chrome
   *  text that doesn't need any dynamic data (modal headers, footer labels, etc). */
  applyStatic(){
    document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = this.t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = this.t(el.getAttribute('data-i18n-title')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{ el.placeholder = this.t(el.getAttribute('data-i18n-placeholder')); });
  },

  /** Main translation lookup. params values are substituted for {name} placeholders. */
  t(key, params){
    let str = (I18N_DICT[this.lang] && I18N_DICT[this.lang][key]);
    if (str == null) str = (I18N_DICT[this.FALLBACK] && I18N_DICT[this.FALLBACK][key]);
    if (str == null) return key;
    if (params){
      for (const k in params){
        str = str.replace(new RegExp('\\{'+k+'\\}','g'), params[k]);
      }
    }
    return str;
  },
  /** number formatting that respects the active language's convention (comma vs dot decimal) without needing full Intl setup everywhere */
  num(n, decimals){
    const s = (typeof n === 'number') ? n.toFixed(decimals==null?2:decimals) : n;
    return this.lang==='pl' ? String(s).replace('.', ',') : String(s);
  },

  deviceName(def){
    if (this.lang==='en' && NAME_EN[def.id]) return NAME_EN[def.id];
    return def.name;
  },
  deviceState(state){
    const key = 'devstate.'+state;
    const v = this.t(key);
    return v===key ? state : v;
  },
  category(catId){
    const key = 'category.'+catId;
    const v = this.t(key);
    return v===key ? catId : v;
  },
  dayShort(dayIdx){ return this.t('dayshort.'+dayIdx); },
  dayLong(dayIdx){ return this.t('daylong.'+dayIdx); },
  monthName(monthIdx){ return this.t('month.'+monthIdx); },
};

/** English display names for every device/furniture/solar/battery catalog id (spec: device names must translate too). */
const NAME_EN = {
  // devices
  gaming_pc:'Gaming PC', office_pc:'Office PC', laptop:'Laptop', monitor_24:'Monitor 24"', monitor_27:'Monitor 27"',
  router:'Router', printer:'Printer', console:'Game Console', fridge:'Refrigerator', washer:'Washing Machine',
  dryer:'Tumble Dryer', dishwasher:'Dishwasher', oven:'Oven', microwave:'Microwave', kettle:'Electric Kettle',
  coffee_machine:'Coffee Machine', toaster:'Toaster', vacuum:'Vacuum Cleaner', tv_55:'TV 55"', soundbar:'Soundbar',
  speaker:'Speaker', settop_box:'TV Set-Top Box', ceiling_lamp:'Ceiling Lamp', desk_lamp:'Desk Lamp',
  floor_lamp:'Floor Lamp', led_strip:'LED Strip', ac_unit:'Air Conditioner', fan:'Fan', heater:'Electric Heater',
  fan_heater:'Fan Heater', smart_bulb:'Smart Bulb', smart_plug:'Smart Plug', smart_hub:'Smart Hub',
  motion_sensor:'Motion Sensor', smart_camera:'Camera', smart_speaker:'Smart Speaker', phone_charger:'Phone Charger',
  laptop_charger:'Laptop Charger', aquarium:'Aquarium', air_purifier:'Air Purifier', humidifier:'Humidifier',
  freezer:'Freezer', range_hood:'Range Hood', induction_cooktop:'Induction Cooktop', robot_vacuum:'Robot Vacuum',
  water_heater:'Electric Water Heater', fireplace:'Electric Fireplace', dehumidifier:'Dehumidifier',
  ceiling_fan:'Ceiling Fan', thermostat:'Smart Thermostat', smart_lock:'Smart Lock', smoke_detector:'Smoke Detector',
  hairdryer:'Hair Dryer', iron:'Iron', ev_charger:'EV Charger (Wallbox)', treadmill:'Treadmill',
  heat_pump:'Heat Pump (Air-to-Water)', floor_heating:'Underfloor Heating', portable_ac:'Portable Air Conditioner',
  projector:'Projector', record_player:'Record Player', pendant_light:'Pendant Light', night_light:'Night Light',
  wine_fridge:'Wine Fridge', blender:'Blender', nas_drive:'NAS Server', video_doorbell:'Video Doorbell',
  garden_pump:'Garden Irrigation Pump', ebike_charger:'E-Bike/Scooter Charger', pool_pump:'Pool Pump',
  outdoor_lighting:'Outdoor Lighting', lawn_mower_dock:'Robot Mower Dock', sauna_heater:'Electric Sauna Heater',
  // furniture
  bed:'Bed', desk:'Desk', chair:'Chair', gaming_chair:'Gaming Chair', sofa:'Sofa', coffee_table:'Coffee Table',
  wardrobe:'Wardrobe', dresser:'Dresser', bookshelf:'Bookshelf', shelves:'Shelves', tv_stand:'TV Stand',
  table:'Table', dining_chair:'Dining Chairs', rug:'Rug', poster:'Poster', wall_quote:'Wall Quote',
  book_stack:'Book Stack', chairdrobe:'Chairdrobe', potted_plant:'Potted Plant', wall_clock:'Wall Clock',
  mirror:'Mirror', rgb_croissant:'RGB Croissant', kitchen_counter:'Kitchen Counter', kitchen_island:'Kitchen Island',
  kitchen_sink:'Kitchen Sink', pantry_cabinet:'Pantry Cabinet', bathtub:'Bathtub', toilet:'Toilet',
  bathroom_sink:'Bathroom Sink', shower_cabin:'Shower Cabin', towel_rack:'Towel Rack', bar_stool:'Bar Stool',
  armchair:'Armchair', floor_vase:'Floor Vase', curtains:'Curtains', nightstand:'Nightstand', crib:'Crib',
  whiteboard:'Whiteboard', piano:'Piano', standing_desk:'Standing Desk', office_cabinet:'Office Filing Cabinet',
  kitchen_cabinet_wall:'Kitchen Wall Cabinet', bathroom_cabinet:'Bathroom Mirror Cabinet', bike_rack:'Bike Rack',
  bar_cart:'Bar Cart', shoe_rack:'Shoe Rack', laundry_basket:'Laundry Basket', trash_bin:'Trash Bin',
  car:'Car', workbench:'Workbench', garageshelf:'Workshop Shelving', tool_cabinet:'Tool Cabinet',
  // solar / battery
  panel_400:'PV Panel 400W', panel_330:'PV Panel 330W', panel_450:'PV Panel 450W (Half-Cut)',
  battery_5:'Energy Storage 5 kWh', battery_10:'Energy Storage 10 kWh', battery_15:'Energy Storage 15 kWh',
};
