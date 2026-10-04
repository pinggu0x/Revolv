# Revolv for the web

A responsive study web app by Gabriel Zantua. Import Markdown decks, review
flashcards, and answer multiple-choice questions. Your decks and unfinished
sessions are saved in your browser and survive browser restarts.

## Features

- Question-and-answer flashcards with reveal and hide controls.
- Numbered A–D quizzes with one correct answer and a separate answer key.
- Checklist questions with one or several correct answers.
- Spaced repetition with Hard, Good, and Easy ratings.
- Ordered or shuffled sessions, previous/skip navigation, and session recovery.
- Daily goals, streaks, review statistics, and choice accuracy.
- Responsive layouts, keyboard controls, and backup export/restore.

No account, backend, uploads, build step, or runtime packages are required.
Python 3 is used to serve the files locally. The original desktop application
remains available in `flashcard_viewer.py`.

## Run

From this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://127.0.0.1:8000**. Keep using the same address and browser so your
saved workspace is available. Serve the static HTML, CSS, SVG and `.mjs` files
over HTTP(S); opening `index.html` as a `file://` URL does not support modules
consistently.

1. Click **Import deck** and select a `.md`, `.markdown`, or `.txt` file, or
   choose **Try an example**.
2. Click **Study deck**, select or recall an answer, and reveal/check it.
3. Choose **Hard**, **Good**, or **Easy** to schedule the next review.
4. Return later using the same browser and address, then choose **Resume**.

Keep the server running while using the app. Press Ctrl+C in its terminal to
stop it; start it again with the same command when you return.

## Study

Import a Markdown deck, or try the example deck. Only due cards enter a new
session. Ordered sessions sort by due date, preserving file order for equal
dates. Shuffle affects new sessions; resumed sessions retain their saved order.

Reveal an answer (or select and check a choice answer), then rate it:

Use **Hide answer**, or press Space again, to hide the answer and rating controls.
Reveal it again whenever you’re ready; the hidden state persists across reloads.
Choice submissions remain locked while hidden, and revealing the same result
again does not add an attempt or change your review schedule.

- **Hard:** remains due, and returns three to five positions later, or at the
  end of a shorter queue. A single Hard card remains available until learned.
- **Good:** 1 day on the first successful review, 6 days on the second, then
  `floor(interval × adjusted ease)`; ease decreases by 0.05, minimum 1.3.
- **Easy:** 3 days, then 8 days, then `floor(interval × adjusted ease × 1.3)`;
  ease increases by 0.15.

Intervals match the desktop’s actual schedule. Previews show these actual
intervals rather than the desktop’s inconsistent previews.

Previous revisits a card; skip leaves its schedule unchanged. Skipped cards can
remain due after a session ends. Statistics distinguish self-ratings from actual
choice accuracy; multi-choice correctness requires the exact set of answers.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Reveal, hide, or check the answer |
| 1 / 2 / 3 | Rate Hard / Good / Easy while the answer is visible |
| Left / Right arrow | Previous card / skip card |
| Escape | Return to the library |
| Ctrl+S / Cmd+S | Open statistics |
| Tab | Move between controls |

Native inputs retain their keyboard behavior; use Tab to reach **Check answer**
from choice controls. Space on a focused button activates that button.

## Markdown format

### Numbered A–D quiz with one correct answer

Import quizzes with numbered questions, four options labeled A–D, and a separate
`## Answer Key` section. No `?` or `---` separators are needed for this format.
Question numbers must be unique; every question needs exactly one matching key.
An optional explanation follows the answer letter after a dash.

```markdown
## Module 1: Ethics
### Foundations

1. Which discipline studies morality?
   A. Physics
   B. Ethics
   C. Chemistry
   D. Astronomy

## Answer Key
1. B — Ethics studies moral principles.
```

The app matches answers by question number and shows selectable A–D options.
Missing, duplicate, or invalid keys reject the import without changing your
library. Existing checklist cards still support multiple correct answers.

### Original flashcards and checklist choices

`?` and `---` must be on separate lines. `## MODULE …` and `### …` provide context.
The existing `#flashcards` and `<!--SR:…-->` markers are ignored. Blank lines and
UTF-8 BOMs are supported. Question/answer text is displayed safely as plain text,
with the same basic Markdown/HTML conversion as the desktop app.

```markdown
## MODULE 1
### Biology
#flashcards

The basic unit of life.
?
Cell

---
Which structure stores genetic information?
- [ ] Ribosome
- [x] Nucleus
- [ ] Cell membrane
?
The nucleus contains the cell’s DNA.

---
Select the prime numbers.
- [x] 2
- [x] 3
- [ ] 4
?
Both 2 and 3 have exactly two factors.
```

Choice options go after the complete question and before `?`. At least two
options and one marked correct option are required. `[x]`/`[X]` marks a correct
option, `[ ]` marks a distractor. One correct option creates radios; multiple
correct options create checkboxes. The explanation after `?` is optional for
choice cards. Plain flashcards require a nonempty answer.

## Browser persistence and backups

Decks, schedules, statistics, ordering, current screen, and unfinished sessions
(including answer selections and revealed results) save after every action in
the `revolv.browser.v1` localStorage entry. Closing/reopening the browser or
restarting the local server preserves this state.

Browser storage belongs to a particular browser profile and site origin. It
does not sync between devices. Clearing site data, private browsing, or browser
storage eviction can remove it. **Export backup** downloads the full workspace;
**Restore backup** validates it and requests confirmation before replacement.
Downloads include study content; keep them private if your decks are private.

Storage writes are atomic; a blocked/full store does not advance the screen or
review progress. Unreadable saved data is preserved for export/recovery. Another
tab’s changes trigger a reload notice rather than silently overwriting progress.
Modern browsers use Web Locks to serialize saves across tabs; older browsers
without Web Locks still detect stale snapshots, but cannot guarantee simultaneous
cross-tab writes. Use one tab for studying in those browsers.

Reimporting the same filename updates the deck after confirmation and preserves
matching flashcard progress. The deck menu also offers **Update from file**.
Updating clears its unfinished session. Choice options/answer keys are part of
card identity, so changing them creates a new card. Identical questions retain
separate identities by occurrence order. Removing a deck hides it and retains
its progress; reimporting the same filename restores it. Reset affects only that
deck’s schedule and session; overall statistics remain.

The browser cannot silently monitor desktop files. Reimport when you change a
deck. Desktop `_progress.json` and `_session.json` are not automatically migrated;
browser JSON backups use their own versioned format.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| No flashcards found | Use one of the Markdown formats above. A–D quizzes need an Answer Key section; plain flashcards need a standalone `?`. |
| Missing or invalid answer key | Give every numbered question exactly one key using A, B, C, or D. Keep question numbers unique. |
| Progress seems missing | Check that you are using the same browser profile and exact site address. Restore an exported backup if necessary. |
| Browser cannot save | Export a backup, allow site storage or free browser storage, then retry. The failed action does not advance progress. |
| Workspace changed in another tab | Click **Reload saved workspace** before continuing. |
| Port 8000 is already in use | Stop the previous local server or choose another port. A different port has separate browser storage. |

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Application entry point |
| `app.mjs` | Screens, controls, imports, and browser persistence |
| `core.mjs` | Deck parsing, review queues, scheduling, and validation |
| `styles.css` | Responsive interface styles |
| `favicon.svg` | Application icon |
| `tests/core.test.mjs` | Study-model regression checks |
| `tests/browser_check.mjs` | Browser workflow checks |
| `flashcard_viewer.py` | Original Python desktop application |

## Checks

```sh
node --test tests/core.test.mjs
node --check core.mjs
node --check app.mjs
```

Browser regression checks are in `tests/browser_check.mjs` and require Playwright
with a Chromium installation in the validation environment; it is not an app
dependency. Start the server first, then run:

```sh
node tests/browser_check.mjs
```

If Playwright is available outside the project, set `REVOLV_PLAYWRIGHT_PATH` to
its package location. Set `REVOLV_URL` to check a different local server address.

## License

Copyright (c) 2025-2026 Gabriel Zantua.

Revolv, including the web app and original desktop application, is licensed under
the [MIT License](LICENSE). You may use, modify, and distribute it, including
commercially, while retaining the copyright and license notices. The software
is provided without warranty; see the license for the complete terms.
