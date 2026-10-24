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
    ("table lamp", "table-lamp"),
    ("bedside lamp", "table-lamp"),
    ("lampe de table", "table-lamp"),
    ("lampe de chevet", "table-lamp"),
    ("desk lamp", "desk-lamp"),
    ("lampe de bureau", "desk-lamp"),
    ("floor lamp", "floor-lamp"),
    ("ceiling light", "ceiling-light"),
    ("ceiling fan", "ceiling-fan"),
    ("ventilateur de plafond", "ceiling-fan"),
    ("ventilateur plafond", "ceiling-fan"),
    ("washing machine", "washer"),
    ("lave linge", "washer"),
    ("seche linge", "dryer"),
    ("lave vaisselle", "dishwasher"),
    ("plan de travail", "counter"),
    ("kitchen cabinet", "counter"),
    ("base cabinet", "counter"),
    ("wall cabinet", "wall-cabinet"),
    ("salle a manger", "dining-table"),
    ("dining table", "dining-table"),
    ("coffee table", "coffee-table"),
    ("bedside table", "nightstand"),
    ("night stand", "nightstand"),
    ("table de chevet", "nightstand"),
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
    ("shower", "bathtub"),
    ("douche", "bathtub"),
    ("dusche", "bathtub"),
    ("washbasin", "vanity"),
    ("basin", "vanity"),
    ("lavabo", "vanity"),
    ("vasque", "vanity"),
    ("waschbecken", "vanity"),
    ("vanity", "vanity"),
    ("sink", "sink"),
    ("evier", "sink"),
    ("spule", "sink"),
    ("fridge", "fridge"),
    ("refrigerator", "fridge"),
    ("refrigerateur", "fridge"),
    ("frigo", "fridge"),
    ("freezer", "fridge"),
    ("congelateur", "fridge"),
    ("kuhlschrank", "fridge"),
    ("washer", "washer"),
    ("waschmaschine", "washer"),
    ("dryer", "dryer"),
    ("trockner", "dryer"),
    ("dishwasher", "dishwasher"),
    ("geschirrspuler", "dishwasher"),
    ("oven", "stove"),
    ("cooker", "stove"),
    ("stove", "stove"),
    ("hob", "stove"),
    ("cuisiniere", "stove"),
    ("herd", "stove"),
    ("hood", "hood"),
    ("hotte", "hood"),
    ("sofa", "sofa"),
    ("couch", "sofa"),
    ("canape", "sofa"),
    ("settee", "sofa"),
    ("armchair", "armchair"),
    ("fauteuil", "armchair"),
    ("sessel", "armchair"),
    ("recliner", "armchair"),
    ("chair", "chair"),
    ("chaise", "chair"),
    ("stuhl", "chair"),
    ("stool", "chair"),
    ("tabouret", "chair"),
    ("nightstand", "nightstand"),
    ("bedside", "nightstand"),
    ("chevet", "nightstand"),
    ("nachttisch", "nightstand"),
    ("bed", "bed"),
    ("lit", "bed"),
    ("bett", "bed"),
    ("wardrobe", "tall-cabinet"),
    ("armoire", "tall-cabinet"),
    ("penderie", "tall-cabinet"),
    ("closet", "tall-cabinet"),
    ("kleiderschrank", "tall-cabinet"),
    ("dresser", "dresser"),
    ("commode", "dresser"),
    ("chest", "dresser"),
    ("kommode", "dresser"),
    ("sideboard", "dresser"),
    ("buffet", "dresser"),
    ("bookcase", "bookcase"),
    ("bookshelf", "bookcase"),
    ("bibliotheque", "bookcase"),
    ("bucherregal", "bookcase"),
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
    ("radiator", "radiator"),
    ("radiateur", "radiator"),
    ("heizkorper", "radiator"),
    ("heater", "radiator"),
    ("convector", "radiator"),
    ("mirror", "mirror"),
    ("miroir", "mirror"),
    ("spiegel", "mirror"),
    ("curtain", "curtain"),
    ("curtains", "curtain"),
    ("rideau", "curtain"),
    ("rideaux", "curtain"),
    ("vorhang", "curtain"),
    ("printer", "printer"),
    ("imprimante", "printer"),
    ("drucker", "printer"),
    ("bin", "bin"),
    ("poubelle", "bin"),
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
            "BATH" | "SHOWER" => "bathtub",
            "SINK" => "sink",
            "TOILETPAN" | "WCSEAT" | "CISTERN" | "URINAL" | "BIDET" => "toilet",
            _ => "vanity",
        }),
        "IFCELECTRICAPPLIANCE" | "IFCELECTRICAPPLIANCETYPE" => Some(match predefined {
            "REFRIGERATOR" | "FREEZER" | "FRIDGE_FREEZER" => "fridge",
            "WASHINGMACHINE" => "washer",
            "TUMBLEDRYER" => "dryer",
            "DISHWASHER" => "dishwasher",
            "ELECTRICCOOKER" | "MICROWAVE" | "KITCHENMACHINE" => "stove",
            // A fan standing on the floor: no kind draws one, a box of its size does.
            "FREESTANDINGFAN" => "box",
            "PHOTOCOPIER" | "FACSIMILE" => "printer",
            "FREESTANDINGELECTRICHEATER" | "FREESTANDINGWATERHEATER" => "radiator",
            "PERSONALCOMPUTER" => "desk",
            _ => "dresser",
        }),
        "IFCAUDIOVISUALAPPLIANCE" | "IFCAUDIOVISUALAPPLIANCETYPE" => Some(match predefined {
            "DISPLAY" | "TV" | "PROJECTOR" => "tv",
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
        // A ceiling fan hangs; a fan standing on the floor is a box of its size.
        assert_eq!(
            kind(
                &["Ventilateur de plafond"],
                clues("IFCFURNISHINGELEMENT", None)
            ),
            Some("ceiling-fan")
        );
        assert_eq!(
            kind(
                &["Fan"],
                clues("IFCELECTRICAPPLIANCE", Some("FREESTANDINGFAN"))
            ),
            Some("box")
        );
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
