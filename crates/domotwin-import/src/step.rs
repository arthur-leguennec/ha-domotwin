//! The STEP physical file format (ISO 10303-21) that IFC files use: `#12=IFCWALL('…',#5,…);`.
//!
//! One pass indexes where every entity instance starts and its type; attributes are parsed only
//! when asked for, so a 100 MB file costs its bytes plus a small index. Nothing here panics on
//! input: malformed records are skipped, deep nesting is cut off.

use std::collections::HashMap;

/// Most entity instances read from one file.
pub const MAX_ENTITIES: usize = 8_000_000;
/// Deepest nesting of lists and typed values parsed.
const MAX_DEPTH: usize = 48;

/// An attribute value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `$`: not set.
    Null,
    /// `*`: derived by the schema.
    Derived,
    /// An integer.
    Int(i64),
    /// A real number.
    Real(f64),
    /// A string, decoded.
    Str(String),
    /// An enumeration value without its dots (`.T.` is `T`).
    Enum(String),
    /// A reference to another instance: `#12`.
    Ref(u32),
    /// A binary value (not used by DomoTwin).
    Binary,
    /// A list `( … )`.
    List(Vec<Value>),
    /// A typed value `IFCLENGTHMEASURE(2.5)`.
    Typed(String, Box<Value>),
}

impl Value {
    /// The instance it refers to.
    pub fn reference(&self) -> Option<u32> {
        match self {
            Value::Ref(id) => Some(*id),
            _ => None,
        }
    }

    /// A number (integer, real or typed number).
    #[allow(clippy::cast_precision_loss)]
    pub fn number(&self) -> Option<f64> {
        match self {
            Value::Int(n) => Some(*n as f64),
            Value::Real(x) if x.is_finite() => Some(*x),
            Value::Typed(_, inner) => inner.number(),
            _ => None,
        }
    }

    /// A string (or a typed string, like `IFCLABEL('…')`).
    pub fn text(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Typed(_, inner) => inner.text(),
            _ => None,
        }
    }

    /// An enumeration value.
    pub fn enumeration(&self) -> Option<&str> {
        match self {
            Value::Enum(s) => Some(s),
            Value::Typed(_, inner) => inner.enumeration(),
            _ => None,
        }
    }

    /// A list (empty when it is not one).
    pub fn list(&self) -> &[Value] {
        match self {
            Value::List(items) => items,
            _ => &[],
        }
    }

    /// The references of a list.
    pub fn references(&self) -> Vec<u32> {
        self.list().iter().filter_map(Value::reference).collect()
    }
}

/// Where an instance is in the file.
#[derive(Debug, Clone, Copy)]
struct Record {
    /// Index in `types`.
    ty: u32,
    /// Byte range of the attributes, between the parentheses.
    start: u32,
    end: u32,
}

/// An entity instance with its attributes.
#[derive(Debug, Clone)]
pub struct Entity<'a> {
    /// Its `#` number.
    pub id: u32,
    /// Its type, upper case (`IFCWALL`).
    pub ty: &'a str,
    /// Its attributes, in schema order.
    pub attrs: Vec<Value>,
}

impl Entity<'_> {
    /// Attribute `i`, or `Null` past the end.
    pub fn get(&self, i: usize) -> &Value {
        self.attrs.get(i).unwrap_or(&Value::Null)
    }

    /// Attribute `i` as a reference.
    pub fn reference(&self, i: usize) -> Option<u32> {
        self.get(i).reference()
    }

    /// Attribute `i` as a number.
    pub fn number(&self, i: usize) -> Option<f64> {
        self.get(i).number()
    }

    /// Attribute `i` as a string.
    pub fn text(&self, i: usize) -> Option<&str> {
        self.get(i).text()
    }

    /// Attribute `i` as an enumeration value.
    pub fn enumeration(&self, i: usize) -> Option<&str> {
        self.get(i).enumeration()
    }
}

/// Why a file cannot be read at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepError {
    /// It does not start with `ISO-10303-21;`.
    NotStep,
    /// Too many instances.
    TooLarge,
}

/// A STEP file, indexed.
#[derive(Debug)]
pub struct StepFile {
    data: Vec<u8>,
    index: HashMap<u32, Record>,
    types: Vec<String>,
    by_type: HashMap<String, Vec<u32>>,
    /// The schema named in the header (`IFC4`, `IFC2X3`…), upper case.
    pub schema: String,
}

fn is_space(b: u8) -> bool {
    b.is_ascii_whitespace()
}

/// Skips a string starting at `i` (on the opening quote); returns the index after it.
fn skip_string(data: &[u8], mut i: usize) -> usize {
    i += 1;
    while i < data.len() {
        if data[i] == b'\'' {
            if data.get(i + 1) == Some(&b'\'') {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    data.len()
}

/// Skips a comment starting at `i` (on `/*`); returns the index after it.
fn skip_comment(data: &[u8], i: usize) -> usize {
    data[i + 2..]
        .windows(2)
        .position(|w| w == b"*/")
        .map_or(data.len(), |p| i + 2 + p + 2)
}

/// The index after the next `;` outside strings and comments, from `i`.
fn next_statement(data: &[u8], mut i: usize) -> usize {
    while i < data.len() {
        match data[i] {
            b'\'' => i = skip_string(data, i),
            b'/' if data.get(i + 1) == Some(&b'*') => i = skip_comment(data, i),
            b';' => return i + 1,
            _ => i += 1,
        }
    }
    data.len()
}

fn skip_blank(data: &[u8], mut i: usize) -> usize {
    loop {
        while i < data.len() && is_space(data[i]) {
            i += 1;
        }
        if i + 1 < data.len() && data[i] == b'/' && data[i + 1] == b'*' {
            i = skip_comment(data, i);
        } else {
            return i;
        }
    }
}

/// Where a STEP file's header starts (past a byte-order mark, blanks and comments), when `data`
/// is one.
fn step_start(data: &[u8]) -> Option<usize> {
    // A byte-order mark some editors add is not part of the file.
    let bom = if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        3
    } else {
        0
    };
    let start = skip_blank(data, bom);
    let head = data.get(start..).unwrap_or_default();
    let magic = b"ISO-10303-21";
    (head.len() >= magic.len() && head[..magic.len()].eq_ignore_ascii_case(magic)).then_some(start)
}

/// Whether `data` is a STEP physical file (an IFC file's format).
pub(crate) fn is_step(data: &[u8]) -> bool {
    step_start(data).is_some()
}

impl StepFile {
    /// Indexes a file. Instances that cannot be indexed are skipped.
    ///
    /// # Errors
    ///
    /// `NotStep` when the file is not a STEP file, `TooLarge` past `MAX_ENTITIES` instances.
    pub fn new(data: Vec<u8>) -> Result<Self, StepError> {
        let start = step_start(&data).ok_or(StepError::NotStep)?;
        let mut file = StepFile {
            data: Vec::new(),
            index: HashMap::new(),
            types: Vec::new(),
            by_type: HashMap::new(),
            schema: String::new(),
        };
        let mut type_ids: HashMap<String, u32> = HashMap::new();
        let mut i = start;
        while i < data.len() {
            let s = skip_blank(&data, i);
            if s >= data.len() {
                break;
            }
            let end = next_statement(&data, s);
            let statement = &data[s..end];
            if statement.first() == Some(&b'#') {
                if let Some((id, ty, a, b)) = parse_header(statement) {
                    if file.index.len() >= MAX_ENTITIES {
                        return Err(StepError::TooLarge);
                    }
                    let name = String::from_utf8_lossy(ty).to_ascii_uppercase();
                    let next = u32::try_from(file.types.len()).unwrap_or(u32::MAX);
                    let ty_id = *type_ids.entry(name.clone()).or_insert_with(|| {
                        file.types.push(name.clone());
                        next
                    });
                    let (Ok(a), Ok(b)) = (u32::try_from(s + a), u32::try_from(s + b)) else {
                        return Err(StepError::TooLarge);
                    };
                    if file
                        .index
                        .insert(
                            id,
                            Record {
                                ty: ty_id,
                                start: a,
                                end: b,
                            },
                        )
                        .is_none()
                    {
                        file.by_type.entry(name).or_default().push(id);
                    }
                }
            } else if starts_with_word(statement, b"FILE_SCHEMA") {
                file.schema = schema_name(statement);
            }
            i = end;
        }
        for ids in file.by_type.values_mut() {
            ids.sort_unstable();
        }
        file.data = data;
        Ok(file)
    }

    /// Number of instances indexed.
    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// Whether no instance was indexed.
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    /// The type of instance `id`, upper case.
    pub fn type_of(&self, id: u32) -> Option<&str> {
        let record = self.index.get(&id)?;
        self.types.get(record.ty as usize).map(String::as_str)
    }

    /// The instances of a type (upper case), sorted by number.
    pub fn of_type(&self, ty: &str) -> &[u32] {
        self.by_type.get(ty).map_or(&[], Vec::as_slice)
    }

    /// Instance `id` with its attributes parsed.
    pub fn get(&self, id: u32) -> Option<Entity<'_>> {
        let record = self.index.get(&id)?;
        let bytes = self.data.get(record.start as usize..record.end as usize)?;
        let mut parser = Parser { data: bytes, i: 0 };
        let mut attrs = Vec::new();
        loop {
            parser.blank();
            if parser.i >= bytes.len() {
                break;
            }
            attrs.push(parser.value(0)?);
            parser.blank();
            match bytes.get(parser.i) {
                Some(b',') => parser.i += 1,
                None => break,
                Some(_) => return None,
            }
        }
        Some(Entity {
            id,
            ty: self.types.get(record.ty as usize)?,
            attrs,
        })
    }
}

fn starts_with_word(statement: &[u8], word: &[u8]) -> bool {
    statement.len() >= word.len() && statement[..word.len()].eq_ignore_ascii_case(word)
}

/// `FILE_SCHEMA(('IFC4'));` → `IFC4`.
fn schema_name(statement: &[u8]) -> String {
    let Some(q) = statement.iter().position(|&b| b == b'\'') else {
        return String::new();
    };
    let rest = &statement[q + 1..];
    let end = rest.iter().position(|&b| b == b'\'').unwrap_or(rest.len());
    String::from_utf8_lossy(&rest[..end])
        .trim()
        .to_ascii_uppercase()
}

/// `#12 = IFCWALL( … );` → (12, `IFCWALL`, start and end of the attributes). Complex instances
/// `#12 = ( … );` are skipped.
fn parse_header(statement: &[u8]) -> Option<(u32, &[u8], usize, usize)> {
    let mut i = 1;
    let digits = i;
    while i < statement.len() && statement[i].is_ascii_digit() {
        i += 1;
    }
    let id: u32 = std::str::from_utf8(&statement[digits..i])
        .ok()?
        .parse()
        .ok()?;
    i = skip_blank(statement, i);
    if statement.get(i) != Some(&b'=') {
        return None;
    }
    i = skip_blank(statement, i + 1);
    let name = i;
    while i < statement.len() && (statement[i].is_ascii_alphanumeric() || statement[i] == b'_') {
        i += 1;
    }
    if i == name {
        return None;
    }
    let ty = &statement[name..i];
    i = skip_blank(statement, i);
    if statement.get(i) != Some(&b'(') {
        return None;
    }
    let start = i + 1;
    // The matching parenthesis: the last `)` before the final `;`.
    let close = statement.iter().rposition(|&b| b == b')')?;
    (close >= start).then_some((id, ty, start, close))
}

struct Parser<'a> {
    data: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn blank(&mut self) {
        self.i = skip_blank(self.data, self.i);
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.blank();
        let c = *self.data.get(self.i)?;
        match c {
            b'$' => {
                self.i += 1;
                Some(Value::Null)
            }
            b'*' => {
                self.i += 1;
                Some(Value::Derived)
            }
            b'#' => {
                self.i += 1;
                let start = self.i;
                while self.i < self.data.len() && self.data[self.i].is_ascii_digit() {
                    self.i += 1;
                }
                let text = std::str::from_utf8(&self.data[start..self.i]).ok()?;
                text.parse().ok().map(Value::Ref)
            }
            b'\'' => {
                let end = skip_string(self.data, self.i);
                let raw = &self.data[self.i + 1..end.saturating_sub(1).max(self.i + 1)];
                self.i = end;
                Some(Value::Str(decode_string(raw)))
            }
            b'"' => {
                self.i += 1;
                while self.i < self.data.len() && self.data[self.i] != b'"' {
                    self.i += 1;
                }
                self.i += 1;
                Some(Value::Binary)
            }
            b'.' => {
                self.i += 1;
                let start = self.i;
                while self.i < self.data.len() && self.data[self.i] != b'.' {
                    self.i += 1;
                }
                let text = String::from_utf8_lossy(&self.data[start..self.i]).to_ascii_uppercase();
                self.i += 1;
                Some(Value::Enum(text))
            }
            b'(' => {
                self.i += 1;
                let mut items = Vec::new();
                loop {
                    self.blank();
                    match self.data.get(self.i) {
                        Some(b')') => {
                            self.i += 1;
                            return Some(Value::List(items));
                        }
                        Some(b',') => self.i += 1,
                        Some(_) => items.push(self.value(depth + 1)?),
                        None => return None,
                    }
                }
            }
            b'-' | b'+' | b'0'..=b'9' => {
                let start = self.i;
                self.i += 1;
                let mut real = false;
                while let Some(&d) = self.data.get(self.i) {
                    match d {
                        b'0'..=b'9' => {}
                        b'.' | b'E' | b'e' => real = true,
                        b'-' | b'+' if matches!(self.data[self.i - 1], b'E' | b'e') => {}
                        _ => break,
                    }
                    self.i += 1;
                }
                let text = std::str::from_utf8(&self.data[start..self.i]).ok()?;
                if real {
                    text.parse().ok().map(Value::Real)
                } else {
                    text.parse()
                        .ok()
                        .map(Value::Int)
                        .or_else(|| text.parse().ok().map(Value::Real))
                }
            }
            c if c.is_ascii_alphabetic() => {
                let start = self.i;
                while self.i < self.data.len()
                    && (self.data[self.i].is_ascii_alphanumeric() || self.data[self.i] == b'_')
                {
                    self.i += 1;
                }
                let name = String::from_utf8_lossy(&self.data[start..self.i]).to_ascii_uppercase();
                self.blank();
                if self.data.get(self.i) != Some(&b'(') {
                    return None;
                }
                self.i += 1;
                self.blank();
                let inner = if self.data.get(self.i) == Some(&b')') {
                    Value::Null
                } else {
                    self.value(depth + 1)?
                };
                self.blank();
                if self.data.get(self.i) != Some(&b')') {
                    return None;
                }
                self.i += 1;
                Some(Value::Typed(name, Box::new(inner)))
            }
            _ => None,
        }
    }
}

fn hex(bytes: &[u8]) -> Option<u32> {
    let text = std::str::from_utf8(bytes).ok()?;
    u32::from_str_radix(text, 16).ok()
}

/// Decodes a STEP string: `''` is a quote, `\\` a backslash, `\S\c` an ISO 8859 upper character,
/// `\X\hh` a Latin-1 byte, `\X2\…\X0\` UTF-16 and `\X4\…\X0\` UTF-32 code units; other bytes are
/// read as UTF-8 (many exporters write it directly).
pub fn decode_string(raw: &[u8]) -> String {
    let mut out: Vec<u8> = Vec::with_capacity(raw.len());
    let push = |out: &mut Vec<u8>, c: char| {
        let mut buf = [0; 4];
        out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
    };
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if b == b'\'' && raw.get(i + 1) == Some(&b'\'') {
            out.push(b'\'');
            i += 2;
        } else if b == b'\\' {
            let rest = &raw[i..];
            if rest.starts_with(b"\\\\") {
                out.push(b'\\');
                i += 2;
            } else if rest.starts_with(b"\\S\\") && rest.len() >= 4 {
                push(&mut out, char::from(rest[3].wrapping_add(128)));
                i += 4;
            } else if rest.starts_with(b"\\X\\") && rest.len() >= 5 {
                match hex(&rest[3..5]).and_then(char::from_u32) {
                    Some(c) => push(&mut out, c),
                    None => out.extend_from_slice(&rest[..5]),
                }
                i += 5;
            } else if rest.starts_with(b"\\X2\\") || rest.starts_with(b"\\X4\\") {
                let width = if rest[2] == b'2' { 4 } else { 8 };
                let body = &rest[4..];
                let end = body
                    .windows(4)
                    .position(|w| w == b"\\X0\\")
                    .unwrap_or(body.len());
                let units: Vec<u32> = body[..end]
                    .chunks(width)
                    .filter_map(|chunk| (chunk.len() == width).then(|| hex(chunk)).flatten())
                    .collect();
                if width == 4 {
                    let units: Vec<u16> = units
                        .iter()
                        .filter_map(|&u| u16::try_from(u).ok())
                        .collect();
                    for c in char::decode_utf16(units) {
                        push(&mut out, c.unwrap_or(char::REPLACEMENT_CHARACTER));
                    }
                } else {
                    for u in units {
                        push(
                            &mut out,
                            char::from_u32(u).unwrap_or(char::REPLACEMENT_CHARACTER),
                        );
                    }
                }
                i += 4 + (end + 4).min(body.len());
            } else if rest.starts_with(b"\\P") && rest.len() >= 4 && rest[3] == b'\\' {
                // Code page directive: ignored.
                i += 4;
            } else {
                out.push(b);
                i += 1;
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
/* a comment; with a semicolon */
#1= IFCCARTESIANPOINT((0.,1.5,-2.E-1));
#2=IFCWALL('2O2Fr$t4X7Zf8NOew3FLOH',$,'Wall; ''A''',$,$,#3,$,'T',.STANDARD.);
#3 = IFCLOCALPLACEMENT($,#4);
#4=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);
#5=IFCSPACE('x',$,'K\\X2\\00FC\\X0\\che',$,$,$,$,'\\X\\E9t\\S\\i',.ELEMENT.,.INTERNAL.,$);
#6=(IFCA() IFCB());
#7=IFCBROKEN(1,2
ENDSEC;
END-ISO-10303-21;
";

    #[test]
    fn indexes_and_parses_instances() {
        let file = StepFile::new(FILE.as_bytes().to_vec()).unwrap();
        assert_eq!(file.schema, "IFC4");
        assert_eq!(file.of_type("IFCWALL"), &[2]);
        let point = file.get(1).unwrap();
        assert_eq!(
            point
                .get(0)
                .list()
                .iter()
                .map(|v| v.number().unwrap())
                .collect::<Vec<_>>(),
            vec![0.0, 1.5, -0.2]
        );
        let wall = file.get(2).unwrap();
        assert_eq!(wall.text(2), Some("Wall; 'A'"));
        assert_eq!(wall.reference(5), Some(3));
        assert_eq!(wall.enumeration(8), Some("STANDARD"));
        assert_eq!(wall.get(1), &Value::Null);
        let property = file.get(4).unwrap();
        assert_eq!(property.get(2).enumeration(), Some("T"));
        let space = file.get(5).unwrap();
        assert_eq!(space.text(2), Some("Küche"));
        assert_eq!(space.text(7), Some("été"));
        assert!(file.get(6).is_none());
        assert_eq!(file.type_of(3), Some("IFCLOCALPLACEMENT"));
    }

    #[test]
    fn refuses_what_is_not_step() {
        assert_eq!(
            StepFile::new(b"{\"version\":1}".to_vec()).unwrap_err(),
            StepError::NotStep
        );
        assert_eq!(StepFile::new(Vec::new()).unwrap_err(), StepError::NotStep);
    }

    #[test]
    fn survives_garbage() {
        let mut data = b"ISO-10303-21;DATA;".to_vec();
        data.extend_from_slice(
            b"#1=X(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1);",
        );
        data.extend_from_slice(b"#2=Y('unterminated);#3=Z(#);#4=W(.E);#5=V(1.2.3);");
        let file = StepFile::new(data).unwrap();
        for id in 1..6 {
            let _ = file.get(id);
        }
        assert!(file.get(1).is_none());
    }
}
