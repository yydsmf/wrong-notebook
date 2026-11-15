# User Guide

Administrators of legacy installations using the default password must change it in the setup wizard first. The wizard can read setup status; restricted APIs return JSON errors instead of web redirects. Background tasks stay hidden during setup and until the password is changed.

## Create a notebook

When creating a notebook, choose its school stage (primary, junior high or senior high) and subject. They decide which knowledge-point library the AI uses and cannot be changed later, so keep separate notebooks per stage and subject.

Primary school offers math, English and Chinese. The built-in Chinese library includes chapters and knowledge points for grades 1–6, junior high and senior high. After upgrading Docker or an installation package, startup fills in missing built-in Chinese tags while preserving existing tag IDs, question links, custom tags and other tag systems.

After an administrator imports the PEP curriculum knowledge points (see [Settings and Users](Settings-and-Users-en)), a **Tag system** option appears when creating a notebook. It coexists with the built-in system and cannot be changed after creation; AI recognition and knowledge-point filters only use tags from the notebook's tag system.

The notebook list shows only each name and question count; click one to open its detail page, where you can rename or delete it. Only an empty notebook can be deleted, so move or delete its questions first.

## Add questions

| Entry | When to use |
| --- | --- |
| Image upload, drag and drop, camera | Paper tests, workbooks and existing question images |
| Clipboard paste | Copied screenshots or images, with `Ctrl/⌘+V` |
| Screenshot | The browser supports screen sharing and the page runs in a secure context |
| AI solve | You already have the question text; Markdown and LaTeX are supported |
| Direct entry | Manually record a known question, answer and analysis |

Images can be cropped first. While cropping or selecting several questions, zoom with the mouse wheel, a two-finger pinch or the buttons at the top right (100%–500%; click the percentage to reset). When one image contains several questions, select them all for a batch import. Keep the full question, any required figure and the student's work, and avoid blurry images or cut-off conditions.

When selecting multiple images, the crop dialog shows the current image number and processes them in selection order. Rotate and crop each image, click "Confirm and next", then "Finish cropping and import" on the last image. In the default single-question mode, all images form one question, such as a passage and questions on separate pages. They are recognized together in one request and saved as one question with every source image. Only explicitly selecting multi-question mode imports each region as a separate question. The mode stays fixed after confirming the first image; cancel and select again to change it. Canceling discards unsubmitted crops. Review, source-image viewing and backups preserve image order.

Multi-image requests do not send the first image twice or reduce image resolution further. Limits are 20 images, 20 MiB of encoded transfer data per image and 50 MiB combined. The server proxy accepts up to 80 MiB to accommodate older clients that duplicate the first image and the question text.

After enabling "Review before import" in "Settings → General", you can correct the recognition on the review page before saving. The AI may misread numbers, symbols and figure relationships, so check against the original before saving.

## Student answers and administrator review

Students share the administrators' question bank and exams while keeping independent review progress and submission results. AI grading saves per-question results and mistake analysis after each submission.

Open Admin dashboard → User list → View details → Student submissions. Switch between Review records and Exam records to see submission times, grading status, correct counts and accuracy. View grading opens paginated question snapshots, figures, student text or selected answers, handwritten images, reference answers, explanations and AI feedback. Click a handwritten image to enlarge it.

Accuracy includes only successfully graded answers; pending or failed answers are excluded. Refresh reads the latest stored status. Viewing records does not call AI or require resubmission. Saved question and answer snapshots remain available after source questions are edited or deleted. Only administrators can access this view.

## Duplicate detection

On import, the question text is compared with the current user's existing questions across all notebooks. The default threshold is 90% and can be changed in your general settings.

- When the similarity is **strictly greater** than the threshold, the existing question is returned and a wrong attempt is recorded on it.
- A similarity equal to the threshold does not count as exceeding it.
- Similarity is the character edit similarity of the normalized question text; it does not mean the math is the same.
- Records from repeated imports feed into later mastery evaluation; check the original question's answer history when needed.

Notebooks also offer a two-question similarity comparison to help decide whether the threshold suits your questions. If only a few characters of numbers or conditions differ, the similarity may still be high, so judge by the meaning of the question.

## Question details

Each question shows its text, answer, analysis, knowledge points, difficulty, semester and paper level, plus the original photo.

| Information or action | Notes |
| --- | --- |
| 6-character question ID | Copy it and locate the question by ID in a notebook; shown as the source ID in printouts |
| 1–5 star difficulty | Rated by the AI with reference to competition-math difficulty; can be changed manually |
| Grade/semester | Click **Edit grade/semester** to change and save it; review also offers a selector, and loading the profile preserves manual edits |
| Paper level | When not set, 1–3 stars default to the "Paper A" group and 4–5 stars to the "Paper B" group; a manual choice takes priority. Customize groups in **Settings → General → Paper Groups**: rename defaults, add custom groups (e.g. Unit Test, Midterm, Final), deactivate or delete custom groups |
| Knowledge points | Tags from the matching stage and subject; re-recognize one question or a whole notebook |
| Regenerate full solution | Generates a new answer and analysis; asks for confirmation before overwriting |
| Fix LaTeX | Appears when formula syntax issues are detected, letting the AI correct the formulas |
| Original image | View, replace or add it to check the recognition |

Unrated questions are not assigned a paper level by the default rule alone. Regenerating the full solution keeps the knowledge points and mistake information.

![Question text, knowledge points, difficulty and question info](https://raw.githubusercontent.com/margrop/wrong-notebook/a5f816515e3dc31dcdb90c9fa456baed12eef94d/doc/screenshots/en/question-detail.png)

Choose a fixed grade or AI recognition for new questions under **Settings → General**. Manual choices take priority; see [Settings and Users](Settings-and-Users-en).

## Figures and animated explanations

- **Integer digit-count conditions**: explicit integer digit counts use the absolute value of known numbers, excluding signs and leading zeros; both `034` and `34.0` are checked as 34. `3.4` is not a two-digit integer, and even a tiny nonzero fractional part is not rounded away. Figure text retains its original wording. Unknown digit boxes keep their existing place-count checks; complex expressions are not evaluated and answers are not filled in. Decimal arithmetic without an explicit digit-count condition keeps its existing rules. This does not provide general decimal-point alignment.
- **Explicit measurement checks**: new structured figures check equal square sides, cube edges, opposite horizontal sides of rectangles and parallelograms, radii and diameters of one circle, and explicit degree labels on right-angle marks. A chord cannot exceed a known diameter or twice a known radius in the same circle. Length labels for the same endpoint pair must agree even when the endpoints are reversed or the segment is listed as both a chord and a diameter; different chords do not have to be equal. Integers, decimals, ordinary fractions and limited mixed numbers support exact internal comparison with common metric units, while saved labels retain their wording. Unitless values are compared only with other unitless values. Unknown formulas and angle identifiers are not evaluated. Drawing dimensions and illustrative chord angles do not determine physical lengths, and missing units are not inferred. Contradictions trigger whole-figure or whole-group fallback; legacy SVG is sanitized only for safety, so check the question and original image. If AI Redraw Figure returns no usable output, the existing figure is kept and the background task reports failure with retry available.
- **Question-to-arithmetic cross-checks**: one complete integer or decimal expression, or an explicit condition such as “a two-digit number times 25”, checks values, signs, operator and both stated digit counts. Common LaTeX operators and English operation words are supported. Valid, explicitly labeled and fully separated leading dates (such as “Date: 2026-11-15.”), time ranges and question ranges are not treated as expressions. Only consecutive headers at the start are excluded; body text, formulas, invalid dates and unseparated content remain conservative. Common parameter-free styles (such as `\displaystyle`) and spacing commands do not cancel value checks, rewrite text or hide calculation structure in commands with arguments. Exact decimal comparison leaves saved text unchanged: `3.4×25` is not reduced to `4×25`, and a fraction slash is not treated as division. Compound, chained, unknown or multiple candidate expressions are not reduced to fragments. Conflicts try the complete legacy SVG; no new figure is returned when no usable output exists. Original images and manual figures remain available. This does not provide general formula evaluation or decimal-point alignment.
- **Question-to-main-figure checks**: limited direct statements such as “The figure is a square” or “下图是一个正方形” check area and solid figures against the stated shape and necessary dimensions. Compatible drawings such as equal-sided rectangles and equal-edged cuboids remain valid. Subsequent calculation questions such as “What is its area?” keep the shape constraint; shape questions, truth judgments, proof tasks, assumptions and quotations are not treated as facts. Square units, shape mentions alone, shaded regions, cross-sections, multiple shapes and figure groups are not inferred. Clear conflicts trigger whole-figure fallback; this check does not replace comparison with the original image.
- **Arithmetic blanks**: newly generated structured arithmetic keeps boxes, question marks, underscores and unknown digits without solving the blanks from known operands. Multiplication rows retain their labels and digit shifts. Duplicate positions or shifts beyond a known integer multiplier cause the whole figure to fall back. Existing integer values can still be recomputed, which does not prove correct transcription. Saved figures are unchanged; legacy SVG fallback is not validated for mathematical correctness.
- **Reading arithmetic**: newly generated arithmetic uses a compact canvas based on its content. Integers and simple unknown digits use fixed columns, keeping boxes and digits aligned despite different glyph widths. Notes follow the complete calculation, with at most three lines and fonts of at least 12px. Content that cannot fit causes the whole figure to fall back without clipping the note or placing it among the rows. Long calculations can still scroll. Decimal values and complex expressions remain complete text rows; general decimal-point alignment is not supported yet. Saved figures use the new layout after regeneration.
- **SVG figures**: common figures are recognized as structured data and rendered as static SVG by local templates for details, practice and printouts; the original image can still be viewed separately. Figures include a **View larger figure** control; on phones, use the buttons, wheel or two-finger pinch in the viewer to inspect dense tables and geometry labels. SVGs with explicit, reliably measurable font sizes open at a reading size of at least 12px at 100%. Wide and tall figures scroll inside the viewer; focus the reading region for arrow-key or page-key navigation. This size is independent of the page's saved figure scale. Use Fit whole figure / Reading size to inspect the overview or restore readable labels. Each mode uses its own initial size as 100%, and switching modes resets zoom. Manual images and unmeasurable legacy SVGs continue to fit the full image. Zoom uses positions within the image so centering whitespace and padding do not push narrow figures to one side. Buttons zoom around the visible image center, within scroll boundaries. The cropper uses the same rule and keeps crop regions relative to the original image. Closing the viewer does not change the saved figure scale.
- **Geometry on phones**: newly generated structured basic geometry, circle and coordinate figures reduce outer whitespace using complete shape and text bounds, preserving stroke clearance, question coordinates and equal axis scale. This makes labels larger at the same available width. Saved figures keep their existing canvas until regenerated. Dense labels, long titles and very long axes may still need **View larger figure**; saved scale and alignment settings continue to apply.
- **Arcs and sectors**: circle templates support major arcs, minor arcs and semicircle sides. A semicircle uses a third point on the circle to identify its side. Small radial coordinate errors are aligned to the radius while preserving direction, using the same projection for validation and drawing. Distinct point IDs that coincide after alignment, zero-length chords, or diameter endpoints outside the existing center tolerance cause whole-figure fallback. Point names are not merged, segments are not removed, and endpoints are not moved to repair a conflict. Nearby points in different directions are not treated as coincident using the arc-direction threshold; label placement is checked separately. Conflicting relationships, ambiguous sides or points outside tolerance fall back to compatible legacy SVG; keep the original image for checking or use a manual figure when neither is usable.
- **Grid labels**: square cells, row and column counts, and shaded positions are preserved. Cells and the canvas expand as needed, with up to three text lines per cell and a minimum font size of 12. If complete labels still cannot fit, the figure falls back without dropping text or moving it to other cells. Use **View larger figure** to inspect dense grids.
- **Mathematical labels**: characters such as `cm²`, `m³`, `A₁` and `½` are preserved; normalization only folds full-width ASCII and tidies whitespace. Grids, tables and charts keep common numeric values, contiguous expressions and common units intact when wrapping. Width estimates use Unicode grapheme clusters, so combining accents, variation selectors and joiners are not counted twice. Paired `$…$`, `$$…$$`, `\(…\)`, `\[…\]` formulas and common raw commands with complete arguments, including `\frac {1} {2}`, `\sqrt [3] {27}` and paired `\left … \right`, stay indivisible, and SVG text does not run through KaTeX. Incomplete or unrepresentable content falls back conservatively without splitting the number or dropping text. Complex formulas and composite figures still need checking.
- **Geometry label placement**: basic geometry, circle diagrams and coordinate planes place point names, segment lengths, angles, sectors, arc labels and circle names together to avoid segments, circles, angle marks, point markers, fixed text and other labels. Labels for segments, radii, diameters and chords use the full text box to choose a position beside the middle portion of the segment, with checks against association with neighboring segments. Radius labels also have a movement limit based on radius length. The entire angle label stays inside its angle, outside the marker and within the usable ray lengths. Sector text stays inside its original sector, and arc text outside the corresponding arc. Labels in major sectors cannot cross into the excluded minor sector. The full circle-name box stays inside its own circle; names of intersecting circles avoid overlap regions, and an outer concentric circle uses the annulus, preventing ambiguous associations. Titles, coordinate ticks and free descriptions retain their original anchors; a collision with geometry or text, or an out-of-bounds label, causes a fallback. Light gray coordinate grids are treated as background; axes and question lines participate in collision checks. Placement never moves geometry or removes labels. If no reliable space is available or an angle marker is too small, it falls back to compatible legacy SVG; check the original or use a manual figure when needed. Complex figures and recognition results still need checking.
- **Figure display scale and alignment**: saved mistakes with a figure show this setting on the details page. Enter a percentage or drag the slider to preview, from 10–200% (default 100%), and choose an alignment (left / center / right, default center); exam papers with figures also allow adjusting scale and alignment per question or uniformly across the exam. Click **Save** to apply it after reload and in printouts. **Reset to 100%** restores the default scale; save again to keep it. SVG and manual figures scale once; the container limits wide figures without shrinking narrow figures twice. Enlarged figures fit the available width and keep their aspect ratio. Backups retain the scale and alignment; existing questions and older backups default to 100% and center. **Image Scale** in print preview controls the original photo; enable **Question Text** to print the figure.
- **SVG animated explanations**: the animation stays paused on the first frame when opened or changed; click Play to start. Step-by-step demonstrations of the solution with pause, seeking, replay and full screen; enabled by default in personal settings. Click the speaker icon in the player to turn on voice narration (off by default and remembered once on). Each step is read aloud (by the browser's speech synthesis by default; when an admin turns on cloud voice, the server synthesizes it so every device hears the same voice), the animation waits for the narration before moving on (it pauses on the complete current step and highlights the frame border while waiting), and the speed cycles between 0.75× and 1.5×. Older animations without a narration script read the subtitles at the bottom of the picture. Click **Add narration** above the animation to have AI write a script for the existing picture without regenerating the animation (counts as one animated-explanation AI use). When a script exists, the button reads **Rewrite narration**. With cloud voice on, turning on narration for the first time synthesizes the whole animation's voice at once, and **Regenerate voice** above the animation synthesizes it again; both appear in background tasks with progress (they use the speech provider's quota, not the AI daily limit). Animations whose cloud voice has been generated open with narration on. Animation text follows the interface language; Chinese and English versions are generated and saved separately, and switching the language shows the matching version automatically.
- **GeoGebra interactive demos**: interactive figures for math and physics questions; disabled by default in personal settings.

Generated animations and GeoGebra demos can be deleted after confirmation. Check generated figures and solutions manually, especially geometric positions, counting steps and conclusions.

## Filters and batch actions

Filter by mastery status, knowledge point, time, grade and semester, or paper level, then act on the results in bulk or print them. Before deleting, confirm the filters and selection; [back up your data](Backup-and-Restore-en) when it must be kept long term.

## Markdown and formulas

Questions, answers and analysis support Markdown, and formulas are rendered with KaTeX:

```text
Inline: $a^2+b^2=c^2$ or \(a^2+b^2=c^2\)
Display: $$\frac{a}{b}$$ or \[\frac{a}{b}\]
```

While editing you can switch between source and preview. For complex tables and formulas, see the [Markdown guide](https://github.com/margrop/wrong-notebook/blob/main/doc/MARKDOWN_GUIDE.md) and the [table recognition notes](https://github.com/margrop/wrong-notebook/blob/main/doc/TABLE_RECOGNITION.md).

Next: [Practice and Exams](Practice-and-Exams-en).
