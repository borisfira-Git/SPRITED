# SPRITED version history

## 0.6.10

- Added `Align All Frames to Right Foot`, which locks the detected end of the right foot to the Reference Frame on both X and the ground line.
- Added a pink right-foot marker to Body Debug and right-foot alignment data to exported JSON metadata.
- Kept the existing body alignment mode, shared animation Scale, and manual X/Y corrections intact during export.

## 0.6.9

- Added body-based alignment using a pelvis/lower-body anchor instead of the full alpha bounding box.
- Added `Align by Body`, `Align All Frames to Body`, and an editor-only Body Debug overlay.
- Added a shared animation Scale with reference-frame alignment and confidence-based fallbacks.
- Manual X/Y corrections are now stored separately and preserved during Sprite Sheet and separate-frame export.
- Export reuses editor alignment and does not realign frames that are already body-aligned.

## 0.6.8

- Tested automatic sizing with the supplied `IDLEPIKA.png` eight-frame sheet.
- Added cross-frame silhouette comparison so complete head-to-feet bounds are used when the full character remains consistent.
- All frames now share one identical Scale and bottom-center alignment instead of being resized independently.
- Matched the effective common-frame approach used by BrazilGPT while retaining isolated-body detection for changing effects.
- Kept isolated-body detection for sheets whose surrounding effects change size dramatically.

## 0.6.7

- Added automatic head-to-feet measurement for every frame.
- Surrounding effects are ignored when calculating the character's visual size.
- Export now matches character height and ground position by default for uniform animation frames.

## 0.6.6

- Added middle-mouse drag to pan around the editor without changing sprite position.
- Kept left-drag sprite editing, Ctrl + wheel zoom, and S + wheel sprite scaling separate.
- Restored editor keyboard focus after minimizing and reopening the application window.
- Added a remembered default export folder for sprite sheets, separate frames, and metadata.

## 0.6.5

- Added S + mouse-wheel scaling inside the editor.
- Wheel up enlarges and wheel down reduces the selected sprite.
- Multiple selected frames scale together and each wheel gesture is one undo action.
- The current Scale percentage is shown while scaling.

## 0.6.4

- Turned the vertical size ruler into a draggable scale-measurement tool.
- The whole ruler can move up/down while preserving its measured height.
- Top and bottom handles resize the ruler and show the exact pixel height.
- Added a separate vertical-position slider and saved ruler position in project files.
- Ruler changes support undo and can be captured from the selected frame.

## 0.6.3

- Added arrow-key movement for the selected sprite frames in the editor.
- Shift + arrow moves by 10 pixels; a normal arrow moves by 1 pixel.
- Multiple selected frames move together and the action supports undo.
- Alt + Left/Right now changes the active animation frame.

## 0.6.2

- Improved automatic filtering of tiny detached particles and unrelated fragments.
- Added diagonal connectivity so intended anti-aliased sprite edges stay together.
- Strengthened the ground and anchor guides with outlined high-contrast lines.
- Added a fenced lower anchor baseline for clearer foot alignment.

## 0.6.1

- Added Ctrl + mouse-wheel zoom inside the frame editor.
- Zoom stays focused around the mouse pointer and is limited to 10%–400%.

## 0.6.0

- Renamed the application to SPRITED.
- Added a visible version badge and Windows file-version metadata.
- Recolored the complete interface with a warm brown and mocha palette.
- Replaced the embedded local-server launcher with a smaller file-based Windows launcher.

## 0.5.0

- Extract complete sprite objects without relying on a cutting grid.
- Added alignment guides and consistent ground/anchor positioning.

## 0.4.0

- Added automatic chroma-key import and quality export options.
- Added automatic visual enhancement modes.

## 0.3.0

- Added the first portable Windows launcher.

## 0.2.0

- Added Shift multi-selection and the Delete keyboard shortcut.
- Added undo and redo workflow support.

## 0.1.0

- Initial sprite-sheet editor, preview and export application.
