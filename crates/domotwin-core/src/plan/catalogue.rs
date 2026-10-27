//! The fixed lists of the plan format: the kinds of items (with their usual size, colour and
//! behaviour) and their styles, floor materials, wall finishes and door styles. See
//! `docs/plan-format.md`.

use super::Rgb8;

/// What a kind of furniture does beyond being a box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KindFlags {
    /// Emits light and can be switched (`lightOff`, light settings).
    pub light: bool,
    /// Ignored by the overlap and door checks (hung, flat or ceiling items).
    pub soft: bool,
    /// Hangs from the ceiling (a cord or rod reaches up to it).
    pub hanging: bool,
    /// Fixed to a wall: hidden with that wall when it is cut away.
    pub wall_decor: bool,
}

/// Default values of a kind.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KindInfo {
    /// The name in plan files.
    pub name: &'static str,
    /// Usual width, depth and height (cm).
    pub size: [f64; 3],
    /// Default colour.
    pub color: Rgb8,
    /// Default elevation of the underside (cm).
    pub elevation: f64,
    /// Behaviour.
    pub flags: KindFlags,
    /// Allowed variants (the default model has none).
    pub variants: &'static [&'static str],
}

const fn rgb(hex: u32) -> Rgb8 {
    Rgb8::from_u32(hex)
}

const NONE: KindFlags = KindFlags {
    light: false,
    soft: false,
    hanging: false,
    wall_decor: false,
};
const LIGHT: KindFlags = KindFlags {
    light: true,
    ..NONE
};
const SOFT_LIGHT: KindFlags = KindFlags {
    light: true,
    soft: true,
    ..NONE
};
const HANGING_LIGHT: KindFlags = KindFlags {
    light: true,
    soft: true,
    hanging: true,
    ..NONE
};
const WALL: KindFlags = KindFlags {
    wall_decor: true,
    ..NONE
};
const SOFT_WALL: KindFlags = KindFlags {
    soft: true,
    wall_decor: true,
    ..NONE
};
const SOFT: KindFlags = KindFlags { soft: true, ..NONE };
const SOFT_HANGING: KindFlags = KindFlags {
    soft: true,
    hanging: true,
    ..NONE
};
const WALL_LIGHT: KindFlags = KindFlags {
    light: true,
    wall_decor: true,
    ..NONE
};
const SOFT_WALL_LIGHT: KindFlags = KindFlags {
    light: true,
    soft: true,
    wall_decor: true,
    ..NONE
};

macro_rules! kinds {
    ($($variant:ident = $name:literal, [$w:expr, $h:expr, $z:expr], $color:literal, $elev:expr, $flags:expr, [$($v:literal),*];)*) => {
        /// A kind of item (`kind`). Unknown kinds read as [`Kind::Box`].
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Kind {
            /// `box`: a plain box (and what a piece drawn from a 3D model is when it has no kind).
            Box,
            $(
                #[doc = concat!("`", $name, "`")]
                $variant,
            )*
        }

        impl Kind {
            /// Every kind but `box`, in the order of the format.
            pub const ALL: &'static [Kind] = &[$(Kind::$variant),*];

            /// The name in plan files.
            pub const fn name(self) -> &'static str {
                match self {
                    Kind::Box => "box",
                    $(Kind::$variant => $name,)*
                }
            }

            /// Reads a kind name; unknown names give `None`.
            pub fn from_name(name: &str) -> Option<Kind> {
                match name {
                    "box" => Some(Kind::Box),
                    $($name => Some(Kind::$variant),)*
                    _ => None,
                }
            }

            /// Defaults and behaviour of the kind.
            pub const fn info(self) -> KindInfo {
                match self {
                    Kind::Box => KindInfo {
                        name: "box",
                        size: [60.0, 60.0, 60.0],
                        color: rgb(0xb8ad9a),
                        elevation: 0.0,
                        flags: NONE,
                        variants: &[],
                    },
                    $(Kind::$variant => KindInfo {
                        name: $name,
                        size: [$w as f64, $h as f64, $z as f64],
                        color: rgb($color),
                        elevation: $elev as f64,
                        flags: $flags,
                        variants: &[$($v),*],
                    },)*
                }
            }
        }
    };
}

kinds! {
    Sofa = "sofa", [210, 90, 85], 0x6b6e5c, 0, NONE, ["leather", "chesterfield"];
    Armchair = "armchair", [80, 80, 85], 0x965a3d, 0, NONE, ["leather", "wingback"];
    CoffeeTable = "coffee-table", [110, 65, 42], 0xa97a50, 0, NONE, ["round", "glass"];
    Tv = "tv", [140, 35, 55], 0xe8e4d9, 0, NONE, ["wall-mounted"];
    Plant = "plant", [35, 35, 80], 0x536c42, 0, NONE, ["monstera", "pothos", "dracaena", "fiddle-leaf", "snake-plant"];
    Bed = "bed", [160, 200, 55], 0xaab09d, 0, NONE, ["metal", "upholstered", "four-poster"];
    Nightstand = "nightstand", [40, 40, 48], 0xa6835b, 0, LIGHT, ["three-drawers", "one-drawer"];
    Dresser = "dresser", [100, 45, 85], 0xbd9a70, 0, NONE, ["antique"];
    Desk = "desk", [150, 70, 75], 0xb38b5e, 0, NONE, ["standing"];
    Chair = "chair", [50, 50, 80], 0x555c54, 0, NONE, ["bistro", "upholstered"];
    Bookcase = "bookcase", [110, 35, 180], 0xb18455, 0, NONE, [];
    Counter = "counter", [180, 60, 90], 0xc8b294, 0, NONE, [];
    Sink = "sink", [80, 55, 94], 0xb5c2bd, 0, NONE, [];
    Stove = "stove", [60, 60, 90], 0x535954, 0, NONE, ["gas"];
    Fridge = "fridge", [70, 70, 185], 0xe6e7dd, 0, NONE, ["french-door"];
    DiningTable = "dining-table", [140, 75, 75], 0xbb9061, 0, NONE, ["pedestal"];
    Bathtub = "bathtub", [170, 75, 60], 0xecefe7, 0, NONE, ["freestanding"];
    Vanity = "vanity", [75, 50, 85], 0xe1ded0, 0, NONE, ["pedestal", "double"];
    TallCabinet = "tall-cabinet", [60, 65, 190], 0xe8e5d9, 0, NONE, ["wardrobe", "sliding"];
    Toilet = "toilet", [40, 70, 75], 0xeeeede, 0, NONE, ["wall-hung"];
    Washer = "washer", [65, 65, 90], 0xdedfd6, 0, NONE, [];
    Dryer = "dryer", [65, 65, 90], 0xe1e2d8, 0, NONE, [];
    Bin = "bin", [40, 40, 65], 0x656e61, 0, NONE, [];
    WallCabinet = "wall-cabinet", [100, 40, 80], 0xd8ccb4, 140, WALL, [];
    Shelf = "shelf", [30, 40, 120], 0xcdb894, 0, NONE, [];
    Trolley = "trolley", [100, 45, 90], 0xf1efe9, 0, NONE, [];
    Dishwasher = "dishwasher", [60, 60, 86], 0xc9ccca, 0, NONE, [];
    Hood = "hood", [60, 45, 12], 0xe9eae7, 138, WALL, [];
    Bulkhead = "bulkhead", [200, 70, 30], 0xf2f1ec, 228, WALL, [];
    Backsplash = "backsplash", [150, 1, 55], 0xf2f1ec, 90, SOFT_WALL, [];
    ShoeCabinet = "shoe-cabinet", [80, 25, 100], 0xf2f1ec, 0, NONE, [];
    Radiator = "radiator", [120, 8, 18], 0xf2f2ef, 0, WALL, [];
    Curtain = "curtain", [200, 6, 235], 0xf1ece2, 0, SOFT_WALL, ["closed"];
    Picture = "picture", [40, 3, 50], 0x24211e, 140, SOFT_WALL, ["engraving", "portrait", "comic", "map", "poster"];
    PictureWall = "picture-wall", [120, 3, 100], 0x8a6a3f, 120, SOFT_WALL, [];
    Mirror = "mirror", [60, 4, 90], 0xb8964f, 110, SOFT_WALL, ["white"];
    Chandelier = "chandelier", [60, 60, 45], 0xc8cbc9, 195, HANGING_LIGHT, [];
    Pendant = "pendant", [47, 47, 45], 0xf4f3ef, 150, HANGING_LIGHT, ["cylinder", "globe", "dome"];
    Spotlight = "spotlight", [10, 10, 3], 0xf4f3ef, 240, SOFT_LIGHT, [];
    FloorLamp = "floor-lamp", [35, 35, 160], 0xf1e7d2, 0, LIGHT, ["arc", "tripod"];
    CeilingLight = "ceiling-light", [36, 36, 14], 0xc9a45a, 250, HANGING_LIGHT, ["rosette", "panel"];
    CeilingFan = "ceiling-fan", [105, 105, 30], 0xb9bcbc, 215, HANGING_LIGHT, [];
    TableLamp = "table-lamp", [30, 30, 48], 0xc9a77a, 0, SOFT_LIGHT, [];
    Lantern = "lantern", [18, 18, 30], 0x3b3d3c, 0, SOFT_LIGHT, [];
    DeskLamp = "desk-lamp", [16, 16, 55], 0x1d1f20, 0, SOFT_LIGHT, [];
    GlazedBookcase = "glazed-bookcase", [86, 32, 150], 0x9c5a2c, 0, NONE, [];
    OpenShelving = "open-shelving", [60, 33, 170], 0x3a2b20, 0, NONE, ["metal"];
    Chest = "chest", [105, 55, 48], 0x6e3f26, 0, NONE, [];
    SideTable = "side-table", [40, 35, 60], 0x8a5a36, 0, NONE, ["marble", "hairpin"];
    OfficeChair = "office-chair", [60, 60, 110], 0xf1efea, 0, NONE, [];
    RoundTable = "round-table", [45, 45, 50], 0x232323, 0, NONE, [];
    Console = "console", [90, 45, 75], 0x7a4a2c, 0, NONE, [];
    Printer = "printer", [42, 38, 25], 0xe8e8e6, 0, NONE, [];
    Printer3d = "3d-printer", [35, 36, 49], 0x1f2022, 0, NONE, ["enclosed"];
    RobotVacuum = "robot-vacuum", [40, 50, 12], 0x3d4147, 0, NONE, [];
    // The library (M17, D-074): pieces drawn from the usual sizes of real ones.
    CornerSofa = "corner-sofa", [270, 170, 85], 0x6b6e5c, 0, NONE, ["left"];
    Ottoman = "ottoman", [60, 60, 42], 0x8a7a66, 0, NONE, ["round"];
    TvStand = "tv-stand", [160, 40, 50], 0x8a6a4a, 0, NONE, [];
    Rug = "rug", [230, 160, 1], 0xc9b9a0, 0, SOFT, ["round", "striped"];
    Fireplace = "fireplace", [150, 40, 115], 0xece8df, 0, NONE, ["stove", "electric"];
    Piano = "piano", [150, 60, 125], 0x1d1b1a, 0, NONE, ["digital"];
    Speaker = "speaker", [12, 12, 17], 0x3a3d40, 0, NONE, ["display", "floor", "soundbar"];
    RockingChair = "rocking-chair", [62, 90, 100], 0x7a5537, 0, NONE, [];
    Bench = "bench", [120, 40, 46], 0xa97a50, 0, NONE, ["upholstered"];
    Aquarium = "aquarium", [100, 40, 140], 0x2f2b28, 0, LIGHT, [];
    Clock = "clock", [32, 5, 32], 0x2a2a2a, 175, SOFT_WALL, [];
    Vase = "vase", [16, 16, 30], 0xc9c2b4, 0, NONE, ["flowers", "branches"];
    Books = "books", [24, 17, 12], 0x8b3a2e, 0, NONE, ["upright"];
    WallShelf = "wall-shelf", [80, 22, 25], 0xb18455, 150, WALL, [];
    CoatRack = "coat-rack", [45, 45, 180], 0x3f3127, 0, NONE, [];
    BarStool = "bar-stool", [40, 40, 65], 0x3d4147, 0, NONE, ["backrest"];
    KitchenIsland = "kitchen-island", [180, 90, 91], 0xc8b294, 0, NONE, ["sink", "hob"];
    Sideboard = "sideboard", [160, 45, 80], 0x7a4a2c, 0, NONE, [];
    Microwave = "microwave", [50, 38, 30], 0x2f3133, 0, NONE, [];
    Oven = "oven", [60, 60, 210], 0xe8e5d9, 0, NONE, ["double"];
    CoffeeMachine = "coffee-machine", [24, 42, 37], 0x2d2f31, 0, NONE, ["espresso"];
    Kettle = "kettle", [22, 16, 25], 0xe9e9e6, 0, NONE, [];
    Toaster = "toaster", [28, 18, 19], 0xc9ccca, 0, NONE, [];
    WineCooler = "wine-cooler", [60, 57, 85], 0x2a2c2e, 0, NONE, [];
    Freezer = "freezer", [110, 65, 85], 0xf1f1ee, 0, NONE, ["upright"];
    Crib = "crib", [66, 126, 90], 0xf2f1ec, 0, NONE, [];
    BunkBed = "bunk-bed", [100, 212, 160], 0xd8c4a0, 0, NONE, [];
    ClothesRack = "clothes-rack", [120, 45, 160], 0x2b2b2b, 0, NONE, [];
    Shower = "shower", [90, 90, 205], 0xf2f1ec, 0, NONE, ["walk-in", "quadrant"];
    TowelRadiator = "towel-radiator", [50, 8, 120], 0xf2f2ef, 20, WALL, [];
    LaundryBasket = "laundry-basket", [40, 40, 55], 0xcdb894, 0, NONE, [];
    WaterHeater = "water-heater", [56, 56, 150], 0xf0efea, 0, NONE, [];
    Boiler = "boiler", [44, 34, 72], 0xf2f2ef, 120, WALL, [];
    Furnace = "furnace", [55, 75, 125], 0xc9ccca, 0, NONE, [];
    HeatPump = "heat-pump", [90, 22, 30], 0xf4f4f1, 210, WALL, [];
    AirPurifier = "air-purifier", [30, 30, 60], 0xf0efea, 0, NONE, [];
    Dehumidifier = "dehumidifier", [36, 26, 56], 0xf0efea, 0, NONE, [];
    Humidifier = "humidifier", [22, 22, 30], 0xf0efea, 0, NONE, [];
    Fan = "fan", [40, 40, 125], 0xf0efea, 0, NONE, ["tower", "desk"];
    EvCharger = "ev-charger", [25, 14, 40], 0x2d2f31, 100, WALL, [];
    ElectricalPanel = "electrical-panel", [40, 10, 62], 0xd6d9d8, 110, WALL, [];
    Router = "router", [26, 18, 5], 0x2a2c2e, 0, NONE, ["mesh"];
    AccessPoint = "access-point", [20, 20, 4], 0xf4f4f1, 261, SOFT_HANGING, [];
    Thermostat = "thermostat", [9, 3, 12], 0xf4f4f1, 145, SOFT_WALL, [];
    SmokeDetector = "smoke-detector", [12, 12, 4], 0xf4f4f1, 261, SOFT_HANGING, [];
    Camera = "camera", [8, 9, 12], 0xf4f4f1, 0, NONE, ["wall", "dome"];
    WallTablet = "wall-tablet", [26, 3, 18], 0x1d1f20, 140, SOFT_WALL, [];
    Sensor = "sensor", [6, 3, 6], 0xf4f4f1, 150, SOFT_WALL, ["motion"];
    WallLight = "wall-light", [18, 14, 26], 0xf1e7d2, 175, WALL_LIGHT, ["swing-arm"];
    LightStrip = "light-strip", [100, 2, 1], 0xf4f1e8, 140, SOFT_WALL_LIGHT, [];
    TrackLight = "track-light", [120, 10, 12], 0x1d1f20, 253, HANGING_LIGHT, [];
    Monitor = "monitor", [61, 20, 45], 0x1d1f20, 0, NONE, [];
    Computer = "computer", [21, 45, 46], 0x1f2022, 0, NONE, [];
    FilingCabinet = "filing-cabinet", [40, 58, 62], 0xe8e8e6, 0, NONE, [];
    Treadmill = "treadmill", [80, 185, 140], 0x2b2d2f, 0, NONE, [];
    ExerciseBike = "exercise-bike", [55, 120, 125], 0x2b2d2f, 0, NONE, [];
    PetBed = "pet-bed", [70, 55, 20], 0x8a7a66, 0, NONE, [];
    CatTree = "cat-tree", [50, 50, 150], 0xcdb894, 0, NONE, [];
    LitterBox = "litter-box", [55, 42, 40], 0xd8d6cf, 0, NONE, ["self-cleaning"];
    PetFeeder = "pet-feeder", [22, 30, 32], 0xf0efea, 0, NONE, [];
    Car = "car", [180, 445, 148], 0x5a6d7c, 0, NONE, [];
    Stairs = "stairs", [100, 280, 270], 0xb79268, 0, NONE, [];
}

/// The usual size, colour and lift of a piece of a kind in one of its styles.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StyleInfo {
    /// Width, depth and height (cm).
    pub size: [f64; 3],
    /// Colour.
    pub color: Rgb8,
    /// Elevation of the underside (cm).
    pub elevation: f64,
}

impl Kind {
    /// Whether this kind emits light (and keeps its `light`).
    pub const fn is_light(self) -> bool {
        self.info().flags.light
    }

    /// Whether the kind has a fire that burns while what it is linked to is on: a switch on, or a
    /// climate entity not off (D-074).
    pub const fn burns(self) -> bool {
        matches!(self, Kind::Fireplace)
    }

    /// Whether `variant` is one of this kind's alternative models.
    pub fn has_variant(self, variant: &str) -> bool {
        self.info().variants.contains(&variant)
    }

    /// The usual size, colour and lift of the kind in `style` (`None`, or a style it does not
    /// have: its own): a style that is another piece of the same family keeps its own (a wood
    /// stove is not a mantel, a soundbar not a smart speaker, an arc lamp reaches over a sofa).
    pub fn style_info(self, style: Option<&str>) -> StyleInfo {
        let info = self.info();
        let own = StyleInfo {
            size: info.size,
            color: info.color,
            elevation: info.elevation,
        };
        let Some(style) = style.filter(|s| self.has_variant(s)) else {
            return own;
        };
        let (size, color, elevation): ([u16; 3], Option<u32>, Option<u16>) = match (self, style) {
            (Kind::Sofa, "leather") => ([210, 90, 85], Some(0x7a4a30), None),
            (Kind::Sofa, "chesterfield") => ([215, 92, 76], Some(0x6e3222), None),
            (Kind::Armchair, "wingback") => ([80, 85, 110], None, None),
            (Kind::CoffeeTable, "round") => ([80, 80, 42], None, None),
            (Kind::Plant, "fiddle-leaf") => ([55, 55, 170], None, None),
            (Kind::Plant, "snake-plant") => ([30, 30, 70], None, None),
            (Kind::Desk, "standing") => ([140, 70, 110], None, None),
            (Kind::Chair, "bistro") => ([42, 50, 85], Some(0x3f3127), None),
            (Kind::Chair, "upholstered") => ([50, 58, 95], Some(0x9a8c78), None),
            (Kind::Fridge, "french-door") => ([91, 75, 178], Some(0xc9ccca), None),
            (Kind::DiningTable, "pedestal") => ([120, 120, 75], None, None),
            (Kind::Vanity, "pedestal") => ([55, 45, 85], Some(0xf2f1ec), None),
            (Kind::Vanity, "double") => ([120, 50, 85], None, None),
            (Kind::TallCabinet, "sliding") => ([180, 62, 220], None, None),
            (Kind::Toilet, "wall-hung") => ([37, 55, 100], None, None),
            (Kind::Pendant, "dome") => ([40, 40, 30], Some(0x2f3133), None),
            (Kind::FloorLamp, "arc") => ([40, 150, 205], None, None),
            (Kind::FloorLamp, "tripod") => ([60, 60, 155], None, None),
            (Kind::CeilingLight, "panel") => ([60, 60, 4], Some(0xf4f4f1), Some(261)),
            (Kind::Rug, "round") => ([160, 160, 1], None, None),
            (Kind::Fireplace, "stove") => ([60, 50, 100], Some(0x2a2b2c), None),
            (Kind::Fireplace, "electric") => ([130, 18, 55], Some(0x1d1f20), Some(45)),
            (Kind::Piano, "digital") => ([135, 40, 90], None, None),
            (Kind::Speaker, "display") => ([18, 10, 13], Some(0xd9d6cf), None),
            (Kind::Speaker, "floor") => ([22, 32, 100], Some(0x2b2724), None),
            (Kind::Speaker, "soundbar") => ([90, 10, 7], Some(0x2a2c2e), None),
            (Kind::Vase, "flowers") => ([22, 22, 48], None, None),
            (Kind::Vase, "branches") => ([26, 26, 85], None, None),
            (Kind::Books, "upright") => ([30, 20, 24], None, None),
            (Kind::CoffeeMachine, "espresso") => ([32, 30, 38], Some(0xc9ccca), None),
            (Kind::Freezer, "upright") => ([60, 65, 170], None, None),
            (Kind::Shower, "walk-in") => ([120, 90, 205], None, None),
            (Kind::Fan, "tower") => ([30, 30, 100], None, None),
            (Kind::Fan, "desk") => ([28, 22, 40], None, None),
            (Kind::Router, "mesh") => ([12, 12, 14], Some(0xf4f4f1), None),
            (Kind::Camera, "wall") => ([8, 15, 9], None, Some(220)),
            (Kind::Camera, "dome") => ([12, 12, 9], None, Some(256)),
            (Kind::Sensor, "motion") => ([8, 6, 8], None, Some(210)),
            (Kind::WallLight, "swing-arm") => ([16, 40, 30], Some(0x2f3133), Some(115)),
            (Kind::LitterBox, "self-cleaning") => ([60, 68, 74], Some(0xe9e9e6), None),
            _ => return own,
        };
        StyleInfo {
            size: size.map(f64::from),
            color: color.map_or(own.color, Rgb8::from_u32),
            elevation: elevation.map_or(own.elevation, f64::from),
        }
    }
}

macro_rules! name_enum {
    ($(#[$doc:meta])* $ty:ident { default $default:ident = $dname:literal, $($variant:ident = $name:literal,)* }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
        pub enum $ty {
            #[doc = concat!("`", $dname, "` (default)")]
            #[default]
            $default,
            $(
                #[doc = concat!("`", $name, "`")]
                $variant,
            )*
        }

        impl $ty {
            /// Every value, the default first, in the order of the format.
            pub const ALL: &'static [$ty] = &[$ty::$default, $($ty::$variant),*];

            /// The name in plan files.
            pub const fn name(self) -> &'static str {
                match self {
                    $ty::$default => $dname,
                    $($ty::$variant => $name,)*
                }
            }

            /// Reads a name; unknown names give the default.
            pub fn from_name(name: &str) -> $ty {
                match name {
                    $($name => $ty::$variant,)*
                    _ => $ty::$default,
                }
            }
        }
    };
}

name_enum!(
    /// Floor materials (`floor.material`).
    Floor {
        default Plain = "plain",
        WoodGrey = "grey-wood",
        WoodOak = "oak",
        WoodPainted = "painted-wood",
        TilesBeige = "beige-tiles",
        TilesWhite = "white-tiles",
    }
);

name_enum!(
    /// Finishes of a room's walls (`walls.finish`).
    WallStyle {
        default White = "plain",
        GreenWainscot = "wainscot",
        ChairRail = "chair-rail",
    }
);

name_enum!(
    /// Door styles (`style`).
    DoorStyle {
        default Hinged = "hinged",
        Glazed = "glazed",
        Double = "double",
        Folding = "folding",
        FoldingDouble = "double-folding",
        Sliding = "sliding",
        Barn = "barn",
        Passage = "opening",
        Sealed = "sealed",
    }
);

impl DoorStyle {
    /// Whether the door is cut into its wall (a sealed one is not).
    pub const fn cuts_wall(self) -> bool {
        !matches!(self, DoorStyle::Sealed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_round_trips_and_has_sane_defaults() {
        assert_eq!(Kind::ALL.len(), 117);
        for kind in Kind::ALL {
            assert_eq!(Kind::from_name(kind.name()), Some(*kind));
            let info = kind.info();
            assert!(info.size.iter().all(|v| *v > 0.0), "{}", kind.name());
            assert!(info.elevation + info.size[2] <= 300.0, "{}", kind.name());
        }
        assert_eq!(Kind::from_name("box"), Some(Kind::Box));
        assert_eq!(Kind::from_name("sofa-bed"), None);
    }

    #[test]
    fn the_lamps() {
        let lights: Vec<_> = Kind::ALL
            .iter()
            .filter(|k| k.is_light())
            .map(|k| k.name())
            .collect();
        assert_eq!(
            lights,
            [
                "nightstand",
                "chandelier",
                "pendant",
                "spotlight",
                "floor-lamp",
                "ceiling-light",
                "ceiling-fan",
                "table-lamp",
                "lantern",
                "desk-lamp",
                "aquarium",
                "wall-light",
                "light-strip",
                "track-light"
            ]
        );
    }

    #[test]
    fn styles_have_their_own_sizes_colours_and_lifts() {
        // D-074: a soundbar is not a smart speaker, a dome camera is on the ceiling.
        let soundbar = Kind::Speaker.style_info(Some("soundbar"));
        assert_eq!(soundbar.size, [90.0, 10.0, 7.0]);
        assert_eq!(soundbar.color, Rgb8::from_u32(0x2a2c2e));
        assert_eq!(soundbar.elevation, 0.0);
        let dome = Kind::Camera.style_info(Some("dome"));
        assert_eq!((dome.size, dome.elevation), ([12.0, 12.0, 9.0], 256.0));
        // A leather sofa is a leather's colour.
        assert_eq!(
            Kind::Sofa.style_info(Some("leather")).color,
            Rgb8::from_u32(0x7a4a30)
        );
        // A style without sizes of its own, none, or one the kind does not have: the kind's.
        let own = Kind::Nightstand.info();
        for style in [Some("one-drawer"), None, Some("wall")] {
            let info = Kind::Nightstand.style_info(style);
            assert_eq!(
                (info.size, info.color, info.elevation),
                (own.size, own.color, 0.0)
            );
        }
        // Every style of every kind fits under the ceiling.
        for kind in Kind::ALL {
            for style in kind.info().variants {
                let info = kind.style_info(Some(style));
                assert!(
                    info.size.iter().all(|v| *v > 0.0),
                    "{} {style}",
                    kind.name()
                );
                assert!(
                    info.elevation + info.size[2] <= 300.0,
                    "{} {style}",
                    kind.name()
                );
            }
        }
        assert!(Kind::Fireplace.burns() && !Kind::Stove.burns());
    }

    #[test]
    fn names_with_defaults() {
        assert_eq!(Floor::from_name("oak"), Floor::WoodOak);
        assert_eq!(Floor::from_name("marble"), Floor::Plain);
        assert_eq!(DoorStyle::from_name("barn"), DoorStyle::Barn);
        assert_eq!(DoorStyle::from_name("revolving"), DoorStyle::Hinged);
        assert_eq!(DoorStyle::Hinged.name(), "hinged");
        assert_eq!(WallStyle::White.name(), "plain");
        assert!(Kind::Plant.has_variant("pothos"));
        assert!(!Kind::Plant.has_variant("leather"));
    }
}
