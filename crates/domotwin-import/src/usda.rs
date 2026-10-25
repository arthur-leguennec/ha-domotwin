//! A small reader of USD's text layers (`.usda`): prims, their metadata and their properties, as
//! RoomPlan writes them. No composition: the layers a prim references are read by the caller.

use std::collections::BTreeMap;

/// Deepest nesting read (prims, values).
const MAX_DEPTH: usize = 64;
/// Most tokens read from one layer.
const MAX_TOKENS: usize = 4_000_000;

/// A value of a property or of metadata.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Value {
    Number(f64),
    Text(String),
    /// A word: a token, a name, `true`, `None`…
    Word(String),
    /// `@path@`.
    Asset(String),
    /// `</path>`.
    Path(String),
    /// `( … )`.
    Tuple(Vec<Value>),
    /// `[ … ]`.
    List(Vec<Value>),
    /// `{ type name = value … }`, by name.
    Dict(BTreeMap<String, Value>),
}

impl Value {
    pub(crate) fn number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub(crate) fn text(&self) -> Option<&str> {
        match self {
            Value::Text(s) | Value::Word(s) => Some(s),
            _ => None,
        }
    }

    /// The numbers of a tuple, flattened (`((1, 0), (0, 1))` → `[1, 0, 0, 1]`).
    pub(crate) fn numbers(&self) -> Vec<f64> {
        match self {
            Value::Number(n) => vec![*n],
            Value::Tuple(items) | Value::List(items) => {
                items.iter().flat_map(Value::numbers).collect()
            }
            _ => Vec::new(),
        }
    }

    /// The assets a value names: one, or a list.
    pub(crate) fn assets(&self) -> Vec<&str> {
        match self {
            Value::Asset(a) => vec![a.as_str()],
            Value::List(items) => items.iter().flat_map(Value::assets).collect(),
            _ => Vec::new(),
        }
    }
}

/// A prim.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Prim {
    /// Its schema (`Xform`, `Cube`, `Mesh`…), empty when untyped.
    pub(crate) kind: String,
    pub(crate) name: String,
    /// Its metadata (`customData`, `references`, `kind`…), by name (list-op prefixes dropped).
    pub(crate) meta: BTreeMap<String, Value>,
    /// Its properties, by name.
    pub(crate) props: BTreeMap<String, Value>,
    pub(crate) children: Vec<Prim>,
}

impl Prim {
    /// The first prim, this one or below it, `test` accepts.
    pub(crate) fn find(&self, test: &dyn Fn(&Prim) -> bool) -> Option<&Prim> {
        if test(self) {
            return Some(self);
        }
        self.children.iter().find_map(|c| c.find(test))
    }
}

/// A layer: its metadata and its root prims.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Layer {
    pub(crate) meta: BTreeMap<String, Value>,
    pub(crate) prims: Vec<Prim>,
}

impl Layer {
    /// The default prim, else the first.
    pub(crate) fn default_prim(&self) -> Option<&Prim> {
        let name = self.meta.get("defaultPrim").and_then(Value::text);
        name.and_then(|n| self.prims.iter().find(|p| p.name == n))
            .or_else(|| self.prims.first())
    }

    /// Metres per unit (1 when the layer does not say).
    pub(crate) fn metres(&self) -> f64 {
        self.meta
            .get("metersPerUnit")
            .and_then(Value::number)
            .filter(|m| m.is_finite() && *m > 0.0)
            .unwrap_or(1.0)
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Punct(char),
    Text(String),
    Word(String),
    Asset(String),
    Path(String),
    Line,
}

fn tokens(text: &str) -> Result<Vec<Token>, &'static str> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    let bytes = text.as_bytes();
    while let Some((at, c)) = chars.next() {
        if out.len() > MAX_TOKENS {
            return Err("too_large");
        }
        match c {
            '\n' => out.push(Token::Line),
            c if c.is_whitespace() => {}
            '#' => {
                while chars.peek().is_some_and(|&(_, c)| c != '\n') {
                    chars.next();
                }
            }
            '(' | ')' | '[' | ']' | '{' | '}' | '=' | ',' | ';' => out.push(Token::Punct(c)),
            '"' | '\'' => {
                // Triple quotes too.
                let triple = bytes.get(at + 1..at + 3) == Some(&[c as u8, c as u8][..]);
                if triple {
                    chars.next();
                    chars.next();
                }
                let mut s = String::new();
                loop {
                    let Some((i, d)) = chars.next() else {
                        return Err("not_plan");
                    };
                    if d == '\\' {
                        if let Some((_, e)) = chars.next() {
                            s.push(match e {
                                'n' => '\n',
                                't' => '\t',
                                e => e,
                            });
                        }
                    } else if d == c
                        && (!triple || bytes.get(i + 1..i + 3) == Some(&[c as u8, c as u8][..]))
                    {
                        if triple {
                            chars.next();
                            chars.next();
                        }
                        break;
                    } else {
                        s.push(d);
                    }
                }
                out.push(Token::Text(s));
            }
            '@' => {
                let mut s = String::new();
                loop {
                    match chars.next() {
                        Some((_, '@')) => break,
                        Some((_, d)) => s.push(d),
                        None => return Err("not_plan"),
                    }
                }
                out.push(Token::Asset(s));
            }
            '<' => {
                let mut s = String::new();
                loop {
                    match chars.next() {
                        Some((_, '>')) => break,
                        Some((_, d)) => s.push(d),
                        None => return Err("not_plan"),
                    }
                }
                out.push(Token::Path(s));
            }
            _ => {
                let mut s = String::from(c);
                while let Some(&(_, d)) = chars.peek() {
                    if d.is_whitespace() || "()[]{}=,;\"'@<#".contains(d) {
                        break;
                    }
                    s.push(d);
                    chars.next();
                }
                out.push(Token::Word(s));
            }
        }
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    /// The next token that is not a line end.
    fn peek_solid(&mut self) -> Option<&Token> {
        while self.peek() == Some(&Token::Line) {
            self.at += 1;
        }
        self.peek()
    }

    fn next_solid(&mut self) -> Option<Token> {
        self.peek_solid()?;
        let t = self.tokens.get(self.at).cloned();
        self.at += 1;
        t
    }

    fn expect(&mut self, c: char) -> Result<(), &'static str> {
        match self.next_solid() {
            Some(Token::Punct(p)) if p == c => Ok(()),
            _ => Err("not_plan"),
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, &'static str> {
        if depth > MAX_DEPTH {
            return Err("not_plan");
        }
        match self.next_solid().ok_or("not_plan")? {
            Token::Text(s) => Ok(Value::Text(s)),
            Token::Asset(s) => Ok(Value::Asset(s)),
            Token::Path(s) => Ok(Value::Path(s)),
            Token::Word(w) => Ok(w
                .parse::<f64>()
                .ok()
                .filter(|n| n.is_finite())
                .map_or(Value::Word(w), Value::Number)),
            Token::Punct('(') => Ok(Value::Tuple(self.items(')', depth)?)),
            Token::Punct('[') => Ok(Value::List(self.items(']', depth)?)),
            Token::Punct('{') => Ok(Value::Dict(self.dict(depth)?)),
            _ => Err("not_plan"),
        }
    }

    /// Values separated by commas up to `end`.
    fn items(&mut self, end: char, depth: usize) -> Result<Vec<Value>, &'static str> {
        let mut out = Vec::new();
        loop {
            match self.peek_solid() {
                Some(Token::Punct(c)) if *c == end => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(Token::Punct(',')) => self.at += 1,
                None => return Err("not_plan"),
                _ => out.push(self.value(depth + 1)?),
            }
        }
    }

    /// `{ [type] name = value … }` (the `{` read).
    fn dict(&mut self, depth: usize) -> Result<BTreeMap<String, Value>, &'static str> {
        let mut out = BTreeMap::new();
        loop {
            let mut words = Vec::new();
            let mut sample = false;
            loop {
                match self.next_solid().ok_or("not_plan")? {
                    Token::Punct('}') if words.is_empty() => return Ok(out),
                    Token::Punct('=') => break,
                    // A time sample (`0: (1, 2, 3)`): its value is read, not kept.
                    Token::Word(w) if words.is_empty() && w.ends_with(':') => {
                        sample = true;
                        break;
                    }
                    Token::Word(w) | Token::Text(w) => words.push(w),
                    Token::Punct(';' | ',') => {}
                    _ => return Err("not_plan"),
                }
            }
            let value = self.value(depth + 1)?;
            if let Some(name) = words.pop().filter(|_| !sample) {
                out.insert(name, value);
            }
        }
    }

    /// `( key = value … )` metadata (the `(` read): list-op prefixes dropped; a lone string is
    /// the documentation.
    fn meta(&mut self, depth: usize) -> Result<BTreeMap<String, Value>, &'static str> {
        let mut out = BTreeMap::new();
        loop {
            let mut words = Vec::new();
            loop {
                match self.next_solid().ok_or("not_plan")? {
                    Token::Punct(')') => {
                        return Ok(out);
                    }
                    Token::Punct('=') => break,
                    Token::Word(w) => words.push(w),
                    Token::Text(doc) if words.is_empty() => {
                        out.insert("doc".to_owned(), Value::Text(doc));
                    }
                    Token::Punct(';') => {}
                    _ => return Err("not_plan"),
                }
            }
            let value = self.value(depth + 1)?;
            if let Some(name) = words.pop() {
                out.insert(name, value);
            }
        }
    }

    /// A prim, `def`/`over`/`class` read.
    fn prim(&mut self, depth: usize) -> Result<Prim, &'static str> {
        if depth > MAX_DEPTH {
            return Err("not_plan");
        }
        let mut prim = Prim::default();
        match self.next_solid().ok_or("not_plan")? {
            Token::Word(kind) => {
                prim.kind = kind;
                match self.next_solid() {
                    Some(Token::Text(name)) => prim.name = name,
                    _ => return Err("not_plan"),
                }
            }
            Token::Text(name) => prim.name = name,
            _ => return Err("not_plan"),
        }
        if self.peek_solid() == Some(&Token::Punct('(')) {
            self.at += 1;
            prim.meta = self.meta(depth)?;
        }
        self.expect('{')?;
        self.body(&mut prim, depth)?;
        Ok(prim)
    }

    /// A prim's children and properties, up to its `}`.
    fn body(&mut self, prim: &mut Prim, depth: usize) -> Result<(), &'static str> {
        loop {
            match self.peek_solid() {
                Some(Token::Punct('}')) => {
                    self.at += 1;
                    return Ok(());
                }
                None => return Err("not_plan"),
                Some(Token::Word(w)) if w == "def" || w == "over" || w == "class" => {
                    self.at += 1;
                    let child = self.prim(depth + 1)?;
                    prim.children.push(child);
                }
                Some(Token::Word(w)) if w == "variantSet" || w == "variantSets" => {
                    // Not read: skipped with what it holds.
                    self.skip_statement(depth)?;
                }
                _ => self.property(prim, depth)?,
            }
        }
    }

    /// A property: words up to its name, then `= value`, metadata `( … )`, or nothing.
    fn property(&mut self, prim: &mut Prim, depth: usize) -> Result<(), &'static str> {
        let mut words: Vec<String> = Vec::new();
        loop {
            match self.peek() {
                Some(Token::Word(w)) => {
                    words.push(w.clone());
                    self.at += 1;
                }
                Some(Token::Punct('['))
                    if self.tokens.get(self.at + 1) == Some(&Token::Punct(']')) =>
                {
                    self.at += 2;
                }
                Some(Token::Punct('=')) => {
                    self.at += 1;
                    let value = self.value(depth + 1)?;
                    if let Some(name) = words.pop() {
                        prim.props.insert(name, value);
                    }
                    words.clear();
                }
                Some(Token::Punct('(')) => {
                    self.at += 1;
                    self.meta(depth + 1)?;
                }
                Some(Token::Line | Token::Punct(';')) => {
                    self.at += 1;
                    return Ok(());
                }
                Some(Token::Punct('}')) => return Ok(()),
                // A `{` after a property name: a time-sampled value or a dictionary, skipped.
                Some(Token::Punct('{')) => {
                    self.at += 1;
                    self.dict(depth + 1)?;
                }
                _ => return Err("not_plan"),
            }
        }
    }

    /// Skips a statement and the block it opens.
    fn skip_statement(&mut self, depth: usize) -> Result<(), &'static str> {
        let mut level = 0_usize;
        loop {
            match self.next_solid().ok_or("not_plan")? {
                Token::Punct('{') => level += 1,
                Token::Punct('}') => {
                    level = level.checked_sub(1).ok_or("not_plan")?;
                    if level == 0 {
                        return Ok(());
                    }
                }
                _ => {}
            }
            if level > MAX_DEPTH || depth > MAX_DEPTH {
                return Err("not_plan");
            }
        }
    }
}

/// Reads a text layer.
///
/// # Errors
///
/// `not_plan` for text that is not a USD text layer, `too_large` past 4 million tokens.
pub(crate) fn read(bytes: &[u8]) -> Result<Layer, &'static str> {
    let text = std::str::from_utf8(bytes).map_err(|_| "not_plan")?;
    if !text.trim_start().starts_with("#usda") {
        return Err("not_plan");
    }
    let mut parser = Parser {
        tokens: tokens(text)?,
        at: 0,
    };
    let mut layer = Layer::default();
    if parser.peek_solid() == Some(&Token::Punct('(')) {
        parser.at += 1;
        layer.meta = parser.meta(0)?;
    }
    while let Some(token) = parser.next_solid() {
        match token {
            Token::Word(w) if w == "def" || w == "over" || w == "class" => {
                layer.prims.push(parser.prim(1)?);
            }
            _ => return Err("not_plan"),
        }
    }
    Ok(layer)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = r#"#usda 1.0
(
    defaultPrim = "Room"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "Room" ( kind = "assembly" )
{
    def Xform "Parametric_grp" ( kind = "group" )
    {
        def Xform "Arch_grp" ( kind = "group" )
        {
            def Xform "Wall_0_grp" (
                kind = "group"
                prepend references = [
                    @./assets/Parametric/Walls/Wall0/Wall0.usda@,
                    @./assets/Parametric/Walls/Wall0/Door0.usda@
                ]
            )
            {
            }
        }
        def Xform "Object_grp" ( kind = "group" )
        {
            def Xform "Sofa_grp" ( kind = "group"  prepend references = @./assets/Parametric/Sofa/Sofa0.usda@ ) { }
        }
    }
}
"#;

    const DOOR: &str = r#"#usda 1.0
(
    defaultPrim = "Door0"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "Door0" (
    assetInfo = {
        asset identifier = @./Door0.usda@
        string name = "Door0"
    }
    customData = {
        string Category = "Door(Isopen: False)"
        string UUID = "0074320F-7D37-4F56-8A89-CF563B15712F"
    }
    kind = "component"
)
{
    def Cube "Door0"
    {
        rel material:binding = </Door0/Door0_color>
        double size = 1
        double3 xformOp:scale = (0.98, 2.24, 0.0005)
        matrix4d xformOp:transform = ( (-0.97, 0, 0.21, 0), (0, 1, 0, 0), (-0.21, 0, -0.97, 0), (9.03, -0.31, 3.46, 1) )
        uniform token[] xformOpOrder = ["xformOp:transform", "xformOp:scale"]
    }
    def Material "Door0_color"
    {
        token outputs:surface.connect = </Door0/Door0_color/surfaceShader.outputs:surface>
        def Shader "surfaceShader"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.33, 0.33, 0.33)
        }
    }
}
"#;

    #[test]
    fn time_samples_are_read_past() {
        let layer = read(
            b"#usda 1.0\n(\n    defaultPrim = \"Wall0\"\n)\n\ndef Xform \"Wall0\"\n{\n    \
              double3 xformOp:translate.timeSamples = {\n        0: (1, 2, 3),\n        \
              10: (4, 5, 6),\n    }\n    float3 xformOp:scale = (2, 3, 0)\n}\n",
        )
        .unwrap();
        let wall = layer.default_prim().unwrap();
        assert_eq!(wall.props["xformOp:scale"].numbers(), [2.0, 3.0, 0.0]);
    }

    #[test]
    fn layers_prims_metadata_and_properties() {
        let root = read(ROOT.as_bytes()).unwrap();
        assert_eq!(root.default_prim().unwrap().name, "Room");
        assert_eq!(root.metres(), 1.0);
        let wall = root
            .default_prim()
            .unwrap()
            .find(&|p| p.name == "Wall_0_grp")
            .unwrap();
        assert_eq!(
            wall.meta["references"].assets(),
            [
                "./assets/Parametric/Walls/Wall0/Wall0.usda",
                "./assets/Parametric/Walls/Wall0/Door0.usda"
            ]
        );
        let sofa = root.prims[0].find(&|p| p.name == "Sofa_grp").unwrap();
        assert_eq!(
            sofa.meta["references"].assets(),
            ["./assets/Parametric/Sofa/Sofa0.usda"]
        );

        let door = read(DOOR.as_bytes()).unwrap();
        let top = door.default_prim().unwrap();
        let Value::Dict(custom) = &top.meta["customData"] else {
            panic!()
        };
        assert_eq!(custom["Category"].text(), Some("Door(Isopen: False)"));
        let cube = top.find(&|p| p.kind == "Cube").unwrap();
        assert_eq!(cube.props["xformOp:scale"].numbers(), [0.98, 2.24, 0.0005]);
        assert_eq!(cube.props["xformOp:transform"].numbers().len(), 16);
        assert_eq!(
            cube.props["material:binding"],
            Value::Path("/Door0/Door0_color".into())
        );
    }

    #[test]
    fn what_is_not_a_layer_is_refused() {
        assert_eq!(read(b"hello"), Err("not_plan"));
        assert_eq!(read(b"#usda 1.0\ndef Xform \"A\" {"), Err("not_plan"));
        assert_eq!(
            read(b"#usda 1.0\ndef Xform \"A\" ( kind = ) {}"),
            Err("not_plan")
        );
        assert!(read(b"#usda 1.0\n").unwrap().prims.is_empty());
        let deep = format!(
            "#usda 1.0\n{}{}",
            "def \"a\" {\n".repeat(80),
            "}\n".repeat(80)
        );
        assert_eq!(read(deep.as_bytes()), Err("not_plan"));
    }
}
