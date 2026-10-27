//! Which furniture kind of the plan format an IFC element becomes: from its name and type name
//! first (English, French and German words), then its class and predefined type.

/// Words of a name, lower case, accents removed.
fn words(text: &str) -> Vec<String> {
    let folded: String = text
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'À' | 'Â' | 'Ä' | 'Á' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'î' | 'ï' | 'í' | 'Î' | 'Ï' | 'Í' => 'i',
            'ô' | 'ö' | 'ó' | 'Ô' | 'Ö' | 'Ó' => 'o',
            'ù' | 'û' | 'ü' | 'ú' | 'Ù' | 'Û' | 'Ü' | 'Ú' => 'u',
            'ç' | 'Ç' => 'c',
            'ß' => 's',
            c => c.to_ascii_lowercase(),
        })
        .collect();
    folded
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Phrases (one or more words, in order) and the kind they mean; earlier entries win.
const PHRASES: &[(&str, &str)] = &[
    ("office chair", "office-chair"),
    ("chaise de bureau", "office-chair"),
    ("burostuhl", "office-chair"),
    ("rocking chair", "rocking-chair"),
    ("chaise bercante", "rocking-chair"),
    ("fauteuil a bascule", "rocking-chair"),
    ("schaukelstuhl", "rocking-chair"),
    ("bar stool", "bar-stool"),
    ("counter stool", "bar-stool"),
    ("tabouret de bar", "bar-stool"),
    ("barhocker", "bar-stool"),
    ("table lamp", "table-lamp"),
    ("bedside lamp", "table-lamp"),
    ("lampe de table", "table-lamp"),
    ("lampe de chevet", "table-lamp"),
    ("desk lamp", "desk-lamp"),
    ("lampe de bureau", "desk-lamp"),
    ("floor lamp", "floor-lamp"),
    ("wall light", "wall-light"),
    ("wall lamp", "wall-light"),
    ("sconce", "wall-light"),
    ("applique", "wall-light"),
    ("wandleuchte", "wall-light"),
    ("led strip", "light-strip"),
    ("light strip", "light-strip"),
    ("ruban led", "light-strip"),
    ("lichtleiste", "light-strip"),
    ("track light", "track-light"),
    ("rail de spots", "track-light"),
    ("stromschiene", "track-light"),
    ("ceiling light", "ceiling-light"),
    ("ceiling fan", "ceiling-fan"),
    ("ventilateur de plafond", "ceiling-fan"),
    ("ventilateur plafond", "ceiling-fan"),
    ("washing machine", "washer"),
    ("lave linge", "washer"),
    ("seche linge", "dryer"),
    ("lave vaisselle", "dishwasher"),
    ("kitchen island", "kitchen-island"),
    ("ilot de cuisine", "kitchen-island"),
    ("ilot central", "kitchen-island"),
    ("kochinsel", "kitchen-island"),
    ("plan de travail", "counter"),
    ("kitchen cabinet", "counter"),
    ("base cabinet", "counter"),
    ("wall cabinet", "wall-cabinet"),
    ("filing cabinet", "filing-cabinet"),
    ("caisson de bureau", "filing-cabinet"),
    ("rollcontainer", "filing-cabinet"),
    ("salle a manger", "dining-table"),
    ("dining table", "dining-table"),
    ("coffee table", "coffee-table"),
    ("bedside table", "nightstand"),
    ("night stand", "nightstand"),
    ("table de chevet", "nightstand"),
    ("tv stand", "tv-stand"),
    ("tv unit", "tv-stand"),
    ("tv bench", "tv-stand"),
    ("meuble tv", "tv-stand"),
    ("lowboard", "tv-stand"),
    ("tv", "tv"),
    ("television", "tv"),
    ("fernseher", "tv"),
    ("toilet", "toilet"),
    ("toilets", "toilet"),
    ("toilette", "toilet"),
    ("wc", "toilet"),
    ("cuvette", "toilet"),
    ("bidet", "toilet"),
    ("urinal", "toilet"),
    ("bathtub", "bathtub"),
    ("bath", "bathtub"),
    ("baignoire", "bathtub"),
    ("badewanne", "bathtub"),
    ("shower", "shower"),
    ("douche", "shower"),
    ("dusche", "shower"),
    ("washbasin", "vanity"),
    ("basin", "vanity"),
    ("lavabo", "vanity"),
    ("vasque", "vanity"),
    ("waschbecken", "vanity"),
    ("vanity", "vanity"),
    ("sink", "sink"),
    ("evier", "sink"),
    ("spule", "sink"),
    ("wine cooler", "wine-cooler"),
    ("wine fridge", "wine-cooler"),
    ("cave a vin", "wine-cooler"),
    ("weinkuhlschrank", "wine-cooler"),
    ("fridge", "fridge"),
    ("refrigerator", "fridge"),
    ("refrigerateur", "fridge"),
    ("frigo", "fridge"),
    ("kuhlschrank", "fridge"),
    ("freezer", "freezer"),
    ("congelateur", "freezer"),
    ("gefrierschrank", "freezer"),
    ("gefriertruhe", "freezer"),
    ("washer", "washer"),
    ("waschmaschine", "washer"),
    ("dehumidifier", "dehumidifier"),
    ("deshumidificateur", "dehumidifier"),
    ("luftentfeuchter", "dehumidifier"),
    ("humidifier", "humidifier"),
    ("humidificateur", "humidifier"),
    ("luftbefeuchter", "humidifier"),
    ("dryer", "dryer"),
    ("trockner", "dryer"),
    ("dishwasher", "dishwasher"),
    ("geschirrspuler", "dishwasher"),
    ("microwave", "microwave"),
    ("micro ondes", "microwave"),
    ("mikrowelle", "microwave"),
    ("coffee machine", "coffee-machine"),
    ("coffee maker", "coffee-machine"),
    ("espresso", "coffee-machine"),
    ("machine a cafe", "coffee-machine"),
    ("cafetiere", "coffee-machine"),
    ("kaffeemaschine", "coffee-machine"),
    ("kettle", "kettle"),
    ("bouilloire", "kettle"),
    ("wasserkocher", "kettle"),
    ("toaster", "toaster"),
    ("grille pain", "toaster"),
    ("wall oven", "oven"),
    ("oven tower", "oven"),
    ("four encastre", "oven"),
    ("colonne four", "oven"),
    ("wood stove", "fireplace"),
    ("poele a bois", "fireplace"),
    ("kaminofen", "fireplace"),
    ("fireplace", "fireplace"),
    ("cheminee", "fireplace"),
    ("kamin", "fireplace"),
    ("oven", "stove"),
    ("cooker", "stove"),
    ("stove", "stove"),
    ("hob", "stove"),
    ("cuisiniere", "stove"),
    ("herd", "stove"),
    ("hood", "hood"),
    ("hotte", "hood"),
    ("corner sofa", "corner-sofa"),
    ("sectional", "corner-sofa"),
    ("canape d angle", "corner-sofa"),
    ("ecksofa", "corner-sofa"),
    ("sofa", "sofa"),
    ("couch", "sofa"),
    ("canape", "sofa"),
    ("settee", "sofa"),
    ("armchair", "armchair"),
    ("fauteuil", "armchair"),
    ("sessel", "armchair"),
    ("recliner", "armchair"),
    ("ottoman", "ottoman"),
    ("footstool", "ottoman"),
    ("pouf", "ottoman"),
    ("repose pieds", "ottoman"),
    ("chair", "chair"),
    ("chaise", "chair"),
    ("stuhl", "chair"),
    ("stool", "chair"),
    ("tabouret", "chair"),
    ("nightstand", "nightstand"),
    ("bedside", "nightstand"),
    ("chevet", "nightstand"),
    ("nachttisch", "nightstand"),
    ("bunk bed", "bunk-bed"),
    ("lits superposes", "bunk-bed"),
    ("lit superpose", "bunk-bed"),
    ("etagenbett", "bunk-bed"),
    ("crib", "crib"),
    ("cot", "crib"),
    ("lit bebe", "crib"),
    ("lit de bebe", "crib"),
    ("berceau", "crib"),
    ("babybett", "crib"),
    ("dog bed", "pet-bed"),
    ("cat bed", "pet-bed"),
    ("pet bed", "pet-bed"),
    ("panier pour chien", "pet-bed"),
    ("hundebett", "pet-bed"),
    ("bed", "bed"),
    ("lit", "bed"),
    ("bett", "bed"),
    ("clothes rack", "clothes-rack"),
    ("clothes rail", "clothes-rack"),
    ("portant", "clothes-rack"),
    ("kleiderstander", "clothes-rack"),
    ("coat rack", "coat-rack"),
    ("coat stand", "coat-rack"),
    ("portemanteau", "coat-rack"),
    ("wardrobe", "tall-cabinet"),
    ("armoire", "tall-cabinet"),
    ("penderie", "tall-cabinet"),
    ("closet", "tall-cabinet"),
    ("kleiderschrank", "tall-cabinet"),
    ("sideboard", "sideboard"),
    ("buffet", "sideboard"),
    ("enfilade", "sideboard"),
    ("anrichte", "sideboard"),
    ("dresser", "dresser"),
    ("commode", "dresser"),
    ("chest", "dresser"),
    ("kommode", "dresser"),
    ("bookcase", "bookcase"),
    ("bookshelf", "bookcase"),
    ("bibliotheque", "bookcase"),
    ("bucherregal", "bookcase"),
    ("wall shelf", "wall-shelf"),
    ("etagere murale", "wall-shelf"),
    ("wandregal", "wall-shelf"),
    ("shelf", "shelf"),
    ("shelving", "shelf"),
    ("etagere", "shelf"),
    ("regal", "shelf"),
    ("desk", "desk"),
    ("bureau", "desk"),
    ("schreibtisch", "desk"),
    ("dining", "dining-table"),
    ("table", "coffee-table"),
    ("tisch", "coffee-table"),
    ("counter", "counter"),
    ("worktop", "counter"),
    ("cabinet", "wall-cabinet"),
    ("cupboard", "wall-cabinet"),
    ("placard", "wall-cabinet"),
    ("schrank", "wall-cabinet"),
    ("cat tree", "cat-tree"),
    ("arbre a chat", "cat-tree"),
    ("kratzbaum", "cat-tree"),
    ("plant", "plant"),
    ("plante", "plant"),
    ("pflanze", "plant"),
    ("pendant", "pendant"),
    ("suspension", "pendant"),
    ("chandelier", "chandelier"),
    ("lustre", "chandelier"),
    ("spot", "spotlight"),
    ("spotlight", "spotlight"),
    ("downlight", "spotlight"),
    ("plafonnier", "ceiling-light"),
    ("lampadaire", "floor-lamp"),
    ("lamp", "floor-lamp"),
    ("lampe", "floor-lamp"),
    ("towel radiator", "towel-radiator"),
    ("towel rail", "towel-radiator"),
    ("towel warmer", "towel-radiator"),
    ("seche serviettes", "towel-radiator"),
    ("handtuchheizkorper", "towel-radiator"),
    ("radiator", "radiator"),
    ("radiateur", "radiator"),
    ("heizkorper", "radiator"),
    ("water heater", "water-heater"),
    ("hot water tank", "water-heater"),
    ("chauffe eau", "water-heater"),
    ("ballon d eau chaude", "water-heater"),
    ("warmwasserspeicher", "water-heater"),
    ("boiler", "boiler"),
    ("chaudiere", "boiler"),
    ("heizkessel", "boiler"),
    ("furnace", "furnace"),
    ("fournaise", "furnace"),
    ("heat pump", "heat-pump"),
    ("thermopompe", "heat-pump"),
    ("pompe a chaleur", "heat-pump"),
    ("warmepumpe", "heat-pump"),
    ("air conditioner", "heat-pump"),
    ("mini split", "heat-pump"),
    ("climatiseur", "heat-pump"),
    ("klimaanlage", "heat-pump"),
    ("air purifier", "air-purifier"),
    ("purificateur d air", "air-purifier"),
    ("luftreiniger", "air-purifier"),
    ("heater", "radiator"),
    ("convector", "radiator"),
    ("fan", "fan"),
    ("ventilateur", "fan"),
    ("ventilator", "fan"),
    ("mirror", "mirror"),
    ("miroir", "mirror"),
    ("spiegel", "mirror"),
    ("curtain", "curtain"),
    ("curtains", "curtain"),
    ("rideau", "curtain"),
    ("rideaux", "curtain"),
    ("vorhang", "curtain"),
    ("3d printer", "3d-printer"),
    ("imprimante 3d", "3d-printer"),
    ("printer", "printer"),
    ("imprimante", "printer"),
    ("drucker", "printer"),
    ("laundry basket", "laundry-basket"),
    ("panier a linge", "laundry-basket"),
    ("waschekorb", "laundry-basket"),
    ("litter box", "litter-box"),
    ("litiere", "litter-box"),
    ("katzenklo", "litter-box"),
    ("pet feeder", "pet-feeder"),
    ("futterautomat", "pet-feeder"),
    ("bin", "bin"),
    ("poubelle", "bin"),
    ("rug", "rug"),
    ("carpet", "rug"),
    ("tapis de course", "treadmill"),
    ("treadmill", "treadmill"),
    ("laufband", "treadmill"),
    ("exercise bike", "exercise-bike"),
    ("velo d appartement", "exercise-bike"),
    ("heimtrainer", "exercise-bike"),
    ("tapis", "rug"),
    ("teppich", "rug"),
    ("piano", "piano"),
    ("klavier", "piano"),
    ("soundbar", "speaker"),
    ("speaker", "speaker"),
    ("enceinte", "speaker"),
    ("lautsprecher", "speaker"),
    ("bench", "bench"),
    ("banc", "bench"),
    ("aquarium", "aquarium"),
    ("clock", "clock"),
    ("horloge", "clock"),
    ("vase", "vase"),
    ("books", "books"),
    ("livres", "books"),
    ("ev charger", "ev-charger"),
    ("wallbox", "ev-charger"),
    ("borne de recharge", "ev-charger"),
    ("ladestation", "ev-charger"),
    ("electrical panel", "electrical-panel"),
    ("breaker box", "electrical-panel"),
    ("tableau electrique", "electrical-panel"),
    ("panneau electrique", "electrical-panel"),
    ("sicherungskasten", "electrical-panel"),
    ("access point", "access-point"),
    ("point d acces", "access-point"),
    ("router", "router"),
    ("routeur", "router"),
    ("thermostat", "thermostat"),
    ("smoke detector", "smoke-detector"),
    ("smoke alarm", "smoke-detector"),
    ("detecteur de fumee", "smoke-detector"),
    ("rauchmelder", "smoke-detector"),
    ("camera", "camera"),
    ("kamera", "camera"),
    ("tablet", "wall-tablet"),
    ("tablette", "wall-tablet"),
    ("sensor", "sensor"),
    ("capteur", "sensor"),
    ("monitor", "monitor"),
    ("ecran", "monitor"),
    ("bildschirm", "monitor"),
    ("computer", "computer"),
    ("ordinateur", "computer"),
    ("pc", "computer"),
    ("car", "car"),
    ("voiture", "car"),
    // Last: also an English number ("table for four").
    ("four", "stove"),
];

/// The kind named by a text, if any.
pub(crate) fn kind_from_text(text: &str) -> Option<&'static str> {
    let words = words(text);
    if words.is_empty() {
        return None;
    }
    PHRASES.iter().find_map(|&(phrase, kind)| {
        let phrase: Vec<&str> = phrase.split(' ').collect();
        words
            .windows(phrase.len())
            .any(|w| w.iter().zip(&phrase).all(|(a, b)| a == b))
            .then_some(kind)
    })
}

/// What decides a kind besides names.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Clues<'a> {
    /// IFC class, upper case (`IFCSANITARYTERMINAL`).
    pub(crate) class: &'a str,
    /// Predefined type of the occurrence or its type object.
    pub(crate) predefined: Option<&'a str>,
    /// Size (cm): width, depth, height, and the height of its underside above the floor.
    pub(crate) size: [f64; 3],
    pub(crate) elevation: f64,
}

/// The kind of a piece of another app's file, named so: from its names, a lamp by its height,
/// else a plain box of its size.
pub(crate) fn kind_by_name(
    names: &[&str],
    size: [f64; 3],
    elevation: f64,
    lamp: bool,
) -> &'static str {
    let class = if lamp { "IFCLIGHTFIXTURE" } else { "" };
    kind(
        names,
        Clues {
            class,
            predefined: None,
            size,
            elevation,
        },
    )
    .unwrap_or("box")
}

/// The kind of a piece: from its names, else from its class and predefined type, else `None`
/// for a building element proxy (left out) or a generic piece of furniture (`dresser`).
pub(crate) fn kind(names: &[&str], clues: Clues<'_>) -> Option<&'static str> {
    let by_name = names.iter().find_map(|n| kind_from_text(n));
    let [w, d, h] = clues.size;
    let lamp_by_height = || {
        if clues.elevation > 170.0 {
            "ceiling-light"
        } else if clues.elevation < 20.0 && h > 100.0 {
            "floor-lamp"
        } else {
            "table-lamp"
        }
    };
    if let Some(kind) = by_name {
        // A table big and high enough to eat at is a dining table.
        if kind == "coffee-table" && w.max(d) >= 120.0 && w.min(d) >= 70.0 && h >= 65.0 {
            return Some("dining-table");
        }
        if kind == "floor-lamp" && clues.class.starts_with("IFCLIGHTFIXTURE") {
            return Some(lamp_by_height());
        }
        return Some(kind);
    }
    let predefined = clues.predefined.unwrap_or_default();
    match clues.class {
        "IFCSANITARYTERMINAL" | "IFCSANITARYTERMINALTYPE" => Some(match predefined {
            "BATH" => "bathtub",
            "SHOWER" => "shower",
            "SINK" => "sink",
            "TOILETPAN" | "WCSEAT" | "CISTERN" | "URINAL" | "BIDET" => "toilet",
            _ => "vanity",
        }),
        "IFCELECTRICAPPLIANCE" | "IFCELECTRICAPPLIANCETYPE" => Some(match predefined {
            "REFRIGERATOR" | "FRIDGE_FREEZER" => "fridge",
            "FREEZER" => "freezer",
            "WASHINGMACHINE" => "washer",
            "TUMBLEDRYER" => "dryer",
            "DISHWASHER" => "dishwasher",
            "ELECTRICCOOKER" | "KITCHENMACHINE" => "stove",
            "MICROWAVE" => "microwave",
            "FREESTANDINGFAN" => "fan",
            "PHOTOCOPIER" | "FACSIMILE" => "printer",
            "FREESTANDINGELECTRICHEATER" => "radiator",
            "FREESTANDINGWATERHEATER" => "water-heater",
            "PERSONALCOMPUTER" => "computer",
            _ => "dresser",
        }),
        "IFCAUDIOVISUALAPPLIANCE" | "IFCAUDIOVISUALAPPLIANCETYPE" => Some(match predefined {
            "DISPLAY" | "TV" | "PROJECTOR" => "tv",
            "SPEAKER" | "AMPLIFIER" | "RECEIVER" | "TUNER" | "AUDIOVISUALSOURCE" => "speaker",
            "CAMERA" => "camera",
            _ => "dresser",
        }),
        "IFCLIGHTFIXTURE" | "IFCLIGHTFIXTURETYPE" => Some(lamp_by_height()),
        "IFCSPACEHEATER" | "IFCSPACEHEATERTYPE" => Some("radiator"),
        "IFCFURNITURE"
        | "IFCFURNITURETYPE"
        | "IFCFURNISHINGELEMENT"
        | "IFCFURNISHINGELEMENTTYPE"
        | "IFCSYSTEMFURNITUREELEMENT" => Some(match predefined {
            "CHAIR" => "chair",
            "TABLE" => {
                if w.max(d) >= 120.0 && h >= 65.0 {
                    "dining-table"
                } else {
                    "coffee-table"
                }
            }
            "DESK" => "desk",
            "BED" => "bed",
            "FILECABINET" | "TECHNICALCABINET" => "wall-cabinet",
            "SHELF" => "shelf",
            "SOFA" => "sofa",
            _ => "dresser",
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clues(class: &'static str, predefined: Option<&'static str>) -> Clues<'static> {
        Clues {
            class,
            predefined,
            size: [60.0, 60.0, 80.0],
            elevation: 0.0,
        }
    }

    #[test]
    fn names_first() {
        assert_eq!(
            kind(&["M_Chair-Breuer:Chair"], clues("IFCFURNITURE", None)),
            Some("chair")
        );
        assert_eq!(
            kind(&["Canapé d'angle"], clues("IFCFURNISHINGELEMENT", None)),
            Some("corner-sofa")
        );
        assert_eq!(
            kind(&["Canapé 3 places"], clues("IFCFURNISHINGELEMENT", None)),
            Some("sofa")
        );
        assert_eq!(
            kind(&["Lave-linge"], clues("IFCFLOWTERMINAL", None)),
            Some("washer")
        );
        assert_eq!(
            kind(&["Kühlschrank"], clues("IFCBUILDINGELEMENTPROXY", None)),
            Some("fridge")
        );
        assert_eq!(
            kind(&["Office chair 2"], clues("IFCFURNITURE", None)),
            Some("office-chair")
        );
        assert_eq!(
            kind(&["Bathroom cabinet"], clues("IFCFURNITURE", None)),
            Some("wall-cabinet")
        );
        let big = Clues {
            size: [180.0, 90.0, 75.0],
            ..clues("IFCFURNITURE", None)
        };
        assert_eq!(kind(&["Table"], big), Some("dining-table"));
        // A ceiling fan hangs; a fan stands on the floor.
        assert_eq!(
            kind(
                &["Ventilateur de plafond"],
                clues("IFCFURNISHINGELEMENT", None)
            ),
            Some("ceiling-fan")
        );
        assert_eq!(
            kind(
                &["Object 3"],
                clues("IFCELECTRICAPPLIANCE", Some("FREESTANDINGFAN"))
            ),
            Some("fan")
        );
        // The library's pieces by their names (D-072), the specific before the general.
        for (name, expected) in [
            ("Tapis de course", "treadmill"),
            ("Tapis berbère", "rug"),
            ("Chest freezer", "freezer"),
            ("Microwave oven", "microwave"),
            ("Wall oven", "oven"),
            ("Poêle à bois", "fireplace"),
            ("Lit superposé", "bunk-bed"),
            ("Lit bébé", "crib"),
            ("Dog bed", "pet-bed"),
            ("Bar stool", "bar-stool"),
            ("Towel rail", "towel-radiator"),
            ("Thermopompe murale", "heat-pump"),
            ("Chauffe-eau", "water-heater"),
            ("Douche à l'italienne", "shower"),
            ("Wallbox 11 kW", "ev-charger"),
            ("Applique murale", "wall-light"),
            ("3D printer", "3d-printer"),
        ] {
            assert_eq!(
                kind(&[name], clues("IFCFURNISHINGELEMENT", None)),
                Some(expected),
                "{name}"
            );
        }
    }

    #[test]
    fn classes_and_types_next() {
        assert_eq!(
            kind(&["Object 12"], clues("IFCSANITARYTERMINAL", Some("WCSEAT"))),
            Some("toilet")
        );
        assert_eq!(
            kind(&[""], clues("IFCELECTRICAPPLIANCE", Some("FRIDGE_FREEZER"))),
            Some("fridge")
        );
        let high = Clues {
            elevation: 240.0,
            ..clues("IFCLIGHTFIXTURE", None)
        };
        assert_eq!(kind(&["Luminaire 3"], high), Some("ceiling-light"));
        // IFC2x3: a flow terminal typed as a light fixture.
        let typed = Clues {
            elevation: 240.0,
            ..clues("IFCLIGHTFIXTURETYPE", None)
        };
        assert_eq!(kind(&["Ceiling lamp"], typed), Some("ceiling-light"));
        assert_eq!(
            kind(&["Proxy"], clues("IFCBUILDINGELEMENTPROXY", None)),
            None
        );
        assert_eq!(
            kind(&["Thing"], clues("IFCFURNISHINGELEMENT", None)),
            Some("dresser")
        );
    }
}
