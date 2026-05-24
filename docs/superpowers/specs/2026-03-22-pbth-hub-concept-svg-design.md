---
title: PBTH Hub Concept SVG Design
date: 2026-03-22
status: approved
source: user-provided HTML snippet
---

# PBTH Hub Concept SVG Design

## Goal
Reproduce the `The Hub Concept` logo/icon from the PBTH brand page as a standalone SVG master asset.

## Source Of Truth
The design is reconstructed from the HTML snippet exported from the browser devtools:
- outer container: `128x128`
- rounded corners: `32px`
- gradient: `from-pb-primary` to `blue-500`
- centered white outline hexagon SVG
- soft translucent white glow element

## Output
- Primary artifact: `/Users/pk/Documents/CalDEV/.codex_artifacts/pbth-hub-concept.svg`

## Chosen Approach
Use a literal vector reconstruction of the HTML structure rather than screenshot tracing.

This keeps the asset:
- clean and editable;
- export-friendly for later PNG icon generation;
- visually faithful to the brand page implementation.

## Geometry
- Artboard: `160x160` to preserve soft shadow without clipping
- Main rounded square: `128x128` positioned at `(16,16)`
- Corner radius: `32`
- Hexagon icon: centered, scaled from the exact path found in the HTML snippet

## Color Tokens
- PBTH primary green: `#00E676`
- Tailwind blue-500: `#3B82F6`
- Hexagon stroke: `#FFFFFF`
- Glow: `rgba(255,255,255,0.2)`

## Filters
- soft green drop shadow under the rounded square
- blurred white glow disk behind the central hexagon

## Success Criteria
- recognizably matches the brand page icon;
- remains fully vector;
- can later be used as the canonical source for app icon exports.
