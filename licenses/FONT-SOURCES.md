# Bundled Android fonts

Unmodified upstream TTF files, included for offline use on API 26+.
Adjacent SIL OFL licenses are also included in the APK.

## Archivo

- Source: https://github.com/Omnibus-Type/Archivo
- Commit: `211127690e8ff106c36c935f7e5e697114cff103`
- File: `fonts/variable/Archivo[wdth,wght].ttf`
- Bundled: `res/font/archivo_variable.ttf`
- SHA-256: `664bbeb10522dac35c174a3860aaecad7b1ad3a0fc8b0d26888e26c824ec556d`
- License: `archivo-OFL.txt`
- Copyright: 2020 The Archivo Project Authors. No Reserved Font Name declared.

## IBM Plex Sans KR

- Source: https://github.com/IBM/plex
- Commit: `bf260093582f04622aacc1e9f9ca604d7ccd0c42`
- License: `ibm-plex-OFL.txt` (upstream `packages/plex-sans-kr/fonts/complete/ttf/hinted/license.txt`)
- Copyright: 2017 IBM Corp. Reserved Font Name: "Plex".
- Only weights used by the UI (400/500/600/700) are bundled, without modification or subsetting.

| Upstream file | Bundled file | SHA-256 |
|---|---|---|
| `packages/plex-sans-kr/fonts/complete/ttf/hinted/IBMPlexSansKR-Regular.ttf` | `res/font/ibm_plex_sans_kr_regular.ttf` | `193af4c0c4f979251edd13708ea4c3eb4d0d07f9352b3d2a58b43b042767183b` |
| `packages/plex-sans-kr/fonts/complete/ttf/hinted/IBMPlexSansKR-Medium.ttf` | `res/font/ibm_plex_sans_kr_medium.ttf` | `b3f1a81ce1738e414e04d6f6d946581319e5d15ceecc8e42f91913a6f39a6712` |
| `packages/plex-sans-kr/fonts/complete/ttf/hinted/IBMPlexSansKR-SemiBold.ttf` | `res/font/ibm_plex_sans_kr_semibold.ttf` | `c1640995dae522401987918ac5caf90c2d7ecc90552216b653c97754fa941eb3` |
| `packages/plex-sans-kr/fonts/complete/ttf/hinted/IBMPlexSansKR-Bold.ttf` | `res/font/ibm_plex_sans_kr_bold.ttf` | `2aa49909a6dae0591efa1cc892bf99a2556b3b56fbcb639439240010518548ae` |

## JetBrains Mono

- Source: https://github.com/JetBrains/JetBrainsMono
- Commit: `19371302b95d218af43299bce79ddbddd0bc364d`
- File: `fonts/variable/JetBrainsMono[wght].ttf`
- Bundled: `res/font/jetbrains_mono_variable.ttf`
- SHA-256: `3cfafa86e28b87184d592fef82846e8c10cb48653c62efcda34f082da225ec34`
- License: `jetbrains-mono-OFL.txt`
- Copyright: 2020 The JetBrains Mono Project Authors. No Reserved Font Name declared.

## Korean fallback

Compose resource font-family lists select weights; they do not provide a CSS-style glyph fallback chain.
`paceText` explicitly applies IBM Plex Sans KR to Korean and Archivo (or JetBrains Mono) to Latin runs,
preserving the original accessibility text on API 26 and later. Numeric values and their smaller Korean
units can also be rendered as separate Text nodes. The app never relies on an OEM Korean font for these runs.
