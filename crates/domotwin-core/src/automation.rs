//! What an automation involves (`DECISIONS.md`, D-032): its configuration, as Home Assistant
//! keeps it, read into ends. Each end is what sets the automation off (a trigger), what it checks
//! (a condition) or what it acts on (an action), and is an entity, a device, an area, something
//! with no place in the home (a time, the sun, a notification) or something only known when it
//! runs (a template).
//!
//! Both spellings Home Assistant accepts are read: `triggers` and `trigger`, `trigger:` and
//! `platform:` in a trigger, `actions` and `action`, `action:` and `service:` in a call. Nested
//! steps (`choose`, `if`, `repeat`, `parallel`, `sequence`) are followed. Reading is lenient: what
//! is not known is skipped and counted, never refused, and no input makes it panic.

use std::collections::HashMap;

use serde_json::Value;

/// Deepest nesting followed (conditions and steps within steps).
const MAX_DEPTH: usize = 24;
/// Most ends read from one automation.
pub const MAX_ENDS: usize = 256;
/// Longest id or label kept (characters): Home Assistant's longest entity id.
const MAX_TEXT: usize = 255;

/// What an end is to its automation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Role {
    Trigger,
    Condition,
    Action,
}

impl Role {
    /// The name in the interface's JSON.
    pub const fn name(self) -> &'static str {
        match self {
            Role::Trigger => "trigger",
            Role::Condition => "condition",
            Role::Action => "action",
        }
    }
}

/// What an end is about.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Target {
    /// An entity (`light.hall`).
    Entity(String),
    /// A Home Assistant device (its registry id).
    Device(String),
    /// A Home Assistant area (its id).
    Area(String),
    /// A Home Assistant floor (its id): every area on it.
    Floor(String),
    /// A Home Assistant label (its id): every entity, device and area that has it.
    Label(String),
    /// Something with no place in the home: the kind of trigger or condition (`time`, `sun`,
    /// `template`…), or the action called (`notify.phone`).
    Place(String),
    /// Known only when it runs: a template where an entity, a device or an action is named.
    Dynamic(String),
}

/// One end of an automation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct End {
    pub role: Role,
    pub target: Target,
}

/// An automation's ends, in the order they are written, each once.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Automation {
    pub ends: Vec<End>,
    /// Triggers, conditions and steps not known (or nested too deep), left out.
    pub skipped: usize,
}

impl Automation {
    /// Reads an automation's configuration (`automation/config`'s `config`).
    pub fn read(config: &Value) -> Self {
        let mut reader = Reader::default();
        if let Some(config) = config.as_object() {
            let triggers = config.get("triggers").or_else(|| config.get("trigger"));
            for trigger in items(triggers) {
                reader.trigger(trigger, Role::Trigger);
            }
            let conditions = config.get("conditions").or_else(|| config.get("condition"));
            for condition in items(conditions) {
                reader.condition(condition, 0);
            }
            let actions = config.get("actions").or_else(|| config.get("action"));
            for action in items(actions) {
                reader.action(action, 0);
            }
        }
        reader.automation
    }

    /// The ends of `role`.
    pub fn ends_of(&self, role: Role) -> impl Iterator<Item = &End> {
        self.ends.iter().filter(move |e| e.role == role)
    }
}

/// Where an end is drawn.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Spot {
    /// At a piece, a door or a window of the plan (its id).
    Piece(String),
    /// In a room (its id): an area acted on as a whole.
    Room(String),
    /// A label floating above a room, or above the home (`room: None`): what has no piece (a
    /// time, the sun, a notification, an entity of the room linked to nothing). Ends with the
    /// same label at the same place share it.
    Above { room: Option<String>, label: String },
}

/// An end of an automation, placed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlacedEnd {
    pub role: Role,
    pub spot: Spot,
    /// Known only when it runs (a template): drawn dashed.
    pub dynamic: bool,
}

/// A wire between two spots: what sets an automation off, or what it checks, to what it acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub from: Spot,
    pub to: Spot,
    /// From a condition, or to an action known only when it runs.
    pub dashed: bool,
    /// The automations it is part of (their indices), in order.
    pub automations: Vec<usize>,
}

/// The wires of `automations` (each one's placed ends): every trigger to every action, every
/// condition to every action (dashed). With `by_room`, the spots are first replaced by what it
/// gives (their rooms, for a home with many automations) and the wires the automations share
/// are drawn once, with all of them. A wire whose two ends are at the same spot is left out.
pub fn links(automations: &[Vec<PlacedEnd>], by_room: Option<&dyn Fn(&Spot) -> Spot>) -> Vec<Link> {
    let mut out: Vec<Link> = Vec::new();
    let mut index: HashMap<(Spot, Spot, bool), usize> = HashMap::new();
    for (i, ends) in automations.iter().enumerate() {
        let spot = |e: &PlacedEnd| by_room.map_or_else(|| e.spot.clone(), |f| f(&e.spot));
        let actions: Vec<&PlacedEnd> = ends.iter().filter(|e| e.role == Role::Action).collect();
        for from in ends.iter().filter(|e| e.role != Role::Action) {
            for to in &actions {
                let (a, b) = (spot(from), spot(to));
                if a == b {
                    continue;
                }
                let dashed = from.role == Role::Condition || to.dynamic;
                let key = (a, b, dashed);
                if let Some(&k) = index.get(&key) {
                    let link = &mut out[k];
                    if link.automations.last() != Some(&i) {
                        link.automations.push(i);
                    }
                    continue;
                }
                let (from, to, dashed) = key.clone();
                index.insert(key, out.len());
                out.push(Link {
                    from,
                    to,
                    dashed,
                    automations: vec![i],
                });
            }
        }
        if by_room.is_none() {
            // Each automation's wires are its own.
            index.clear();
        }
    }
    out
}

/// The items of a list, or the one item written alone.
fn items(value: Option<&Value>) -> &[Value] {
    match value {
        Some(Value::Array(list)) => list,
        Some(one @ (Value::Object(_) | Value::String(_))) => std::slice::from_ref(one),
        _ => &[],
    }
}

/// A template rather than a name.
fn templated(text: &str) -> bool {
    text.contains("{{") || text.contains("{%")
}

/// Text cut to [`MAX_TEXT`] characters.
fn cut(text: &str) -> String {
    text.trim().chars().take(MAX_TEXT).collect()
}

/// The names in an entity, device or area field: a string (maybe comma separated) or a list.
fn names(value: Option<&Value>) -> Vec<&str> {
    match value {
        Some(Value::String(text)) if templated(text) => vec![text.as_str()],
        Some(Value::String(text)) => text
            .split(',')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .collect(),
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// The type of a trigger or condition, or the name of a call.
fn text<'a>(item: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| item.get(*k)?.as_str())
}

/// Turned off in its configuration (`enabled: false`): not part of what the automation does.
fn disabled(item: &Value) -> bool {
    item.get("enabled").and_then(Value::as_bool) == Some(false)
}

/// How a name in a field becomes a target.
type MakeTarget = fn(String) -> Target;

#[derive(Debug, Default)]
struct Reader {
    automation: Automation,
}

impl Reader {
    fn push(&mut self, role: Role, target: Target) {
        let ends = &mut self.automation.ends;
        let end = End { role, target };
        if ends.len() < MAX_ENDS && !ends.contains(&end) {
            ends.push(end);
        }
    }

    fn skip(&mut self) {
        self.automation.skipped += 1;
    }

    /// The entities, devices and areas named in `fields` of `item`.
    fn targets(&mut self, item: &Value, role: Role, label: &str) -> bool {
        let mut any = false;
        let kinds: [(&str, MakeTarget); 5] = [
            ("entity_id", Target::Entity),
            ("device_id", Target::Device),
            ("area_id", Target::Area),
            ("floor_id", Target::Floor),
            ("label_id", Target::Label),
        ];
        for (field, make) in kinds {
            for name in names(item.get(field)) {
                // An entity id has a dot; a device's triggers, conditions and actions hold the
                // entity registry's id there instead (the device is their end).
                let special = templated(name) || name == "all" || name == "none";
                if field == "entity_id" && !name.contains('.') && !special {
                    continue;
                }
                any = true;
                if templated(name) {
                    self.push(role, Target::Dynamic(cut(label)));
                } else if name == "all" || name == "none" {
                    self.push(role, Target::Dynamic(cut(name)));
                } else {
                    self.push(role, make(cut(name)));
                }
            }
        }
        any
    }

    /// A trigger (also those an action waits for, read with `role`).
    fn trigger(&mut self, item: &Value, role: Role) {
        if !item.is_object() {
            self.skip();
            return;
        }
        if disabled(item) {
            return;
        }
        let Some(kind) = text(item, &["trigger", "platform"]) else {
            self.skip();
            return;
        };
        match kind {
            "state" | "numeric_state" | "device" | "zone" | "calendar" | "geo_location" => {
                if !self.targets(item, role, kind) {
                    self.push(role, Target::Place(cut(kind)));
                }
                if kind == "zone" {
                    for zone in names(item.get("zone")) {
                        self.push(role, Target::Entity(cut(zone)));
                    }
                }
            }
            "time" => {
                // Times of day, and entities holding one (an input_datetime, a timestamp, maybe
                // with an offset: `{entity_id, offset}`), in a list or alone.
                let mut times = false;
                for at in items(item.get("at")) {
                    let found = match at {
                        Value::Object(_) => names(at.get("entity_id")),
                        other => names(Some(other)),
                    };
                    for name in found {
                        if name.contains('.') && !name.contains(':') {
                            self.push(role, Target::Entity(cut(name)));
                        } else {
                            times = true;
                        }
                    }
                }
                if times || items(item.get("at")).is_empty() {
                    self.push(role, Target::Place("time".to_owned()));
                }
            }
            "event" => {
                let data = item.get("event_data").unwrap_or(&Value::Null);
                if !self.targets(data, role, kind) {
                    self.push(role, Target::Place("event".to_owned()));
                }
            }
            "time_pattern"
            | "sun"
            | "template"
            | "homeassistant"
            | "mqtt"
            | "webhook"
            | "tag"
            | "conversation"
            | "persistent_notification" => {
                self.push(role, Target::Place(cut(kind)));
            }
            _ => self.skip(),
        }
    }

    /// A condition, written out or as a template.
    fn condition(&mut self, item: &Value, depth: usize) {
        if depth > MAX_DEPTH {
            self.skip();
            return;
        }
        let role = Role::Condition;
        if let Some(template) = item.as_str() {
            if templated(template) {
                self.push(role, Target::Place("template".to_owned()));
            } else {
                self.skip();
            }
            return;
        }
        if !item.is_object() {
            self.skip();
            return;
        }
        if disabled(item) {
            return;
        }
        // The short forms of and, or, not: `{"or": [...]}`.
        let kind = text(item, &["condition"]).or_else(|| {
            ["and", "or", "not"]
                .into_iter()
                .find(|k| item.get(*k).is_some())
        });
        let Some(kind) = kind else {
            self.skip();
            return;
        };
        // A template written in place of the condition's type (`condition: "{{ … }}"`).
        if templated(kind) {
            self.push(role, Target::Place("template".to_owned()));
            return;
        }
        match kind {
            "state" | "numeric_state" | "device" | "zone" => {
                if !self.targets(item, role, kind) {
                    self.push(role, Target::Place(cut(kind)));
                }
                if kind == "zone" {
                    for zone in names(item.get("zone")) {
                        self.push(role, Target::Entity(cut(zone)));
                    }
                }
            }
            "and" | "or" | "not" => {
                let inner = item.get("conditions").or_else(|| item.get(kind));
                for condition in items(inner) {
                    self.condition(condition, depth + 1);
                }
            }
            "template" | "time" | "sun" => self.push(role, Target::Place(cut(kind))),
            // Which trigger fired: no end of its own.
            "trigger" => {}
            _ => self.skip(),
        }
    }

    /// The conditions of a step (`conditions`, `condition`, `if`, `while`, `until`).
    fn step_conditions(&mut self, value: Option<&Value>, depth: usize) {
        for condition in items(value) {
            self.condition(condition, depth + 1);
        }
    }

    /// Steps in a list or alone.
    fn sequence(&mut self, value: Option<&Value>, depth: usize) {
        for step in items(value) {
            self.action(step, depth + 1);
        }
    }

    /// A step of the actions.
    fn action(&mut self, item: &Value, depth: usize) {
        if depth > MAX_DEPTH {
            self.skip();
            return;
        }
        let Some(step) = item.as_object() else {
            self.skip();
            return;
        };
        if disabled(item) {
            return;
        }
        let role = Role::Action;
        if let Some(call) = text(item, &["action", "service", "service_template"]) {
            let mut any = self.targets(item, role, call);
            for field in ["target", "data", "data_template"] {
                match item.get(field) {
                    // The whole target a template: known only when it runs.
                    Some(Value::String(text)) if templated(text) => {
                        self.push(role, Target::Dynamic(cut(call)));
                        any = true;
                    }
                    Some(inner) => any |= self.targets(inner, role, call),
                    None => {}
                }
            }
            if templated(call) {
                self.push(role, Target::Dynamic("action".to_owned()));
            } else if !any {
                self.push(role, Target::Place(cut(call)));
            }
        } else if let Some(scene) = item.get("scene") {
            for name in names(Some(scene)) {
                let target = if templated(name) {
                    Target::Dynamic("scene".to_owned())
                } else {
                    Target::Entity(cut(name))
                };
                self.push(role, target);
            }
        } else if step.contains_key("device_id") && step.contains_key("domain") {
            self.targets(item, role, "device");
        } else if let Some(choose) = step.get("choose") {
            for option in items(Some(choose)) {
                let conditions = option.get("conditions").or_else(|| option.get("condition"));
                self.step_conditions(conditions, depth);
                self.sequence(option.get("sequence"), depth);
            }
            self.sequence(step.get("default"), depth);
        } else if step.contains_key("if") {
            self.step_conditions(step.get("if"), depth);
            self.sequence(step.get("then"), depth);
            self.sequence(step.get("else"), depth);
        } else if let Some(repeat) = step.get("repeat") {
            self.step_conditions(repeat.get("while"), depth);
            self.step_conditions(repeat.get("until"), depth);
            self.sequence(repeat.get("sequence"), depth);
        } else if let Some(parallel) = step.get("parallel") {
            self.sequence(Some(parallel), depth);
        } else if let Some(sequence) = step.get("sequence") {
            self.sequence(Some(sequence), depth);
        } else if ["condition", "and", "or", "not"]
            .iter()
            .any(|k| step.contains_key(*k))
        {
            self.condition(item, depth + 1);
        } else if let Some(wait) = step.get("wait_for_trigger") {
            // What it waits for gates the steps after it, as a condition does.
            for trigger in items(Some(wait)) {
                self.trigger(trigger, Role::Condition);
            }
        } else if step.contains_key("wait_template") {
            self.push(Role::Condition, Target::Place("template".to_owned()));
        } else if [
            "delay",
            "event",
            "variables",
            "stop",
            "set_conversation_response",
        ]
        .iter()
        .any(|k| step.contains_key(*k))
        {
            // Steps with nothing of the home in them.
        } else {
            self.skip();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entity(role: Role, id: &str) -> End {
        End {
            role,
            target: Target::Entity(id.to_owned()),
        }
    }

    fn place(role: Role, kind: &str) -> End {
        End {
            role,
            target: Target::Place(kind.to_owned()),
        }
    }

    #[test]
    fn reads_triggers_conditions_and_actions_in_both_spellings() {
        // Today's spelling…
        let now = Automation::read(&json!({
            "alias": "Hall light at dusk",
            "triggers": [
                { "trigger": "state", "entity_id": ["binary_sensor.hall_motion"], "to": "on" },
                { "trigger": "sun", "event": "sunset" }
            ],
            "conditions": [{ "condition": "state", "entity_id": "input_boolean.guests", "state": "off" }],
            "actions": [{ "action": "light.turn_on", "target": { "entity_id": "light.hall" } }]
        }));
        // …and the earlier one.
        let before = Automation::read(&json!({
            "trigger": [
                { "platform": "state", "entity_id": "binary_sensor.hall_motion", "to": "on" },
                { "platform": "sun", "event": "sunset" }
            ],
            "condition": { "condition": "state", "entity_id": "input_boolean.guests", "state": "off" },
            "action": { "service": "light.turn_on", "entity_id": "light.hall" }
        }));
        let expected = vec![
            entity(Role::Trigger, "binary_sensor.hall_motion"),
            place(Role::Trigger, "sun"),
            entity(Role::Condition, "input_boolean.guests"),
            entity(Role::Action, "light.hall"),
        ];
        assert_eq!(now.ends, expected);
        assert_eq!(before.ends, expected);
        assert_eq!((now.skipped, before.skipped), (0, 0));
        assert_eq!(now.ends_of(Role::Trigger).count(), 2);
    }

    #[test]
    fn follows_nested_steps() {
        let automation = Automation::read(&json!({
            "triggers": [{ "trigger": "device", "device_id": "dev-button", "domain": "zha", "type": "remote_button_short_press" }],
            "actions": [
                { "choose": [
                    { "conditions": [{ "condition": "or", "conditions": [
                        { "condition": "numeric_state", "entity_id": "sensor.lux", "below": 20 },
                        { "condition": "time", "after": "22:00" }
                      ] }],
                      "sequence": [{ "action": "light.turn_on", "target": { "area_id": "living_room" } }] }
                  ],
                  "default": [{ "action": "light.turn_off", "target": { "area_id": "living_room" } }] },
                { "if": [{ "condition": "state", "entity_id": "media_player.tv", "state": "playing" }],
                  "then": [{ "action": "media_player.media_pause", "target": { "entity_id": "media_player.tv" } }],
                  "else": [{ "scene": "scene.evening" }] },
                { "repeat": { "count": 3, "sequence": [
                    { "parallel": [
                        { "action": "notify.phone", "data": { "message": "Hi" } },
                        { "sequence": [{ "delay": 2 }, { "device_id": "dev-siren", "domain": "zha", "type": "warn" }] }
                    ] }
                ] } },
                { "repeat": { "until": [{ "condition": "state", "entity_id": "lock.front", "state": "locked" }],
                              "sequence": [{ "action": "lock.lock", "entity_id": "lock.front" }] } },
                { "wait_for_trigger": [{ "trigger": "state", "entity_id": "binary_sensor.door" }] },
                { "condition": "state", "entity_id": "person.someone", "state": "home" },
                { "event": "fictional_event" },
                { "variables": { "x": 1 } },
                { "stop": "done" }
            ]
        }));
        let device = |role, id: &str| End {
            role,
            target: Target::Device(id.to_owned()),
        };
        let area = |id: &str| End {
            role: Role::Action,
            target: Target::Area(id.to_owned()),
        };
        assert_eq!(
            automation.ends,
            vec![
                device(Role::Trigger, "dev-button"),
                entity(Role::Condition, "sensor.lux"),
                place(Role::Condition, "time"),
                area("living_room"),
                entity(Role::Condition, "media_player.tv"),
                entity(Role::Action, "media_player.tv"),
                entity(Role::Action, "scene.evening"),
                place(Role::Action, "notify.phone"),
                device(Role::Action, "dev-siren"),
                entity(Role::Condition, "lock.front"),
                entity(Role::Action, "lock.front"),
                entity(Role::Condition, "binary_sensor.door"),
                entity(Role::Condition, "person.someone"),
            ]
        );
        assert_eq!(automation.skipped, 0);
    }

    #[test]
    fn templates_and_places_without_a_piece() {
        let automation = Automation::read(&json!({
            "triggers": [
                { "trigger": "time", "at": "07:30:00" },
                { "trigger": "time", "at": ["input_datetime.wake_up", "sensor.phone_next_alarm"] },
                { "trigger": "template", "value_template": "{{ states('sensor.x') | int > 3 }}" },
                { "trigger": "zone", "entity_id": "person.someone", "zone": "zone.home", "event": "enter" },
                { "trigger": "event", "event_type": "fictional", "event_data": { "entity_id": "light.desk" } },
                { "trigger": "time_pattern", "minutes": "/5" }
            ],
            "conditions": "{{ is_state('sun.sun', 'below_horizon') }}",
            "actions": [
                { "action": "{{ 'light.turn_' ~ mode }}", "target": { "entity_id": "light.desk" } },
                { "action": "light.turn_on", "target": { "entity_id": "{{ lamps }}" } },
                { "action": "homeassistant.turn_off", "target": { "entity_id": "all" } },
                { "action": "light.turn_on", "target": { "entity_id": "light.a, light.b" } }
            ]
        }));
        let dynamic = |label: &str| End {
            role: Role::Action,
            target: Target::Dynamic(label.to_owned()),
        };
        assert_eq!(
            automation.ends,
            vec![
                place(Role::Trigger, "time"),
                entity(Role::Trigger, "input_datetime.wake_up"),
                entity(Role::Trigger, "sensor.phone_next_alarm"),
                place(Role::Trigger, "template"),
                entity(Role::Trigger, "person.someone"),
                entity(Role::Trigger, "zone.home"),
                entity(Role::Trigger, "light.desk"),
                place(Role::Trigger, "time_pattern"),
                place(Role::Condition, "template"),
                entity(Role::Action, "light.desk"),
                dynamic("action"),
                dynamic("light.turn_on"),
                dynamic("all"),
                entity(Role::Action, "light.a"),
                entity(Role::Action, "light.b"),
            ]
        );
    }

    #[test]
    fn device_automations_mixed_times_and_short_conditions() {
        let automation = Automation::read(&json!({
            "triggers": [
                // A device trigger made in the editor: the entity registry's id, not an entity.
                { "trigger": "device", "device_id": "dev-remote", "domain": "zha",
                  "entity_id": "6f1e8b4c2d3a4b5c6d7e8f9012345678", "type": "remote_button_short_press" },
                { "trigger": "time", "at": ["07:00:00", "input_datetime.wake_up",
                    { "entity_id": "sensor.phone_next_alarm", "offset": "-00:10:00" }] }
            ],
            "actions": [
                { "device_id": "dev-lamp", "domain": "light",
                  "entity_id": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "type": "turn_on" },
                { "or": [
                    { "condition": "state", "entity_id": "person.someone", "state": "home" },
                    { "condition": "state", "entity_id": "person.other", "state": "home" }
                ] }
            ]
        }));
        let device = |role, id: &str| End {
            role,
            target: Target::Device(id.to_owned()),
        };
        assert_eq!(
            automation.ends,
            vec![
                device(Role::Trigger, "dev-remote"),
                entity(Role::Trigger, "input_datetime.wake_up"),
                entity(Role::Trigger, "sensor.phone_next_alarm"),
                place(Role::Trigger, "time"),
                device(Role::Action, "dev-lamp"),
                entity(Role::Condition, "person.someone"),
                entity(Role::Condition, "person.other"),
            ]
        );
        assert_eq!(automation.skipped, 0);
    }

    #[test]
    fn floors_labels_template_targets_and_conditions() {
        let long = format!("sensor.{}", "a".repeat(200));
        let automation = Automation::read(&json!({
            "triggers": [{ "trigger": "state", "entity_id": long }],
            "actions": [
                { "condition": "{{ is_state('sun.sun', 'below_horizon') }}" },
                { "action": "light.turn_off", "target": { "floor_id": "upstairs", "label_id": ["night"] } },
                { "action": "light.turn_on", "target": "{{ lamps_for(trigger) }}" }
            ]
        }));
        assert_eq!(
            automation.ends,
            vec![
                entity(Role::Trigger, &long),
                place(Role::Condition, "template"),
                End {
                    role: Role::Action,
                    target: Target::Floor("upstairs".to_owned())
                },
                End {
                    role: Role::Action,
                    target: Target::Label("night".to_owned())
                },
                End {
                    role: Role::Action,
                    target: Target::Dynamic("light.turn_on".to_owned())
                },
            ]
        );
        assert_eq!(automation.skipped, 0);
    }

    #[test]
    fn unknown_things_are_skipped_and_counted() {
        let automation = Automation::read(&json!({
            "triggers": [
                { "trigger": "fictional_platform" },
                { "entity_id": "light.no_type" },
                42,
                { "trigger": "state", "entity_id": "light.kept", "enabled": false }
            ],
            "conditions": [{ "condition": "fictional" }, "not a template", null],
            "actions": [{ "fictional_step": true }, "text", { "action": "light.toggle", "entity_id": "light.ok" }]
        }));
        assert_eq!(automation.ends, vec![entity(Role::Action, "light.ok")]);
        assert_eq!(automation.skipped, 8);
    }

    fn placed(role: Role, spot: Spot) -> PlacedEnd {
        PlacedEnd {
            role,
            spot,
            dynamic: false,
        }
    }

    fn piece(id: &str) -> Spot {
        Spot::Piece(id.to_owned())
    }

    #[test]
    fn wires_join_triggers_and_conditions_to_actions() {
        let sun = Spot::Above {
            room: None,
            label: "sun".to_owned(),
        };
        let automations = vec![
            vec![
                placed(Role::Trigger, piece("motion")),
                placed(Role::Trigger, sun.clone()),
                placed(Role::Condition, piece("switch")),
                placed(Role::Action, piece("lamp")),
                PlacedEnd {
                    role: Role::Action,
                    spot: Spot::Room("hall".to_owned()),
                    dynamic: true,
                },
                // Its own trigger acted on: no wire.
                placed(Role::Action, piece("motion")),
            ],
            vec![
                placed(Role::Trigger, piece("motion")),
                placed(Role::Action, piece("lamp")),
            ],
        ];
        let links = links(&automations, None);
        let ends: Vec<(&Spot, &Spot, bool, &[usize])> = links
            .iter()
            .map(|l| (&l.from, &l.to, l.dashed, l.automations.as_slice()))
            .collect();
        let hall = Spot::Room("hall".to_owned());
        assert_eq!(
            ends,
            [
                (&piece("motion"), &piece("lamp"), false, &[0][..]),
                (&piece("motion"), &hall, true, &[0][..]),
                (&sun, &piece("lamp"), false, &[0][..]),
                (&sun, &hall, true, &[0][..]),
                (&sun, &piece("motion"), false, &[0][..]),
                (&piece("switch"), &piece("lamp"), true, &[0][..]),
                (&piece("switch"), &hall, true, &[0][..]),
                (&piece("switch"), &piece("motion"), true, &[0][..]),
                // The second automation's wire is its own, though alike.
                (&piece("motion"), &piece("lamp"), false, &[1][..]),
            ]
        );
    }

    #[test]
    fn many_automations_are_bundled_by_room() {
        let room_of = |spot: &Spot| match spot {
            Spot::Piece(id) => Spot::Room(
                if id.starts_with("k-") {
                    "kitchen"
                } else {
                    "hall"
                }
                .to_owned(),
            ),
            other => other.clone(),
        };
        let automations: Vec<Vec<PlacedEnd>> = (0..3)
            .map(|i| {
                vec![
                    placed(Role::Trigger, piece(&format!("h-sensor-{i}"))),
                    placed(Role::Action, piece(&format!("k-lamp-{i}"))),
                    // Within one room: nothing to draw between rooms.
                    placed(Role::Action, piece(&format!("h-lamp-{i}"))),
                ]
            })
            .collect();
        let links = links(&automations, Some(&room_of));
        assert_eq!(
            links,
            [Link {
                from: Spot::Room("hall".to_owned()),
                to: Spot::Room("kitchen".to_owned()),
                dashed: false,
                automations: vec![0, 1, 2],
            }]
        );
    }

    #[test]
    fn deep_or_odd_input_never_panics() {
        for value in [
            json!(null),
            json!(3),
            json!("x"),
            json!([1, 2]),
            json!({ "triggers": "x" }),
        ] {
            assert_eq!(Automation::read(&value).ends, Vec::new());
        }
        // Steps nested deeper than followed are counted, not followed.
        let mut step = json!({ "action": "light.turn_on", "entity_id": "light.deep" });
        for _ in 0..200 {
            step = json!({ "sequence": [step] });
        }
        let automation = Automation::read(&json!({ "actions": [step] }));
        assert!(automation.ends.is_empty());
        assert_eq!(automation.skipped, 1);
        // Many ends: at most MAX_ENDS, each once.
        let lights: Vec<String> = (0..1_000).map(|i| format!("light.l{i}")).collect();
        let automation = Automation::read(&json!({
            "actions": [
                { "action": "light.turn_on", "entity_id": lights },
                { "action": "light.turn_on", "entity_id": "light.l0" }
            ]
        }));
        assert_eq!(automation.ends.len(), MAX_ENDS);
    }
}
