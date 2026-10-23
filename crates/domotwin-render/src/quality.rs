//! Quality presets. The preset is picked from what the GPU reports and adjusted from the measured
//! frame time; the user can force one in the card or panel settings.

/// Rendering quality, from the lightest to the richest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum QualityPreset {
    /// Old tablets and software rendering: no post-processing, smaller shadow maps.
    Eco,
    /// Default on most phones and laptops.
    Balanced,
    /// Desktop GPUs: ambient occlusion, bloom, soft shadows.
    High,
}

impl QualityPreset {
    /// The preset's stable name, as used in the card configuration.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Eco => "eco",
            Self::Balanced => "balanced",
            Self::High => "high",
        }
    }

    /// Reads a name from the card configuration; unknown names give `None` (automatic).
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "eco" => Some(Self::Eco),
            "balanced" => Some(Self::Balanced),
            "high" => Some(Self::High),
            _ => None,
        }
    }

    /// The preset to start with, from what the GPU reports.
    pub fn from_hint(hint: &GpuHint) -> Self {
        let renderer = hint.renderer.to_ascii_lowercase();
        let software = [
            "swiftshader",
            "llvmpipe",
            "softpipe",
            "software",
            "basic render",
        ]
        .iter()
        .any(|name| renderer.contains(name));
        if software || hint.max_texture_size < 4096 {
            Self::Eco
        } else if hint.mobile {
            Self::Balanced
        } else {
            Self::High
        }
    }

    /// One step down, used when frames are too slow.
    pub const fn lower(self) -> Self {
        match self {
            Self::High => Self::Balanced,
            Self::Balanced | Self::Eco => Self::Eco,
        }
    }
}

/// What the browser tells about the GPU.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GpuHint {
    /// Unmasked renderer string when available, else the masked one.
    pub renderer: String,
    /// `MAX_TEXTURE_SIZE`.
    pub max_texture_size: u32,
    /// Whether the device looks like a phone or a tablet.
    pub mobile: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hint(renderer: &str, max_texture_size: u32, mobile: bool) -> GpuHint {
        GpuHint {
            renderer: renderer.into(),
            max_texture_size,
            mobile,
        }
    }

    #[test]
    fn software_rendering_is_eco() {
        let swiftshader = hint(
            "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
            8192,
            false,
        );
        assert_eq!(QualityPreset::from_hint(&swiftshader), QualityPreset::Eco);
        assert_eq!(
            QualityPreset::from_hint(&hint("llvmpipe", 16384, false)),
            QualityPreset::Eco
        );
    }

    #[test]
    fn small_textures_are_eco() {
        assert_eq!(
            QualityPreset::from_hint(&hint("Mali-T720", 2048, true)),
            QualityPreset::Eco
        );
    }

    #[test]
    fn phones_are_balanced_and_desktops_high() {
        assert_eq!(
            QualityPreset::from_hint(&hint("Adreno 650", 16384, true)),
            QualityPreset::Balanced
        );
        assert_eq!(
            QualityPreset::from_hint(&hint("NVIDIA GeForce", 32768, false)),
            QualityPreset::High
        );
    }

    #[test]
    fn names_round_trip() {
        for preset in [
            QualityPreset::Eco,
            QualityPreset::Balanced,
            QualityPreset::High,
        ] {
            assert_eq!(QualityPreset::from_name(preset.as_str()), Some(preset));
        }
        assert_eq!(QualityPreset::from_name("auto"), None);
        assert_eq!(
            QualityPreset::High.lower().lower().lower(),
            QualityPreset::Eco
        );
    }
}
