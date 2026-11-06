# SYNTHNET Desktop release repository and website

## Implementation approach

Preserve the existing Electron/Node application behavior. Add repository hygiene, release automation, changelog-driven release helpers, GitHub Actions, and a dependency-free Vercel website that reads public release metadata through serverless APIs. Keep all runtime data, secrets, and customer-like fixtures out of the repository.

## Project structure

- Existing app folders remain unchanged except for sanitized defaults and package metadata.
- `scripts/` contains cross-platform release and changelog helpers.
- `.github/workflows/` contains CI and tag-triggered Windows release workflows.
- `docs/` contains the app guide and non-developer release instructions.
- `website/src/` contains static site source; `website/api/` contains Vercel API routes; `website/build.js` creates `public/`; `website/test/` exercises APIs and builds.
- `deliverables/` contains milestone checkpoints and the final sanitized zip.

## Design

### Alternatives
- **Aurora control room** — 0.55
- **Midnight editorial** — 0.25
- **Neon storefront** — 0.20

### Chosen direction: Aurora control room
Dark, premium glass UI with a restrained cyan/emerald/violet aurora and a product-led editorial rhythm.

- **Core principles:** operational clarity, polished restraint, progressive disclosure, trustworthy local-first messaging.
- **Color philosophy:** near-black gives the product authority; cyan marks action and connectivity; emerald signals successful payments; violet is reserved for secondary emphasis.
- **Layout paradigm:** asymmetric hero compositions, bento feature cards, and a timeline that lets release history breathe rather than forcing every section into identical cards.
- **Signature elements:** gradient S mark, masked grid, luminous glass chips.
- **Interaction philosophy:** every motion clarifies state; hover and focus states are visible, never decorative-only.
- **Animation:** short, cancellable transitions; autoplay pauses on hover; all motion yields to `prefers-reduced-motion`.
- **Typography:** system sans stack with large tight headlines, readable 16–18px body copy, and compact mono metadata.
- **Brand essence:** a dependable local control layer for turning a Windows PC into a paid Wi-Fi hotspot. Clear, capable, grounded.
- **Brand voice:** direct and practical: “Turn any Windows PC into a paid Wi-Fi hotspot.” “Your customers get online in seconds. You stay in control.”
- **Wordmark:** rounded gradient square containing a bold S beside SYNTHNET Desktop.
- **Signature brand color:** electric cyan `#22d3ee`.
