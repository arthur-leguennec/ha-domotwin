//! What an IFC file says about looking after a piece (`DECISIONS.md`, D-033): who made it, its
//! model and serial number, when it was installed, when its warranty ends and how long it should
//! last. Read from the standard property sets (checked against buildingSMART's definitions of
//! IFC2x3, IFC4 and IFC4.3), on the piece or its type, and from the assets it belongs to.

use std::collections::HashMap;

use domotwin_core::upkeep::Date;
use serde_json::{Map, Value as Json, json};

use crate::model::Model;
use crate::step::Value;

const TYPE_INFORMATION: &str = "Pset_ManufacturerTypeInformation";
const OCCURRENCE: &str = "Pset_ManufacturerOccurrence";
const WARRANTY: &str = "Pset_Warranty";
const SERVICE_LIFE: &str = "Pset_ServiceLife";
/// Longest text kept from the file, as the cards allow.
const MAX_TEXT: usize = 100;
/// Longest service life believed (years).
const MAX_YEARS: u32 = 200;

/// The asset each element belongs to (`IfcRelAssignsToGroup` to an `IfcAsset`), read once a
/// file.
pub(crate) fn assets(model: &Model) -> &HashMap<u32, u32> {
    model.assets.get_or_init(|| read_assets(model))
}

fn read_assets(model: &Model) -> HashMap<u32, u32> {
    let mut out = HashMap::new();
    for &rel in model.step.of_type("IFCRELASSIGNSTOGROUP") {
        let Some(e) = model.get(rel) else { continue };
        let Some(group) = e.reference(6) else {
            continue;
        };
        if model.step.type_of(group) != Some("IFCASSET") {
            continue;
        }
        for element in e.get(4).references() {
            out.entry(element).or_insert(group);
        }
    }
    out
}

/// A text, trimmed, at most as long as a card allows.
fn text_of(value: &Value) -> Option<String> {
    let text = match value {
        Value::Typed(_, inner) => return text_of(inner),
        Value::Str(s) => s.trim(),
        _ => return None,
    };
    (!text.is_empty()).then(|| text.chars().take(MAX_TEXT).collect())
}

/// A date: `IfcDate` (or a label written `YYYY-MM-DD`, or a date and time), or an
/// `IfcCalendarDate` (IFC2x3), alone or in an `IfcDateAndTime`.
fn date_of(model: &Model, value: &Value) -> Option<Date> {
    date_within(model, value, 4)
}

/// [`date_of`], following at most `depth` references (a file may loop them).
fn date_within(model: &Model, value: &Value, depth: u8) -> Option<Date> {
    let depth = depth.checked_sub(1)?;
    match value {
        Value::Typed(_, inner) => date_within(model, inner, depth),
        Value::Str(s) => Date::parse(s.trim()),
        Value::Ref(id) => {
            let e = model.get(*id)?;
            match e.ty {
                "IFCCALENDARDATE" => {
                    let day = u8::try_from(e.number(0)? as i64).ok()?;
                    let month = u8::try_from(e.number(1)? as i64).ok()?;
                    let year = i32::try_from(e.number(2)? as i64).ok()?;
                    Date::new(year, month, day)
                }
                "IFCDATEANDTIME" => date_within(model, e.get(0), depth),
                _ => None,
            }
        }
        _ => None,
    }
}

/// A length of time as months and days: an `IfcDuration` (ISO 8601, `P2Y6M`, `P90D`, `P1W`;
/// hours and less left out), or an `IfcTimeMeasure` in seconds (IFC2x3).
fn duration_of(value: &Value) -> Option<(u32, u32)> {
    match value {
        Value::Typed(ty, inner) if ty == "IFCTIMEMEASURE" => {
            let days = (inner.number()? / 86_400.0).round();
            (1.0..100_000.0).contains(&days).then_some((0, days as u32))
        }
        Value::Typed(_, inner) => duration_of(inner),
        Value::Str(s) => iso_duration(s.trim()),
        _ => None,
    }
}

fn iso_duration(text: &str) -> Option<(u32, u32)> {
    let date = text.strip_prefix('P')?.split('T').next()?;
    let (mut months, mut days) = (0_u32, 0_u32);
    let mut number = String::new();
    for c in date.chars() {
        if c.is_ascii_digit() {
            number.push(c);
            continue;
        }
        let n: u32 = number.parse().ok()?;
        number.clear();
        match c {
            'Y' => months = months.checked_add(n.checked_mul(12)?)?,
            'M' => months = months.checked_add(n)?,
            'W' => days = days.checked_add(n.checked_mul(7)?)?,
            'D' => days = days.checked_add(n)?,
            _ => return None,
        }
    }
    (number.is_empty() && (months, days) != (0, 0)).then_some((months, days))
}

/// The upkeep card of an element, from what the file has (nothing: none): `make`, `model`,
/// `serial`, `installed`, `warranty_end`, `service_life` (years).
pub(crate) fn card(model: &Model, element: u32) -> Option<Json> {
    let assets = assets(model);
    let property = |set: Option<&str>, name: &str| model.property_in(element, set, name);
    let text = |set: &str, name: &str| property(Some(set), name).as_ref().and_then(text_of);
    let date = |set: Option<&str>, name: &str| {
        property(set, name).as_ref().and_then(|v| date_of(model, v))
    };
    let mut card = Map::new();
    let mut put = |key: &str, value: Option<Json>| {
        if let Some(value) = value {
            card.insert(key.to_owned(), value);
        }
    };
    put(
        "make",
        text(TYPE_INFORMATION, "Manufacturer").map(Json::from),
    );
    put(
        "model",
        text(TYPE_INFORMATION, "ModelLabel")
            .or_else(|| text(TYPE_INFORMATION, "ModelReference"))
            .map(Json::from),
    );
    put("serial", text(OCCURRENCE, "SerialNumber").map(Json::from));
    // Installed: said so, else when its asset was incorporated into the works, else bought.
    let incorporated = assets
        .get(&element)
        .and_then(|&asset| model.get(asset))
        .and_then(|asset| date_of(model, asset.get(12)));
    let installed = date(None, "InstallationDate")
        .or(incorporated)
        .or_else(|| date(Some(OCCURRENCE), "AcquisitionDate"));
    put("installed", installed.map(|d| json!(d.to_string())));
    // The warranty's end, else its start and length.
    let warranty_end = date(Some(WARRANTY), "WarrantyEndDate").or_else(|| {
        let start = date(Some(WARRANTY), "WarrantyStartDate")?;
        let (months, days) = duration_of(&property(Some(WARRANTY), "WarrantyPeriod")?)?;
        Some(start.add_months(months).add_days(i64::from(days)))
    });
    put("warranty_end", warranty_end.map(|d| json!(d.to_string())));
    let years = property(Some(SERVICE_LIFE), "ServiceLifeDuration")
        .as_ref()
        .and_then(duration_of)
        .map(|(months, days)| (f64::from(months) / 12.0 + f64::from(days) / 365.25).round())
        .filter(|y| *y >= 1.0 && *y <= f64::from(MAX_YEARS));
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    put("service_life", years.map(|y| json!(y as u32)));
    (!card.is_empty()).then_some(Json::Object(card))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step::StepFile;

    /// A piece whose own set leaves the make empty (its type says it), and whose installation
    /// date refers to itself.
    const FILE: &str = "ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('p',$,'P',$,$,$,$,$,$);
#2=IFCFURNISHINGELEMENT('e',$,'Piece',$,$,$,$,$);
#3=IFCPROPERTYSINGLEVALUE('Manufacturer',$,IFCLABEL(''),$);
#4=IFCPROPERTYSINGLEVALUE('ModelLabel',$,$,$);
#5=IFCPROPERTYSET('s1',$,'Pset_ManufacturerTypeInformation',$,(#3,#4));
#6=IFCRELDEFINESBYPROPERTIES('r1',$,$,$,(#2),#5);
#7=IFCPROPERTYSINGLEVALUE('Manufacturer',$,IFCLABEL('Fictional Appliances'),$);
#8=IFCPROPERTYSINGLEVALUE('ModelLabel',$,IFCLABEL('W-100'),$);
#9=IFCPROPERTYSET('s2',$,'Pset_ManufacturerTypeInformation',$,(#7,#8));
#10=IFCFURNITURETYPE('t',$,'T',$,$,(#9),$,$,$,$,$);
#11=IFCRELDEFINESBYTYPE('r2',$,$,$,(#2),#10);
#12=IFCDATEANDTIME(#12,$);
#13=IFCPROPERTYREFERENCEVALUE('InstallationDate',$,$,#12);
#14=IFCPROPERTYSINGLEVALUE('WarrantyEndDate',$,IFCDATE('2028-11-20Z'),$);
#15=IFCPROPERTYSET('s3',$,'Pset_Warranty',$,(#13,#14));
#16=IFCRELDEFINESBYPROPERTIES('r3',$,$,$,(#2),#15);
ENDSEC;
END-ISO-10303-21;
";

    #[test]
    fn empty_values_give_way_and_loops_end() {
        let model = Model::new(StepFile::new(FILE.as_bytes().to_vec()).unwrap());
        assert_eq!(
            card(&model, 2),
            Some(json!({
                "make": "Fictional Appliances",
                "model": "W-100",
                "warranty_end": "2028-11-20",
            }))
        );
    }

    #[test]
    fn durations() {
        assert_eq!(iso_duration("P2Y"), Some((24, 0)));
        assert_eq!(iso_duration("P1Y6M"), Some((18, 0)));
        assert_eq!(iso_duration("P90D"), Some((0, 90)));
        assert_eq!(iso_duration("P2W"), Some((0, 14)));
        assert_eq!(iso_duration("P1Y2M10DT2H30M"), Some((14, 10)));
        assert_eq!(iso_duration("PT12H"), None);
        assert_eq!(iso_duration("P"), None);
        assert_eq!(iso_duration("2Y"), None);
        assert_eq!(iso_duration("P2X"), None);
        assert_eq!(iso_duration("P99999999999Y"), None);
        assert_eq!(
            duration_of(&Value::Typed(
                "IFCTIMEMEASURE".into(),
                Box::new(Value::Real(63_072_000.0))
            )),
            Some((0, 730))
        );
    }
}
