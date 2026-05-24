---
title: PBTH Grid Team Management SVG Design
date: 2026-03-22
status: approved
source: user-approved reconstruction
---

# PBTH Grid Team Management SVG Design

## Goal
Reproduce the `Grid/Team Management` PBTH mark as a standalone SVG master asset.

## Source Of Truth
The mark is the right-hand icon from the PBTH brand page:
- black rounded square container;
- four green stroked rounded rectangles in a `2x2` grid;
- no outer white card;
- transparent background around the mark.

## Output
- Primary artifact: `/Users/pk/Documents/CalDEV/.codex_artifacts/pbth-grid-team-management.svg`

## Chosen Approach
Use a literal vector reconstruction of the inner mark only.

This keeps the asset:
- consistent with the first reconstructed PBTH icon;
- suitable for later export to PNG;
- easy to adjust for admin or internal-tool variants.

## Geometry
- Artboard: `160x160`
- Main rounded square: `128x128` positioned at `(16,16)`
- Corner radius: `32`
- Grid glyph: built from the original `24x24` icon geometry scaled to a centered `64x64` composition with `fill="none"` and green stroke

## Color Tokens
- Container: `#0F0F0F`
- Grid glyph: `#00E676`

## Filters
- soft neutral drop shadow under the rounded square

## Success Criteria
- recognizably matches the brand-page `Grid/Team Management` symbol;
- remains fully vector;
- matches the scale system of `pbth-hub-concept.svg`.
