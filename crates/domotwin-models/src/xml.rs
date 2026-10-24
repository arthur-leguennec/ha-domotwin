//! A small, strict XML reader for 3MF parts: elements and attributes (namespace prefixes
//! dropped), with comments, processing instructions and text skipped. Document type declarations
//! are refused (no entity expansion), and tags must nest properly.

use std::borrow::Cow;

use crate::Error;

/// Deepest nesting read.
const MAX_DEPTH: usize = 64;

/// A start tag.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Tag<'a> {
    /// Local name (without its prefix).
    pub(crate) name: &'a str,
    attrs: Vec<(&'a str, Cow<'a, str>)>,
    /// `<name … />`: no content and no end tag.
    pub(crate) empty: bool,
}

impl Tag<'_> {
    /// An attribute by local name.
    pub(crate) fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.as_ref())
    }
}

/// What the reader meets.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Event<'a> {
    /// A start tag (or an empty element).
    Start(Tag<'a>),
    /// An end tag, by local name.
    End(&'a str),
}

/// Reads events one by one.
#[derive(Debug)]
pub(crate) struct Reader<'a> {
    text: &'a str,
    at: usize,
    open: Vec<&'a str>,
    closed_root: bool,
}

fn local(name: &str) -> &str {
    name.rsplit_once(':').map_or(name, |(_, n)| n)
}

fn unescape(value: &str) -> Result<Cow<'_, str>, Error> {
    if !value.contains('&') {
        return Ok(Cow::Borrowed(value));
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let end = rest[i..].find(';').ok_or(Error::NotModel)? + i;
        let entity = &rest[i + 1..end];
        let c = match entity {
            "lt" => '<',
            "gt" => '>',
            "amp" => '&',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let code = if let Some(hex) = entity.strip_prefix("#x") {
                    u32::from_str_radix(hex, 16).ok()
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse().ok()
                } else {
                    None
                };
                code.and_then(char::from_u32).ok_or(Error::NotModel)?
            }
        };
        out.push(c);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(Cow::Owned(out))
}

impl<'a> Reader<'a> {
    /// A reader over UTF-8 bytes (a byte order mark is skipped).
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self, Error> {
        let text = std::str::from_utf8(bytes).map_err(|_| Error::NotModel)?;
        Ok(Self {
            text: text.strip_prefix('\u{feff}').unwrap_or(text),
            at: 0,
            open: Vec::new(),
            closed_root: false,
        })
    }

    fn skip_to(&mut self, end: &str) -> Result<(), Error> {
        let found = self.text[self.at..].find(end).ok_or(Error::NotModel)?;
        self.at += found + end.len();
        Ok(())
    }

    /// The next event; `None` at the end of a well-formed document.
    pub(crate) fn next(&mut self) -> Result<Option<Event<'a>>, Error> {
        loop {
            let Some(found) = self.text[self.at..].find('<') else {
                if self.open.is_empty() && self.closed_root {
                    return Ok(None);
                }
                return Err(Error::NotModel);
            };
            self.at += found;
            let rest = &self.text[self.at..];
            if rest.starts_with("<?") {
                self.skip_to("?>")?;
            } else if rest.starts_with("<!--") {
                self.skip_to("-->")?;
            } else if rest.starts_with("<![CDATA[") {
                if self.open.is_empty() {
                    return Err(Error::NotModel);
                }
                self.skip_to("]]>")?;
            } else if rest.starts_with("<!") {
                // DOCTYPE and other declarations: refused.
                return Err(Error::NotModel);
            } else if let Some(after) = rest.strip_prefix("</") {
                let close = after.find('>').ok_or(Error::NotModel)?;
                let name = after[..close].trim_end();
                if self.open.pop() != Some(name) {
                    return Err(Error::NotModel);
                }
                self.at += 2 + close + 1;
                if self.open.is_empty() {
                    self.closed_root = true;
                }
                return Ok(Some(Event::End(local(name))));
            } else {
                return self.start().map(|tag| Some(Event::Start(tag)));
            }
        }
    }

    fn start(&mut self) -> Result<Tag<'a>, Error> {
        if self.closed_root {
            return Err(Error::NotModel);
        }
        let text = self.text;
        let mut at = self.at + 1;
        let name_end = text[at..]
            .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
            .ok_or(Error::NotModel)?
            + at;
        let name = &text[at..name_end];
        if name.is_empty() {
            return Err(Error::NotModel);
        }
        at = name_end;
        let mut attrs: Vec<(&'a str, Cow<'a, str>)> = Vec::new();
        let empty = loop {
            at += text[at..].len() - text[at..].trim_start().len();
            let rest = &text[at..];
            if rest.starts_with("/>") {
                at += 2;
                break true;
            }
            if rest.starts_with('>') {
                at += 1;
                break false;
            }
            let eq = rest.find('=').ok_or(Error::NotModel)?;
            let attr = rest[..eq].trim();
            if attr.is_empty() || attr.contains(|c: char| c.is_whitespace() || c == '<' || c == '>')
            {
                return Err(Error::NotModel);
            }
            let after = rest[eq + 1..].trim_start();
            at = text.len() - after.len();
            let quote = after.chars().next().filter(|q| *q == '"' || *q == '\'');
            let quote = quote.ok_or(Error::NotModel)?;
            let close = after[1..].find(quote).ok_or(Error::NotModel)?;
            let raw = &after[1..=close];
            if raw.contains('<') {
                return Err(Error::NotModel);
            }
            let key = local(attr);
            if attrs.iter().any(|(k, _)| *k == key) && !attr.starts_with("xmlns") {
                return Err(Error::NotModel);
            }
            attrs.push((key, unescape(raw)?));
            at += close + 2;
        };
        self.at = at;
        if empty {
            if self.open.is_empty() {
                self.closed_root = true;
            }
        } else {
            if self.open.len() >= MAX_DEPTH {
                return Err(Error::NotModel);
            }
            self.open.push(name);
        }
        Ok(Tag {
            name: local(name),
            attrs,
            empty,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(text: &str) -> Result<Vec<String>, Error> {
        let mut reader = Reader::new(text.as_bytes())?;
        let mut out = Vec::new();
        while let Some(event) = reader.next()? {
            out.push(match event {
                Event::Start(tag) => {
                    let attrs: Vec<String> =
                        tag.attrs.iter().map(|(k, v)| format!("{k}={v}")).collect();
                    format!(
                        "<{}{}{}>",
                        tag.name,
                        if attrs.is_empty() {
                            String::new()
                        } else {
                            format!(" {}", attrs.join(" "))
                        },
                        if tag.empty { "/" } else { "" }
                    )
                }
                Event::End(name) => format!("</{name}>"),
            });
        }
        Ok(out)
    }

    #[test]
    fn reads_elements_and_attributes() {
        let doc = "\u{feff}<?xml version=\"1.0\"?>\n<!-- hi -->\n<m:model unit='millimeter' xmlns:m=\"x\">\
            <vertex x=\"1.5\" y = \"&lt;2&#x41;&#66;\"/>text<![CDATA[<raw>]]></m:model >";
        assert_eq!(
            events(doc).unwrap(),
            [
                "<model unit=millimeter m=x>",
                "<vertex x=1.5 y=<2AB/>",
                "</model>"
            ]
        );
    }

    #[test]
    fn refuses_malformed_documents() {
        for bad in [
            "<a><b></a></b>",
            "<a>",
            "<a></a><b/>",
            "<!DOCTYPE a [<!ENTITY x \"y\">]><a/>",
            "<a x=\"1\" x=\"2\"/>",
            "<a x=1/>",
            "<a x=\"&unknown;\"/>",
            "<a x=\"<\"/>",
            "",
            "<>",
        ] {
            assert_eq!(events(bad).err(), Some(Error::NotModel), "{bad}");
        }
        let deep = "<a>".repeat(MAX_DEPTH + 1);
        assert_eq!(events(&deep).err(), Some(Error::NotModel));
    }
}
