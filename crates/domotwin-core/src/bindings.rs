//! Bindings: which Home Assistant entities an element of the plan follows (`docs/bindings.md`).
//! The integration validates them when they are saved; this reader is lenient and skips what it
//! does not understand, so an old or hand-edited file never stops the view.

use std::collections::BTreeMap;

use serde_json::Value;

/// What an entity does for its element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Glow, colour and brightness.
    Light,
    /// On/off look.
    Switch,
    /// On/off.
    Fan,
    /// Curtains, blinds: position.
    Cover,
    /// Screen glow.
    Media,
    /// Doors and windows open.
    Contact,
    /// Locks.
    Lock,
    /// Power layer.
    Power,
    /// Room panel.
    Climate,
    /// Labels and layers.
    Sensor,
}

impl Role {
    const NAMES: [(Role, &'static str); 10] = [
        (Role::Light, "light"),
        (Role::Switch, "switch"),
        (Role::Fan, "fan"),
        (Role::Cover, "cover"),
        (Role::Media, "media"),
        (Role::Contact, "contact"),
        (Role::Lock, "lock"),
        (Role::Power, "power"),
        (Role::Climate, "climate"),
        (Role::Sensor, "sensor"),
    ];

    /// The role's name in bindings.
    pub fn name(self) -> &'static str {
        Self::NAMES
            .iter()
            .find(|(role, _)| *role == self)
            .map_or("sensor", |(_, name)| name)
    }

    /// Reads a role name.
    pub fn from_name(name: &str) -> Option<Role> {
        Self::NAMES
            .iter()
            .find(|(_, n)| *n == name)
            .map(|(role, _)| *role)
    }

    /// The role of an entity without an explicit one, from its domain and device class.
    pub fn derive(entity_id: &str, device_class: Option<&str>) -> Role {
        let domain = entity_id.split('.').next().unwrap_or_default();
        match domain {
            "light" => Role::Light,
            "switch" | "input_boolean" => Role::Switch,
            "fan" => Role::Fan,
            "cover" => Role::Cover,
            "media_player" => Role::Media,
            "lock" => Role::Lock,
            "climate" => Role::Climate,
            "binary_sensor"
                if matches!(
                    device_class,
                    Some("door" | "window" | "opening" | "garage_door")
                ) =>
            {
                Role::Contact
            }
            "sensor" if device_class == Some("power") => Role::Power,
            _ => Role::Sensor,
        }
    }
}

/// An entity bound to an element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundEntity {
    /// `domain.object_id`.
    pub entity_id: String,
    /// Explicit role; `None` derives it from the entity.
    pub role: Option<Role>,
}

/// The bindings of a home.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Bindings {
    /// Entities of each bound element, by element id.
    pub elements: BTreeMap<String, Vec<BoundEntity>>,
    /// Home Assistant area of each room, by room id.
    pub rooms: BTreeMap<String, String>,
}

/// Most entities read per element.
const MAX_ENTITIES: usize = 16;

fn valid_entity_id(id: &str) -> bool {
    let mut parts = id.splitn(2, '.');
    let (Some(domain), Some(object)) = (parts.next(), parts.next()) else {
        return false;
    };
    !domain.is_empty()
        && !object.is_empty()
        && id.len() <= 255
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.')
}

/// Reads bindings leniently: anything malformed is skipped.
pub fn read_bindings(value: &Value) -> Bindings {
    let mut bindings = Bindings::default();
    if let Some(rooms) = value.get("rooms").and_then(Value::as_object) {
        for (room, entry) in rooms {
            if let Some(area) = entry.get("area").and_then(Value::as_str) {
                bindings.rooms.insert(room.clone(), area.to_owned());
            }
        }
    }
    if let Some(elements) = value.get("elements").and_then(Value::as_object) {
        for (element, entry) in elements {
            let entities: Vec<BoundEntity> = entry
                .get("entities")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|e| {
                    let entity_id = e.get("entity_id")?.as_str()?;
                    valid_entity_id(entity_id).then(|| BoundEntity {
                        entity_id: entity_id.to_owned(),
                        role: e
                            .get("role")
                            .and_then(Value::as_str)
                            .and_then(Role::from_name),
                    })
                })
                .take(MAX_ENTITIES)
                .collect();
            if !entities.is_empty() {
                bindings.elements.insert(element.clone(), entities);
            }
        }
    }
    bindings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_demo_bindings() {
        let text = include_str!("../../../examples/demo-apartment.bindings.json");
        let value: Value = serde_json::from_str(text).unwrap_or(Value::Null);
        let bindings = read_bindings(&value);
        assert_eq!(
            bindings.rooms.get("living").map(String::as_str),
            Some("living_room")
        );
        let tv = bindings.elements.get("tv").cloned().unwrap_or_default();
        assert_eq!(tv.len(), 2);
        assert_eq!(tv[1].role, Some(Role::Power));
        assert!(bindings.elements.contains_key("door-entrance"));
    }

    #[test]
    fn skips_what_it_does_not_understand() {
        let value = serde_json::json!({
            "rooms": { "a": { "area": 3 }, "b": {} },
            "elements": {
                "x": { "entities": [{ "entity_id": "Not An Id" }, { "entity_id": "light.ok", "role": "nope" }] },
                "y": { "entities": "light.k" },
                "z": {}
            }
        });
        let bindings = read_bindings(&value);
        assert!(bindings.rooms.is_empty());
        assert_eq!(
            bindings.elements.get("x"),
            Some(&vec![BoundEntity {
                entity_id: "light.ok".into(),
                role: None
            }])
        );
        assert_eq!(bindings.elements.len(), 1);
        assert_eq!(read_bindings(&Value::Null), Bindings::default());
    }

    #[test]
    fn derives_roles() {
        assert_eq!(Role::derive("light.a", None), Role::Light);
        assert_eq!(Role::derive("input_boolean.a", None), Role::Switch);
        assert_eq!(
            Role::derive("binary_sensor.a", Some("window")),
            Role::Contact
        );
        assert_eq!(
            Role::derive("binary_sensor.a", Some("motion")),
            Role::Sensor
        );
        assert_eq!(Role::derive("sensor.a", Some("power")), Role::Power);
        assert_eq!(Role::derive("media_player.tv", None), Role::Media);
        for (role, name) in Role::NAMES {
            assert_eq!(Role::from_name(name), Some(role));
            assert_eq!(role.name(), name);
        }
    }
}
