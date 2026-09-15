/**
 * FURNITURE DATA REPOSITORY
 * Furniture never affects energy consumption (spec section 6), but is
 * fully transformable (move/rotate/scale/delete/duplicate) like devices.
 *
 * onlyIn: optional array of room `type`s this item is restricted to
 * (e.g. ['kitchen']). Omit for furniture usable in any room — mirrors
 * how garage-only items (car/workbench/garageshelf) already worked,
 * just generalized so UIManager can filter data-driven instead of by
 * a hardcoded id list.
 */

const FURNITURE_DEFINITIONS = [
  { id:'bed',        name:'Łóżko',          modelType:'bed',        footprint:[1.6,2.0] },
  { id:'desk',       name:'Biurko',         modelType:'desk',       footprint:[1.4,0.7] },
  { id:'chair',      name:'Krzesło',        modelType:'chair',      footprint:[0.5,0.5] },
  { id:'gaming_chair', name:'Fotel gamingowy', modelType:'gamingchair', footprint:[0.65,0.65] },
  { id:'sofa',       name:'Sofa',           modelType:'sofa',       footprint:[2.0,0.9] },
  { id:'coffee_table', name:'Stolik',       modelType:'coffeetable',footprint:[1.0,0.5] },
  { id:'wardrobe',   name:'Szafa',          modelType:'wardrobe',   footprint:[1.2,0.6] },
  { id:'dresser',    name:'Komoda',         modelType:'dresser',    footprint:[1.0,0.45] },
  { id:'bookshelf',  name:'Regał',          modelType:'bookshelf',  footprint:[0.9,0.3] },
  { id:'shelves',    name:'Półki',          modelType:'shelves',    footprint:[0.8,0.25] },
  { id:'tv_stand',   name:'Szafka RTV',     modelType:'tvstand',    footprint:[1.4,0.4] },
  { id:'table',      name:'Stół',           modelType:'table',      footprint:[1.4,0.8] },
  { id:'dining_chair', name:'Krzesła',      modelType:'diningchair',footprint:[0.45,0.45] },
  { id:'rug',        name:'Dywan',          modelType:'rug',        footprint:[2.2,1.6] },
  // ---- decorative / variety pack ----
  { id:'poster',     name:'Plakat',         modelType:'poster',     footprint:[0.6,0.04] },
  { id:'wall_quote', name:'Napis na ścianie', modelType:'walltext', footprint:[0.9,0.04] },
  { id:'book_stack', name:'Stos książek',   modelType:'books',      footprint:[0.3,0.22] },
  { id:'chairdrobe', name:'Chairdrobe',     modelType:'chairdrobe', footprint:[1.1,0.6] },
  { id:'potted_plant', name:'Roślina doniczkowa', modelType:'plant', footprint:[0.35,0.35] },
  { id:'wall_clock', name:'Zegar ścienny',  modelType:'wallclock',  footprint:[0.3,0.05] },
  { id:'mirror',     name:'Lustro',         modelType:'mirror',     footprint:[0.5,0.05] },
  // ---- easter egg ----
  { id:'rgb_croissant', name:'Rogalik RGB 🥐', modelType:'croissant', footprint:[0.3,0.2] },

  // ---- kuchnia ----
  { id:'kitchen_counter', name:'Blat kuchenny', modelType:'kitchencounter', footprint:[1.2,0.6], onlyIn:['kitchen'] },
  { id:'kitchen_island',  name:'Wyspa kuchenna', modelType:'kitchenisland', footprint:[1.4,0.8], onlyIn:['kitchen'] },
  { id:'kitchen_sink',    name:'Zlew kuchenny',  modelType:'kitchensink',   footprint:[0.8,0.55], onlyIn:['kitchen'] },
  { id:'pantry_cabinet',  name:'Szafka spiżarniana', modelType:'pantry',    footprint:[0.6,0.5], onlyIn:['kitchen'] },

  // ---- łazienka ----
  { id:'bathtub',       name:'Wanna',                 modelType:'bathtub',      footprint:[1.7,0.75], onlyIn:['bathroom'] },
  { id:'toilet',        name:'Toaleta (WC)',          modelType:'toilet',       footprint:[0.4,0.65], onlyIn:['bathroom'] },
  { id:'bathroom_sink', name:'Umywalka',              modelType:'bathroomsink', footprint:[0.6,0.45], onlyIn:['bathroom'] },
  { id:'shower_cabin',  name:'Kabina prysznicowa',    modelType:'shower',      footprint:[0.9,0.9],  onlyIn:['bathroom'] },
  { id:'towel_rack',    name:'Wieszak na ręczniki',   modelType:'towelrack',   footprint:[0.5,0.06], onlyIn:['bathroom'] },

  // ---- ogólne / salon / sypialnia / biuro ----
  { id:'bar_stool',  name:'Hoker barowy',       modelType:'barstool', footprint:[0.35,0.35] },
  { id:'armchair',   name:'Fotel',              modelType:'armchair', footprint:[0.8,0.8] },
  { id:'floor_vase', name:'Wazon podłogowy',    modelType:'vase',     footprint:[0.25,0.25] },
  { id:'curtains',   name:'Zasłony',            modelType:'curtains', footprint:[1.6,0.06] },
  { id:'nightstand', name:'Szafka nocna',       modelType:'nightstand', footprint:[0.4,0.35] },
  { id:'crib',       name:'Łóżeczko dziecięce', modelType:'crib',     footprint:[0.7,1.3] },
  { id:'whiteboard', name:'Tablica',            modelType:'whiteboard', footprint:[1.2,0.06] },

  // ---- rozszerzenie: salon / biuro ----
  { id:'piano',         name:'Pianino',                modelType:'piano',        footprint:[1.4,0.55], onlyIn:['living'] },
  { id:'standing_desk', name:'Biurko z regulacją wysokości', modelType:'standingdesk', footprint:[1.3,0.65], onlyIn:['office'] },
  { id:'office_cabinet',name:'Szafka biurowa z segregatorami', modelType:'officecabinet', footprint:[0.5,0.55], onlyIn:['office'] },

  // ---- rozszerzenie: kuchnia / łazienka ----
  { id:'kitchen_cabinet_wall', name:'Szafka kuchenna wisząca', modelType:'kitchencabinet', footprint:[0.7,0.32], onlyIn:['kitchen'] },
  { id:'bathroom_cabinet',     name:'Szafka łazienkowa z lustrem', modelType:'bathroomcabinet', footprint:[0.5,0.16], onlyIn:['bathroom'] },

  // ---- rozszerzenie: garaż ----
  { id:'bike_rack', name:'Stojak na rowery', modelType:'bikerack', footprint:[1.1,0.4], onlyIn:['garage'] },

  // ---- rozszerzenie: ogólne (dowolny pokój) ----
  { id:'bar_cart',       name:'Barek na kółkach',   modelType:'barcart',      footprint:[0.5,0.35] },
  { id:'shoe_rack',      name:'Szafka na buty',     modelType:'shoerack',     footprint:[0.7,0.32] },
  { id:'laundry_basket', name:'Kosz na pranie',     modelType:'laundrybasket',footprint:[0.42,0.42] },
  { id:'trash_bin',      name:'Kosz na śmieci',     modelType:'trashbin',     footprint:[0.3,0.3] },
];

function getFurnitureDefinition(id){ return FURNITURE_DEFINITIONS.find(f=>f.id===id); }
