//! Base64 (RFC 4648, standard alphabet) for `data:` URLs.

/// The value of a base64 digit.
fn digit(c: u8) -> Option<u32> {
    match c {
        b'A'..=b'Z' => Some(u32::from(c - b'A')),
        b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes base64 text (padding optional). `None` when it is not base64.
pub(crate) fn decode(text: &[u8]) -> Option<Vec<u8>> {
    let body = text
        .strip_suffix(b"==")
        .or_else(|| text.strip_suffix(b"="))
        .unwrap_or(text);
    if body.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(body.len() / 4 * 3 + 2);
    for chunk in body.chunks(4) {
        let mut n = 0_u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= digit(*c)? << (18 - 6 * i);
        }
        let [_, a, b, c] = n.to_be_bytes();
        out.push(a);
        if chunk.len() > 2 {
            out.push(b);
        }
        if chunk.len() > 3 {
            out.push(c);
        }
    }
    Some(out)
}

/// The bytes of a `data:` URL whose content is base64 (`data:<type>;base64,…`), and its media
/// type. `None` for anything else.
pub(crate) fn data_url(url: &str) -> Option<(&str, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (header, body) = rest.split_once(',')?;
    let media = header.strip_suffix(";base64")?;
    Some((media, decode(body.as_bytes())?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes() {
        assert_eq!(decode(b"").unwrap(), b"");
        assert_eq!(decode(b"Zg==").unwrap(), b"f");
        assert_eq!(decode(b"Zm8=").unwrap(), b"fo");
        assert_eq!(decode(b"Zm9v").unwrap(), b"foo");
        assert_eq!(decode(b"Zm9vYg").unwrap(), b"foob");
        assert_eq!(decode(b"+/+/").unwrap(), [0xfb, 0xff, 0xbf]);
        assert!(decode(b"Zm9v!").is_none());
        assert!(decode(b"Z").is_none());
        assert!(decode(b"Zm9v\n").is_none());
        let (media, bytes) = data_url("data:application/octet-stream;base64,AAEC").unwrap();
        assert_eq!(
            (media, bytes.as_slice()),
            ("application/octet-stream", &[0, 1, 2][..])
        );
        assert!(data_url("data:text/plain,abc").is_none());
        assert!(data_url("buffer.bin").is_none());
    }
}
