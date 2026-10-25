# Manual Android Testing Checklist

This checklist defines manual verification procedures on a physical Android device running Chrome.

## Device & Environment
- **Device**: Android Phone (e.g. Pixel, Samsung Galaxy, or similar physical device)
- **Browser**: Google Chrome for Android (latest stable)
- **Default Keyboard**: Gboard
- **URL**: `http://<host-ip>:5173/entry/<entryId>`

---

## 1. Gboard Typing & Composition
- [ ] Tap into the editor body. Verify the virtual keyboard appears without pushing header content off-screen.
- [ ] Type a continuous paragraph of English text.
- [ ] Verify character composition is fluid with zero lag or dropped keystrokes.
- [ ] Verify that words appear immediately at the cursor insertion point.

## 2. Autocorrect & Predictive Suggestions
- [ ] Intentionally misspell a word (e.g., `teh` -> `the`, `definitly` -> `definitely`).
- [ ] Accept Gboard's suggestion from the candidate ribbon.
- [ ] Verify the corrected word replaces the misspelling without duplicating adjacent characters or deleting spaces.

## 3. Voice Typing (Speech-to-Text)
- [ ] Tap the microphone icon on Gboard.
- [ ] Dictate two full sentences with punctuation ("The paper archive is tactile. It feels like craft.").
- [ ] Verify speech transcription streams directly into the active paragraph.
- [ ] Verify no spurious block splits occur during dictation.

## 4. Native Selection Handles & Floating Bar
- [ ] Long-press a word in the text.
- [ ] Verify native Android selection teardrop handles appear.
- [ ] Verify the Kaaj mobile formatting bar anchors above the virtual keyboard via `visualViewport`.
- [ ] Drag selection handles to expand text range to multiple words.
- [ ] Verify the selection highlight remains stable while dragging.

## 5. Bold & Mark Toggles While Typing
- [ ] Tap an empty line.
- [ ] Select a word and tap **Bold** on the toolbar. Verify the selection bolds.
- [ ] Place cursor at the end of a sentence. Tap **Bold** (or use toolbar toggle).
- [ ] Type new text. Verify new characters render in bold.
- [ ] Toggle bold off and continue typing. Verify subsequent text returns to normal weight.

## 6. List Creation (Input Rules & Toolbar)
- [ ] Type `- ` (hyphen followed by space). Verify conversion to a bullet list item.
- [ ] Type `1. ` (one, period, space). Verify conversion to a numbered list item.
- [ ] Type text and press **Enter** on Gboard. Verify a new list item item is created.
- [ ] Press **Enter** twice on an empty list item. Verify exit from list back to standard paragraph.

## 7. Undo & Redo
- [ ] Type a sentence.
- [ ] Tap **Undo** button in the mobile toolbar (or Gboard undo gesture if enabled).
- [ ] Verify the last change reverts cleanly.
- [ ] Tap **Redo**. Verify reverted text restores correctly.

## 8. Mobile Viewport & Touch Targets
- [ ] Verify all toolbar action buttons and bottom sheet targets meet or exceed 44x44 px touch targets.
- [ ] Verify the page layout has no horizontal scrolling (`overflow-x: hidden` / fitted column).
- [ ] Rotate device to landscape and back to portrait. Verify visualViewport recalibration.
