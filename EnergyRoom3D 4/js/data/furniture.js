/**
 * FURNITURE DATA REPOSITORY
 * Furniture never affects energy consumption (spec section 6), but is
 * fully transformable (move/rotate/scale/delete/duplicate) like devices.
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
];

function getFurnitureDefinition(id){ return FURNITURE_DEFINITIONS.find(f=>f.id===id); }
