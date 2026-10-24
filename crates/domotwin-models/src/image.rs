//! The size of a PNG or JPEG picture from its header, to refuse huge pictures before the browser
//! decodes them.

/// The media type and size `(width, height)` of a PNG or JPEG picture. `None` for any other
/// format or a header that cannot be read.
pub(crate) fn probe(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        // The first chunk is IHDR: width and height, big endian.
        if bytes.get(12..16)? != b"IHDR" {
            return None;
        }
        let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
        let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
        return Some(("image/png", width, height));
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        let (width, height) = jpeg_size(bytes)?;
        return Some(("image/jpeg", width, height));
    }
    None
}

/// Walks the JPEG markers up to the first frame header (SOFn).
fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    loop {
        // Markers start with 0xff, possibly repeated as fill.
        while *bytes.get(at)? == 0xff && *bytes.get(at + 1)? == 0xff {
            at += 1;
        }
        if *bytes.get(at)? != 0xff {
            return None;
        }
        let marker = *bytes.get(at + 1)?;
        at += 2;
        match marker {
            // Markers without a length.
            0x01 | 0xd0..=0xd7 => continue,
            // End of image or start of scan before any frame header.
            0xd9 | 0xda => return None,
            _ => {}
        }
        let length = usize::from(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]));
        if length < 2 {
            return None;
        }
        let frame = matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf);
        if frame {
            let height = u16::from_be_bytes([*bytes.get(at + 3)?, *bytes.get(at + 4)?]);
            let width = u16::from_be_bytes([*bytes.get(at + 5)?, *bytes.get(at + 6)?]);
            return Some((u32::from(width), u32::from(height)));
        }
        at += length;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&640_u32.to_be_bytes());
        png.extend_from_slice(&480_u32.to_be_bytes());
        assert_eq!(probe(&png), Some(("image/png", 640, 480)));
        assert_eq!(probe(&png[..20]), None);
        // SOI, an APP0 segment, fill bytes, then SOF0 with height 300 and width 500.
        let jpeg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xff, 0xc0, 0x00, 0x0b, 0x08,
            0x01, 0x2c, 0x01, 0xf4, 0x03,
        ];
        assert_eq!(probe(&jpeg), Some(("image/jpeg", 500, 300)));
        assert_eq!(probe(&[0xff, 0xd8, 0xff, 0xda]), None);
        assert_eq!(probe(&[0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]), None);
        assert_eq!(probe(b"GIF89a"), None);
    }
}
