//! The fixed lists of the plan format: furniture kinds (with their default size, colour and
//! behaviour), variants, floor coverings, wall styles and door styles. See `docs/plan-format.md`.

use super::Rgb8;

/// What a kind of furniture does beyond being a box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KindFlags {
    /// Emits light and can be switched (`lightOff`, light settings).
    pub light: bool,
    /// Ignored by the overlap and door checks (hung, flat or ceiling items).
    pub soft: bool,
    /// Built with width and depth swapped and facing local −x when `h > w`.
    pub vertical: bool,
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
    /// Default width, depth and height (cm).
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
    Rgb8 {
        r: (hex >> 16) as u8,
        g: (hex >> 8) as u8,
        b: hex as u8,
    }
}

const NONE: KindFlags = KindFlags {
    light: false,
    soft: false,
    vertical: false,
    hanging: false,
    wall_decor: false,
};
const VERTICAL: KindFlags = KindFlags {
    vertical: true,
    ..NONE
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

macro_rules! kinds {
    ($($variant:ident = $name:literal, [$w:expr, $h:expr, $z:expr], $color:literal, $elev:expr, $flags:expr, [$($v:literal),*];)*) => {
        /// A kind of furniture (`kind`). Unknown kinds read as [`Kind::Desk`].
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Kind {
            /// A user model (revision 10), drawn from the plan's `models`.
            Custom,
            $(
                #[doc = concat!("`", $name, "`")]
                $variant,
            )*
        }

        impl Kind {
            /// Every built-in kind, in the order of the format.
            pub const ALL: &'static [Kind] = &[$(Kind::$variant),*];

            /// The name in plan files.
            pub const fn name(self) -> &'static str {
                match self {
                    Kind::Custom => "custom",
                    $(Kind::$variant => $name,)*
                }
            }

            /// Reads a kind name; unknown names give `None`.
            pub fn from_name(name: &str) -> Option<Kind> {
                match name {
                    "custom" => Some(Kind::Custom),
                    $($name => Some(Kind::$variant),)*
                    _ => None,
                }
            }

            /// Defaults and behaviour of the kind.
            pub const fn info(self) -> KindInfo {
                match self {
                    Kind::Custom => KindInfo {
                        name: "custom",
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
    Sofa = "sofa", [90, 210, 85], 0x6b6e5c, 0, VERTICAL, ["cuir"];
    Armchair = "armchair", [80, 80, 85], 0x965a3d, 0, VERTICAL, ["cuir"];
    Table = "table", [65, 110, 42], 0xa97a50, 0, NONE, [];
    Tv = "tv", [35, 140, 55], 0xe8e4d9, 0, VERTICAL, ["mural"];
    Plant = "plant", [35, 35, 80], 0x536c42, 0, NONE, ["monstera", "pothos", "dracaena"];
    Bed = "bed", [160, 200, 55], 0xaab09d, 0, NONE, ["metal"];
    Nightstand = "nightstand", [40, 40, 48], 0xa6835b, 0, LIGHT, ["3-tiroirs", "1-tiroir"];
    Dresser = "dresser", [100, 45, 85], 0xbd9a70, 0, NONE, ["ancien"];
    Desk = "desk", [150, 70, 75], 0xb38b5e, 0, NONE, [];
    Chair = "chair", [50, 50, 80], 0x555c54, 0, NONE, [];
    Bookcase = "bookcase", [110, 35, 180], 0xb18455, 0, NONE, [];
    Counter = "counter", [180, 60, 90], 0xc8b294, 0, NONE, [];
    Sink = "sink", [80, 55, 94], 0xb5c2bd, 0, NONE, [];
    Stove = "stove", [60, 60, 90], 0x535954, 0, NONE, [];
    Fridge = "fridge", [70, 70, 185], 0xe6e7dd, 0, NONE, [];
    Dining = "dining", [140, 75, 75], 0xbb9061, 0, NONE, [];
    Bathtub = "bathtub", [170, 75, 60], 0xecefe7, 0, NONE, [];
    Vanity = "vanity", [75, 50, 85], 0xe1ded0, 0, NONE, [];
    Linen = "linen", [60, 65, 190], 0xe8e5d9, 0, NONE, ["armoire"];
    Toilet = "toilet", [40, 70, 75], 0xeeeede, 0, NONE, [];
    Washer = "washer", [65, 65, 90], 0xdedfd6, 0, NONE, [];
    Dryer = "dryer", [65, 65, 90], 0xe1e2d8, 0, NONE, [];
    Bin = "bin", [40, 40, 65], 0x656e61, 0, NONE, [];
    Cabinet = "cabinet", [100, 40, 80], 0xd8ccb4, 140, WALL, [];
    Shelf = "shelf", [30, 40, 120], 0xcdb894, 0, NONE, [];
    Cart = "cart", [100, 45, 90], 0xf1efe9, 0, NONE, [];
    Dishwasher = "dishwasher", [60, 60, 86], 0xc9ccca, 0, NONE, [];
    Hood = "hood", [60, 45, 12], 0xe9eae7, 138, WALL, [];
    Soffit = "soffit", [200, 70, 30], 0xf2f1ec, 228, WALL, [];
    Backsplash = "backsplash", [150, 1, 55], 0xf2f1ec, 90, SOFT_WALL, [];
    Shoecab = "shoecab", [80, 25, 100], 0xf2f1ec, 0, NONE, [];
    Heater = "heater", [120, 8, 18], 0xf2f2ef, 0, WALL, [];
    Curtain = "curtain", [200, 6, 235], 0xf1ece2, 0, SOFT_WALL, ["ferme"];
    Frame = "frame", [40, 3, 50], 0x24211e, 140, SOFT_WALL, ["gravure", "portrait", "bd", "carte", "affiche"];
    Gallery = "gallery", [120, 3, 100], 0x8a6a3f, 120, SOFT_WALL, [];
    Mirror = "mirror", [60, 4, 90], 0xb8964f, 110, SOFT_WALL, ["blanc"];
    Chandelier = "chandelier", [60, 60, 45], 0xc8cbc9, 195, HANGING_LIGHT, [];
    Pendant = "pendant", [47, 47, 45], 0xf4f3ef, 150, HANGING_LIGHT, ["cylindre"];
    Spot = "spot", [10, 10, 3], 0xf4f3ef, 240, SOFT_LIGHT, [];
    Lamp = "lamp", [35, 35, 160], 0xf1e7d2, 0, LIGHT, [];
    Ceilinglight = "ceilinglight", [36, 36, 14], 0xc9a45a, 250, HANGING_LIGHT, ["fleurons"];
    Fan = "fan", [105, 105, 30], 0xb9bcbc, 215, HANGING_LIGHT, [];
    Tablelamp = "tablelamp", [30, 30, 48], 0xc9a77a, 0, SOFT_LIGHT, [];
    Lantern = "lantern", [18, 18, 30], 0x3b3d3c, 0, SOFT_LIGHT, [];
    Desklamp = "desklamp", [16, 16, 55], 0x1d1f20, 0, SOFT_LIGHT, [];
    Barrister = "barrister", [86, 32, 150], 0x9c5a2c, 0, NONE, [];
    Openshelf = "openshelf", [60, 33, 170], 0x3a2b20, 0, NONE, ["metal"];
    Trunk = "trunk", [105, 55, 48], 0x6e3f26, 0, NONE, [];
    Stand = "stand", [40, 35, 60], 0x8a5a36, 0, NONE, ["marbre", "epingle"];
    Officechair = "officechair", [60, 60, 110], 0xf1efea, 0, NONE, [];
    Roundtable = "roundtable", [45, 45, 50], 0x232323, 0, NONE, [];
    Console = "console", [90, 45, 75], 0x7a4a2c, 0, NONE, [];
    Printer = "printer", [42, 38, 25], 0xe8e8e6, 0, NONE, [];
    Conduit = "conduit", [200, 3, 3], 0xa6aaa9, 250, SOFT_WALL, [];
    Printer3d = "printer3d", [35, 36, 49], 0x1f2022, 0, NONE, ["sans-bobine", "enclosure", "enclosure-sans-bobine"];
}

impl Kind {
    /// Whether this kind emits light (and keeps `lightOff` and the light settings).
    pub const fn is_light(self) -> bool {
        self.info().flags.light
    }

    /// Whether `variant` is one of this kind's alternative models.
    pub fn has_variant(self, variant: &str) -> bool {
        self.info().variants.contains(&variant)
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

/// Floor coverings (`floor`). `photo-*` keys use the user's own picture when one is uploaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Floor {
    /// `uni`: plain.
    #[default]
    Plain,
    /// `bois-gris`: grey-brown planks.
    WoodGrey,
    /// `bois-chene`: warm oak.
    WoodOak,
    /// `bois-peint`: painted grey planks.
    WoodPainted,
    /// `carrelage-beige`: beige tiles.
    TilesBeige,
    /// `carrelage-blanc`: light tiles.
    TilesWhite,
    /// `photo-stratifie`.
    PhotoLaminate,
    /// `photo-carrelage`.
    PhotoTiles,
    /// `photo-bois-gris`.
    PhotoWoodGrey,
    /// `photo-stratifie-gris`.
    PhotoLaminateGrey,
    /// `photo-lattes`.
    PhotoSlats,
}

impl Floor {
    const NAMES: [(Floor, &'static str); 11] = [
        (Floor::Plain, "uni"),
        (Floor::WoodGrey, "bois-gris"),
        (Floor::WoodOak, "bois-chene"),
        (Floor::WoodPainted, "bois-peint"),
        (Floor::TilesBeige, "carrelage-beige"),
        (Floor::TilesWhite, "carrelage-blanc"),
        (Floor::PhotoLaminate, "photo-stratifie"),
        (Floor::PhotoTiles, "photo-carrelage"),
        (Floor::PhotoWoodGrey, "photo-bois-gris"),
        (Floor::PhotoLaminateGrey, "photo-stratifie-gris"),
        (Floor::PhotoSlats, "photo-lattes"),
    ];

    /// The name in plan files.
    pub fn name(self) -> &'static str {
        Self::NAMES
            .iter()
            .find(|(floor, _)| *floor == self)
            .map_or("uni", |(_, name)| name)
    }

    /// Reads a name; unknown names give `uni`.
    pub fn from_name(name: &str) -> Floor {
        Self::NAMES
            .iter()
            .find(|(_, n)| *n == name)
            .map_or(Floor::Plain, |(floor, _)| *floor)
    }

    /// The procedural floor drawn for a photo key until the user uploads a picture.
    pub const fn procedural(self) -> Floor {
        match self {
            Floor::PhotoLaminate | Floor::PhotoSlats => Floor::WoodOak,
            Floor::PhotoTiles => Floor::TilesBeige,
            Floor::PhotoWoodGrey => Floor::WoodPainted,
            Floor::PhotoLaminateGrey => Floor::WoodGrey,
            other => other,
        }
    }
}

name_enum!(
    /// Room role (`role`).
    Role {
        default Room = "piece",
        Closet = "placard",
        Circulation = "circulation",
    }
);

name_enum!(
    /// Style of the inner wall faces (`wallStyle`).
    WallStyle {
        default White = "blanc",
        GreenWainscot = "vert-blanc",
        ChairRail = "cimaise",
    }
);

name_enum!(
    /// Door style (`style`). Unknown styles read as hinged.
    DoorStyle {
        default Hinged = "battante",
        Glazed = "vitree",
        Double = "double",
        Folding = "pliante",
        FoldingDouble = "pliante-double",
        Sliding = "coulissante",
        Barn = "grange",
        Passage = "passage",
        Sealed = "condamnee",
    }
);

impl DoorStyle {
    /// Whether the door is cut into the wall (sealed doors are drawn closed in a full wall).
    pub const fn cuts_wall(self) -> bool {
        !matches!(self, DoorStyle::Sealed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_round_trips_and_has_sane_defaults() {
        assert_eq!(Kind::ALL.len(), 55);
        for kind in Kind::ALL {
            assert_eq!(Kind::from_name(kind.name()), Some(*kind));
            let info = kind.info();
            assert!(info.size.iter().all(|v| *v > 0.0), "{}", kind.name());
            assert!(info.elevation + info.size[2] <= 300.0, "{}", kind.name());
        }
        assert_eq!(Kind::from_name("custom"), Some(Kind::Custom));
        assert_eq!(Kind::from_name("sofa-bed"), None);
    }

    #[test]
    fn light_kinds_match_the_format() {
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
                "spot",
                "lamp",
                "ceilinglight",
                "fan",
                "tablelamp",
                "lantern",
                "desklamp"
            ]
        );
    }

    #[test]
    fn names_with_defaults() {
        assert_eq!(Floor::from_name("bois-chene"), Floor::WoodOak);
        assert_eq!(Floor::from_name("marble"), Floor::Plain);
        assert_eq!(Floor::PhotoTiles.procedural(), Floor::TilesBeige);
        assert_eq!(DoorStyle::from_name("grange"), DoorStyle::Barn);
        assert_eq!(DoorStyle::from_name("revolving"), DoorStyle::Hinged);
        assert_eq!(DoorStyle::Hinged.name(), "battante");
        assert_eq!(Role::from_name("placard"), Role::Closet);
        assert_eq!(Role::Room.name(), "piece");
        assert_eq!(WallStyle::White.name(), "blanc");
        assert!(Kind::Plant.has_variant("pothos"));
        assert!(!Kind::Plant.has_variant("cuir"));
    }
}
