import {
  STORAGE_KEY, createState, validateState, importDeck, dueCards, activeDeck,
  currentCard, startSession, rateCurrent, navigateSession, intervals, dayKey,
  visibleStreak, resetProgress, submitChoices, choiceResult,
} from './core.mjs';

const icons = {
  library: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><path d="m14 4 6 1-2 15-6-1zM5 8h3m-3 8h3"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 16h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cards: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M2 16V3a1 1 0 0 1 1-1h13M9 11h6m-6 4h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 3c1 5 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 3-6 0 3 1 4 2 4 2-2 2-5 1-9z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  left: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  shuffle: '<path d="m3 5 4 0c5 0 5 14 10 14h4m-4-4 4 4-4 4M3 19h4c5 0 5-14 10-14h4m-4-4 4 4-4 4"/>',
  order: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  bulb: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  choice: '<rect x="3" y="4" width="5" height="5" rx="1"/><path d="M12 6h9M12 17h9m-17 0 2 2 4-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.cards}</svg>`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const number = value => new Intl.NumberFormat().format(value);
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const deckInput = document.querySelector('#deck-file');
const backupInput = document.querySelector('#backup-file');
let state = createState(), expectedRaw = null, loadError = false, busy = false, updateTarget = null, pendingAction = null, toastTimer;

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

function displayText(text) {
  // Preserve the desktop's plain-text conversion without trusting imported HTML.
  let result = text.replace(/<u>(.*?)<\/u>/gs, (_, content) => content.replace(/&nbsp;/g, '').trim() ? content : '____________');
  result = result.replace(/<[^>]*>/g, '').replace(/\*\*(.*?)\*\*/gs, '$1').replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '[$1]').replace(/~~(.*?)~~/g, '$1');
  result = result.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, entity => {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = entity;
    return decoder.value;
  });
  return escape(result);
}

function readSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? validateState(JSON.parse(raw)) : createState();
    state = saved; expectedRaw = raw; loadError = false;
  } catch (error) {
    loadError = true;
    showNotice('Your saved workspace could not be opened. It has not been overwritten. Export the saved data for recovery, or restore a valid Revolv backup.', 'reload');
  }
}

function showNotice(message, action = null) {
  notice.innerHTML = `<span>${escape(message)}</span>${action ? `<button class="button small" data-action="${action}">${action === 'reload' ? 'Reload saved workspace' : 'Dismiss'}</button>` : ''}`;
  notice.hidden = false;
  if (dialog.open) {
    let error = dialog.querySelector('.dialog-error');
    if (!error) {
      error = document.createElement('p'); error.className = 'dialog-error';
      error.setAttribute('role', 'alert');
      dialog.querySelector('.dialog-body').append(error);
    }
    error.textContent = message;
  }
}

function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

async function transact(change, {focus = false, restore = false} = {}) {
  if (busy) return false;
  if (loadError && !restore) { showNotice('Open a valid backup before making changes. Your saved workspace remains untouched.', 'reload'); return false; }
  busy = true;
  try {
    const write = () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!restore && raw !== expectedRaw) throw new Error('This workspace changed in another tab. Reload the saved workspace before continuing. Your action has not been applied.');
      const draft = structuredClone(state);
      const result = change(draft) || draft;
      validateState(result);
      const serialized = JSON.stringify(result);
      // A single setItem is atomic. The screen advances only after a successful write.
      localStorage.setItem(STORAGE_KEY, serialized);
      expectedRaw = serialized; state = result; loadError = false;
    };
    if (navigator.locks) await navigator.locks.request('revolv-save', write);
    else write();
    notice.hidden = true;
    render(focus);
    return true;
  } catch (error) {
    const storageFailure = ['QuotaExceededError', 'SecurityError'].includes(error.name);
    showNotice(storageFailure ? 'This browser could not save the change. Your progress has not advanced. Export a backup, then free browser storage or allow site storage and try again.' : error.message, 'reload');
    return false;
  } finally { busy = false; }
}

function button(action, label, glyph, classes = '', extra = '') {
  return `<button class="button ${classes}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
}

function overview(items) {
  return `<div class="overview">${items.map(([glyph, value, label]) => `<div class="metric"><span class="metric-icon">${icon(glyph)}</span><div><strong>${number(value)}</strong><p>${label}</p></div></div>`).join('')}</div>`;
}

function goalPanel() {
  const reviews = state.stats.daily_reviews[dayKey()] || 0, goal = state.preferences.daily_goal;
  const progress = Math.min(reviews / goal, 1), circumference = 402.124;
  return `<section class="goal-panel" aria-labelledby="goal-title"><h3 id="goal-title">A little, every day.</h3><p>Your daily review goal</p><div class="goal-ring" role="img" aria-label="${reviews} of ${goal} daily reviews"><svg viewBox="0 0 154 154" aria-hidden="true"><circle class="ring-base" cx="77" cy="77" r="64"/><circle class="ring-progress" cx="77" cy="77" r="64" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - progress)}"/></svg><div class="ring-text"><strong>${number(reviews)}<span> / ${goal}</span></strong><span>cards reviewed</span></div></div><div class="goal-caption">${reviews >= goal ? '<strong>Daily goal reached.</strong><br>A good day for your memory.' : `<strong>${goal - reviews} more reviews</strong><br>to reach today's goal.`}</div><div class="streak-row"><span>${icon('flame')} Current streak</span><strong>${visibleStreak(state.stats)} ${visibleStreak(state.stats) === 1 ? 'day' : 'days'}</strong></div></section>`;
}

function libraryView() {
  const decks = state.decks.filter(d => !d.archived);
  const due = decks.reduce((sum, d) => sum + dueCards(d).length, 0);
  const total = decks.reduce((sum, d) => sum + d.cards.length, 0);
  return `<div class="page-heading"><div><h1>Make room for recall.</h1><p>Your next review is a step toward remembering.</p></div>${button('import', 'Import deck', 'plus', 'primary')}</div>
    ${overview([['clock', due, 'Cards due for review'], ['cards', total, 'Cards in your library'], ['flame', visibleStreak(state.stats), 'Day study streak']])}
    <div class="library-layout"><section aria-labelledby="decks-title"><div class="section-heading"><h2 id="decks-title">Your decks <span class="count">${decks.length}</span></h2><button class="order-toggle" data-action="shuffle" aria-pressed="${state.preferences.randomize}" title="Change the order for new sessions">${icon(state.preferences.randomize ? 'shuffle' : 'order')}${state.preferences.randomize ? 'Shuffled' : 'In order'}</button></div><div class="deck-list">${decks.length ? decks.map(deckCard).join('') : emptyLibrary()}</div><div class="format-hint">${icon('help')} Flashcards and multiple-choice questions.<button class="text-button" data-action="format">See the Markdown format</button></div><div class="backup-mobile"><button class="text-button" data-action="backup">Export backup</button><button class="text-button" data-action="restore">Restore backup</button></div></section><aside class="study-aside" aria-label="Study progress and tips">${goalPanel()}<section class="tip-panel"><span>${icon('bulb')}</span><h3>Recall before you reveal.</h3><p>Give yourself a moment to find the answer. That small effort helps it stick.</p></section></aside></div>`;
}

function emptyLibrary() {
  return `<div class="empty-state" id="drop-zone"><div class="empty-illustration" aria-hidden="true"><div class="empty-card"></div><div class="empty-card front">${icon('cards')}</div></div><h3>A fresh start for your memory.</h3><p>Bring your Markdown flashcards here. Your decks and study sessions will be ready whenever you return.</p><div class="button-group">${button('import', 'Import your first deck', 'upload', 'primary')}${button('example', 'Try an example', '', '')}</div><p class="format-hint">You can also drop .md files here.</p></div>`;
}

function deckCard(deck) {
  const due = dueCards(deck).length, total = deck.cards.length;
  const modules = [...new Set(deck.cards.map(c => c.module).filter(Boolean))];
  const choices = deck.cards.filter(c => c.choices).length;
  const saved = deck.session && deck.session.queue.slice(deck.session.index).some(id => deck.cards.some(c => c.id === id && new Date(c.due_date) <= new Date()));
  const extra = `data-id="${escape(deck.id)}"`;
  return `<article class="deck-card"><div class="deck-card-header"><span class="deck-glyph">${icon(choices === total ? 'choice' : 'cards')}</span><details class="deck-menu"><summary aria-label="Manage ${escape(deck.name)}">${icon('more')}</summary><div class="menu-options"><button data-action="update-deck" ${extra}>Update from file</button><button data-action="reset-deck" ${extra}>Reset deck progress</button><button data-action="remove-deck" class="danger-text" ${extra}>Remove from library</button></div></details></div><h3>${escape(deck.name)}</h3><p class="deck-description">${modules.length ? `${modules.length} ${modules.length === 1 ? 'module' : 'modules'} · ` : ''}${choices ? `${choices} choice ${choices === 1 ? 'question' : 'questions'}${choices < total ? ' + flashcards' : ''}` : 'Question & answer flashcards'}</p><div class="deck-meta"><span>${number(total)} cards</span><span class="due-tag ${due ? '' : 'clear'}">${due ? `${number(due)} due now` : 'Up to date'}</span></div><div class="deck-progress" role="img" aria-label="${total - due} of ${total} cards scheduled for later"><div class="deck-progress-fill" data-width="${100 * (total - due) / total}"></div></div><div class="deck-footer"><span>${saved ? 'Session ready to resume' : due ? 'Ready when you are' : 'Next review ' + escape(nextDue(deck))}</span>${button('study', saved ? 'Resume' : due ? 'Study deck' : 'View status', due ? 'arrow' : 'check', due ? 'primary small' : 'small', extra)}</div></article>`;
}

function nextDue(deck) {
  const date = new Date(Math.min(...deck.cards.map(c => new Date(c.due_date).getTime())));
  return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(date);
}

function studyView() {
  const deck = activeDeck(state), card = currentCard(state);
  if (!deck || !card) return completeView();
  const session = deck.session, schedule = intervals(card);
  const revealed = session.revealed && !session.answerHidden;
  const extra = `data-id="${escape(deck.id)}"`;
  const correctCount = card.choices?.filter(c => c.correct).length;
  const result = card.choices && revealed ? choiceResult(card, session.selected) : null;
  const breadcrumb = [card.module, card.section].filter(Boolean).map(escape).join(' / ');
  return `<div class="study-wrap">${button('library', 'Back to library', 'left', 'subtle small')}<div class="study-heading"><div><h1>${escape(deck.name)}</h1><div class="breadcrumb">${breadcrumb || 'Your study session'}</div></div><span class="session-position">Card ${session.index + 1} of ${session.queue.length}</span></div><div class="session-progress" role="img" aria-label="${session.index} of ${session.queue.length} cards passed"><div data-width="${100 * session.index / session.queue.length}"></div></div><article class="flashcard" aria-labelledby="question"><div class="card-topline"><span class="card-type">${icon(card.choices ? 'choice' : 'cards')}${card.choices ? correctCount > 1 ? 'Select all that apply' : 'Single choice' : 'Flashcard'}</span><span>${card.repetitions ? 'Review' : 'New card'}</span></div><h2 id="question" class="question-text">${displayText(card.question)}</h2>${card.choices ? choiceInputs(card, session) : ''}${revealed ? `<div class="answer-area" aria-live="polite">${card.choices ? `<div class="choice-feedback ${result ? '' : 'incorrect'}">${icon(result ? 'check' : 'help')}<div><strong>${result ? 'That’s correct.' : 'Not quite. Take another look.'}</strong><p>${result ? 'You selected all the correct options.' : 'The correct options are marked above. Use Hard if you need another review.'}</p></div></div>${card.answer ? `<p class="answer-label">Explanation</p><p class="answer-text">${displayText(card.answer)}</p>` : ''}` : `<p class="answer-label">Answer</p><p class="answer-text">${displayText(card.answer)}</p>`}</div>` : ''}</article><div class="review-controls">${revealed ? `${button('hide-answer', 'Hide answer', '', 'subtle wide hide-answer-button')}<p class="rating-prompt">How well did you remember?</p><div class="rating-grid"><button class="rating hard" data-action="rate" data-rating="1"><strong>Hard <kbd>1</kbd></strong><span>Review again</span></button><button class="rating good" data-action="rate" data-rating="2"><strong>Good <kbd>2</kbd></strong><span>In ${number(schedule.good)} ${schedule.good === 1 ? 'day' : 'days'}</span></button><button class="rating easy" data-action="rate" data-rating="3"><strong>Easy <kbd>3</kbd></strong><span>In ${number(schedule.easy)} days</span></button></div>` : button('reveal', card.choices && !session.revealed ? 'Check answer' : 'Reveal answer', card.choices ? 'check' : 'arrow', 'primary reveal-button', card.choices && !session.selected.length ? 'disabled' : '')}</div><div class="session-nav"><button data-action="previous" ${session.history.length ? '' : 'disabled'}>${icon('left')} Previous</button><p>${session.reviewed} ${session.reviewed === 1 ? 'review' : 'reviews'} this session · saved automatically</p><button data-action="skip" ${session.index >= session.queue.length - 1 ? 'disabled' : ''}>Skip ${icon('arrow')}</button></div><p class="keyboard-tip"><kbd>Space</kbd> ${revealed ? 'Hide answer' : card.choices && !session.revealed ? 'Check answer' : 'Reveal answer'} <span class="footer-divider">/</span> <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Rate <span class="footer-divider">/</span> <kbd>←</kbd><kbd>→</kbd> Navigate <span class="footer-divider">/</span> <kbd>Esc</kbd> Library</p></div>`;
}

function choiceInputs(card, session) {
  const multiple = card.choices.filter(c => c.correct).length > 1;
  const revealed = session.revealed && !session.answerHidden;
  return `<fieldset class="choices"><legend>${session.revealed && session.answerHidden ? 'Your submitted choices are locked. Reveal the answer to review the result.' : multiple ? 'Select every correct answer, then check your answer.' : 'Choose one answer, then check your answer.'}</legend>${card.choices.map((choice, i) => {
    const selected = session.selected.includes(i);
    const label = revealed ? choice.correct ? 'Correct answer' : selected ? 'Your answer' : '' : '';
    return `<label class="choice ${revealed ? choice.correct ? 'correct' : selected ? 'incorrect' : '' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" name="answer-choice" value="${i}" ${selected ? 'checked' : ''} ${session.revealed ? 'disabled' : ''}><span class="choice-letter">${i < 26 ? String.fromCharCode(65 + i) : i + 1}</span><span class="choice-label">${displayText(choice.text)}</span>${label ? `<span class="choice-result-label">${label}</span>` : ''}</label>`;
  }).join('')}</fieldset>`;
}

function completeView() {
  const deck = activeDeck(state);
  if (!deck) return libraryView();
  const due = dueCards(deck).length;
  return `<section class="complete-panel"><div class="complete-symbol">${icon('check')}</div><h1>${due ? 'This round is complete.' : 'All caught up.'}</h1><p>${due ? 'Some skipped cards are still due. You can come back to them whenever you’re ready.' : `Nothing due in ${escape(deck.name)} right now. Your progress is saved, and your next review will be ready on ${escape(nextDue(deck))}.`}</p><div class="complete-facts"><div><strong>${number(deck.cards.length)}</strong><span>cards in this deck</span></div><div><strong>${number(due)}</strong><span>cards still due</span></div><div><strong>${number(deck.lastSessionReviews || 0)}</strong><span>reviews this round</span></div></div><div class="button-group">${button('library', 'Back to library', 'library', 'primary')}${due ? button('study', 'Review remaining', 'arrow', '', `data-id="${escape(deck.id)}"`) : button('stats', 'View statistics', 'chart')}</div></section>`;
}

function statsView() {
  const stats = state.stats, total = stats.total_cards_reviewed;
  const accuracy = total ? Math.round(100 * (stats.accuracy.good + stats.accuracy.easy) / total) : 0;
  const days = Array.from({length: 7}, (_, i) => { const date = new Date(); date.setDate(date.getDate() - 6 + i); return {date, count: stats.daily_reviews[dayKey(date)] || 0}; });
  const max = Math.max(...days.map(d => d.count), 1);
  return `<div class="page-heading"><div><h1>See your progress.</h1><p>Small sessions add up. Here’s what yours look like.</p></div>${button('library', 'Library', 'left')}</div>${overview([['cards', total, 'Total card reviews'], ['flame', visibleStreak(stats), 'Current streak in days'], ['check', accuracy, 'Good + Easy ratings (%)']])}<div class="stats-layout"><section class="stats-panel"><h2>Your last seven days</h2><p class="description">Cards reviewed each day</p><div class="history-chart" role="img" aria-label="${escape(days.map(d => `${dayKey(d.date)}: ${d.count} reviews`).join('; '))}">${days.map(d => `<div class="history-column"><span class="bar-count">${number(d.count)}</span><div class="history-bar" data-height="${Math.max(d.count ? 9 : 3, 115 * d.count / max)}"></div><span class="day-label">${escape(new Intl.DateTimeFormat(undefined, {weekday: 'short'}).format(d.date))}</span></div>`).join('')}</div><p class="description">${total ? 'Every review counts toward your daily goal.' : 'Your first review will appear here. Import a deck to begin.'}</p></section><section class="stats-panel"><h2>How your reviews felt</h2><p class="description">Your self-ratings, separate from choice accuracy.</p><div class="rating-distribution">${['hard', 'good', 'easy'].map(rating => `<div><div class="distribution-label"><span>${rating[0].toUpperCase() + rating.slice(1)}</span><span>${number(stats.accuracy[rating])} · ${total ? Math.round(100 * stats.accuracy[rating] / total) : 0}%</span></div><div class="distribution-track ${rating}"><div data-width="${total ? 100 * stats.accuracy[rating] / total : 0}"></div></div></div>`).join('')}</div></section><section class="stats-panel stats-bottom"><h2>A closer look</h2><div class="details-grid"><div><div class="stat-detail"><span>Longest streak</span><strong>${stats.longest_streak} days</strong></div><div class="stat-detail"><span>Completed sessions</span><strong>${number(stats.study_sessions)}</strong></div></div><div><div class="stat-detail"><span>Today’s reviews</span><strong>${number(stats.daily_reviews[dayKey()] || 0)} / ${state.preferences.daily_goal}</strong></div><div class="stat-detail"><span>Last studied</span><strong>${stats.last_study_date ? escape(stats.last_study_date) : 'Not yet'}</strong></div></div><div><div class="stat-detail"><span>Choice attempts</span><strong>${number(stats.choice_attempts)}</strong></div><div class="stat-detail"><span>Choice accuracy</span><strong>${stats.choice_attempts ? Math.round(100 * stats.choice_correct / stats.choice_attempts) + '%' : 'No attempts yet'}</strong></div></div></div></section></div>`;
}

function render(focus = false) {
  const focused = document.activeElement;
  const focusAction = focused?.dataset.action;
  const focusId = focused?.dataset.id;
  const choiceValue = focused?.name === 'answer-choice' ? focused.value : null;
  main.innerHTML = loadError ? `<section class="error-panel"><h1>Your workspace is protected.</h1><p>Revolv could not read the saved workspace. Export it before attempting recovery. Restoring a valid backup will replace the saved workspace only after your confirmation.</p><div class="button-group">${button('backup', 'Export saved data', 'download', 'primary')}${button('restore', 'Restore backup', 'upload')}</div></section>` : ({library: libraryView, study: studyView, complete: completeView, stats: statsView}[state.view] || libraryView)();
  for (const el of main.querySelectorAll('[data-width]')) el.style.width = `${Number(el.dataset.width)}%`;
  for (const el of main.querySelectorAll('[data-height]')) el.style.height = `${Number(el.dataset.height)}px`;
  const label = {library: 'My library', study: 'Study session', complete: 'Study session', stats: 'Statistics'}[state.view];
  document.querySelector('#save-status').innerHTML = `<span class="status-dot"></span>${loadError ? 'Saved data needs recovery' : 'Saved in this browser'}`;
  document.querySelector('#workspace-label').textContent = label || 'My library';
  document.title = `${label || 'My library'} · Revolv`;
  document.querySelector('#nav-library').classList.toggle('active', state.view !== 'stats');
  document.querySelector('#nav-stats').classList.toggle('active', state.view === 'stats');
  document.querySelector('#nav-library').setAttribute('aria-current', state.view !== 'stats' ? 'page' : 'false');
  document.querySelector('#nav-stats').setAttribute('aria-current', state.view === 'stats' ? 'page' : 'false');
  if (focus) main.focus({preventScroll: false});
  else if (choiceValue !== null) main.querySelector(`input[name="answer-choice"][value="${choiceValue}"]`)?.focus({preventScroll: true});
  else if (focusAction && main.contains(focused) === false) {
    [...main.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction && el.dataset.id === focusId)?.focus({preventScroll: true});
  }
}

function showDialog(title, body, actions = '') {
  document.querySelector('#dialog-content').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${actions ? `<div class="dialog-actions">${actions}</div>` : ''}`;
  if (!dialog.open) dialog.showModal();
}

function confirmAction(title, description, action, label, danger = false) {
  pendingAction = action;
  showDialog(title, `<p>${description}</p>`, `${button('close-dialog', 'Cancel')}${button('confirm', label, '', danger ? 'danger' : 'primary')}`);
}

function formatGuide() {
  showDialog('Your decks, in Markdown.', `<p>Keep using the same flashcard format as the desktop app. Separate a question from its answer with <strong>?</strong> on its own line, and cards with <strong>---</strong>.</p><pre class="format-code">## MODULE 1
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
Both 2 and 3 have exactly two factors.</pre><h3 class="guide-title">Numbered A–D quizzes</h3><p>You can also import numbered questions with four options labeled A–D and a separate <strong>## Answer Key</strong> section. Each question needs exactly one correct letter. This format does not need ? or --- separators.</p><pre class="format-code">1. Which discipline studies morality?
   A. Physics
   B. Ethics
   C. Chemistry
   D. Astronomy

## Answer Key
1. B — Ethics studies moral principles.</pre><h3 class="guide-title">Single choice or select all</h3><p>Put checklist options after the question and before <strong>?</strong>. Mark correct options with <strong>[x]</strong> and others with <strong>[ ]</strong>. One correct option creates a single-choice question; several create “select all that apply.” Every choice card needs at least two options and one correct answer. An explanation after <strong>?</strong> is optional for choice cards.</p><p>Reimport a file with the same name to update its deck. Matching flashcards keep their review progress. Changing a choice card’s options or answer key creates a fresh card.</p>`, button('close-dialog', 'Got it', '', 'primary'));
}

function studyGuide() {
  showDialog('A rhythm that helps you remember.', `<p>Import a Markdown deck, study the cards due now, and take a moment to recall before revealing the answer.</p><ul><li><strong>Hard:</strong> keep the card due and see it again later in this session.</li><li><strong>Good:</strong> schedule the next review using spaced repetition.</li><li><strong>Easy:</strong> give a familiar card a longer interval.</li></ul><p>For choice questions, select your answer and check it. Select all correct options when prompted. Then choose a review rating.</p><h3 class="guide-title">Your progress stays with you</h3><p>Decks, selections, schedules, and unfinished sessions are saved after every action. They survive closing this browser. Use the same browser and site address when you return. Clearing site data or using private browsing can remove progress. Export backups to keep another copy.</p><h3 class="guide-title">Keyboard shortcuts</h3><div class="shortcut-list"><span><kbd>Space</kbd>Reveal / hide / check</span><span><kbd>1 2 3</kbd>Hard / Good / Easy</span><span><kbd>← →</kbd>Previous / skip</span><span><kbd>Esc</kbd>Back to library</span><span><kbd>Ctrl S</kbd>Statistics</span><span><kbd>Tab</kbd>Move between controls</span></div>`, `${button('format', 'Deck format', 'cards')}${button('close-dialog', 'Ready to study', '', 'primary')}`);
}

function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    download(raw || JSON.stringify(state, null, 2), `revolv-backup-${dayKey()}.json`);
    toast('Backup downloaded. Keep it somewhere safe.');
  } catch (error) {
    showNotice('This browser is blocking access to saved data. Allow site storage, then export again.');
  }
}

const exampleDeck = `## MODULE 1
### Getting started
#flashcards
Revolv keeps your decks and study progress in this location.
?
Your browser’s local storage. Use the same browser and site address to return.

---
Which rating brings a card back in this session?
- [x] Hard
- [ ] Good
- [ ] Easy
?
Hard keeps a card due. Good and Easy schedule future reviews.

---
Select the things Revolv saves automatically.
- [x] Your review progress
- [x] Your unfinished session
- [ ] Your browser passwords
?
Revolv saves your decks, progress, sessions, and study statistics. It never reads your passwords.

---
How can you update a Markdown deck without losing matching cards’ progress?
?
Reimport the file using the same filename, or choose “Update from file” in its deck menu.

---
The best time to try recalling an answer is before or after revealing it?
?
Before. Make an attempt first, then reveal and choose an honest rating.

---
Which action keeps a separate copy of your saved workspace?
- [ ] Shuffle
- [x] Export backup
- [ ] Reset progress
?
Export backup downloads your decks, progress, statistics, and sessions as a JSON file.
`;

async function handleAction(action, target) {
  if (busy && !['backup', 'close-dialog'].includes(action)) return;
  const id = target?.dataset.id;
  switch (action) {
    case 'library':
    case 'stats':
      await transact(draft => { draft.view = action; }, {focus: true}); break;
    case 'study':
      await transact(draft => { startSession(draft, id); }, {focus: true}); break;
    case 'shuffle':
      if (await transact(draft => { draft.preferences.randomize = !draft.preferences.randomize; })) toast(`New sessions will use ${state.preferences.randomize ? 'shuffled' : 'ordered'} cards. Resumed sessions keep their order.`);
      break;
    case 'reveal':
      if (!currentCard(state) || (activeDeck(state).session.revealed && !activeDeck(state).session.answerHidden)) break;
      await transact(draft => {
        const session = activeDeck(draft).session;
        if (!session.revealed) {
          if (currentCard(draft).choices) submitChoices(draft);
          else session.revealed = true;
        }
        session.answerHidden = false;
      }, {focus: true}); break;
    case 'hide-answer':
      if (currentCard(state) && activeDeck(state).session.revealed) {
        await transact(draft => { activeDeck(draft).session.answerHidden = true; }, {focus: true});
      }
      break;
    case 'rate':
      if (currentCard(state) && activeDeck(state).session.revealed && !activeDeck(state).session.answerHidden) await transact(draft => { rateCurrent(draft, Number(target.dataset.rating)); }, {focus: true}); break;
    case 'previous':
    case 'skip':
      await transact(draft => { navigateSession(draft, action); }, {focus: true}); break;
    case 'import': updateTarget = null; deckInput.value = ''; deckInput.multiple = true; deckInput.click(); break;
    case 'update-deck': updateTarget = id; deckInput.value = ''; deckInput.multiple = false; deckInput.click(); break;
    case 'remove-deck': {
      const deck = state.decks.find(d => d.id === id); if (!deck) break;
      confirmAction('Remove this deck?', `Remove <strong>${escape(deck.name)}</strong> from your library? Its progress will be retained in this browser, so importing the same filename restores it.`, async () => transact(draft => { draft.decks.find(d => d.id === id).archived = true; if (draft.activeDeckId === id) { draft.activeDeckId = null; draft.view = 'library'; } }), 'Remove deck');
      break;
    }
    case 'reset-deck': {
      const deck = state.decks.find(d => d.id === id); if (!deck) break;
      confirmAction('Reset review progress?', `Mark all cards in <strong>${escape(deck.name)}</strong> as new and clear its unfinished session? Your overall study statistics are kept. Export a backup first if you want to restore the previous schedule.`, async () => transact(draft => { resetProgress(draft.decks.find(d => d.id === id)); draft.view = 'library'; }), 'Reset progress', true);
      break;
    }
    case 'example':
      if (await transact(draft => { importDeck(draft, 'Revolv essentials.md', exampleDeck); })) toast('Example deck added. Choose Study deck to begin.'); break;
    case 'guide': studyGuide(); break;
    case 'format': formatGuide(); break;
    case 'backup': exportBackup(); break;
    case 'restore': backupInput.value = ''; backupInput.click(); break;
    case 'close-dialog': dialog.close(); pendingAction = null; break;
    case 'confirm':
      if (pendingAction && await pendingAction()) { dialog.close(); pendingAction = null; toast('Workspace saved.'); }
      break;
    case 'reload': readSavedState(); if (!loadError) notice.hidden = true; render(true); break;
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target && !target.disabled) {
    event.preventDefault();
    const menu = target.closest('.deck-menu'); if (menu) menu.open = false;
    void handleAction(target.dataset.action, target);
  }
  if (event.target.closest('.brand')) { event.preventDefault(); void handleAction('library'); }
  for (const menu of document.querySelectorAll('.deck-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});

document.addEventListener('change', event => {
  if (event.target.name !== 'answer-choice' || busy) return;
  const value = Number(event.target.value), checked = event.target.checked;
  void transact(draft => {
    const card = currentCard(draft), session = activeDeck(draft).session;
    if (session.revealed) return;
    if (card.choices.filter(c => c.correct).length === 1) session.selected = [value];
    else session.selected = checked ? [...new Set([...session.selected, value])] : session.selected.filter(i => i !== value);
  });
});

async function importFiles(files) {
  if (!files.length) return;
  try {
    if (files.some(f => f.size > 2 * 1024 * 1024)) throw new Error('Each Markdown file must be smaller than 2 MB. Split large decks into smaller files.');
    if (files.some(f => !/\.(md|markdown|txt)$/i.test(f.name))) throw new Error('Choose a .md, .markdown, or .txt deck file. Use Restore backup for JSON files.');
    const targetId = updateTarget;
    const contents = await Promise.all(files.map(f => f.text()));
    const hasExisting = targetId || files.some(f => state.decks.some(d => d.filename === f.name));
    const applyImport = async () => transact(draft => {
      files.forEach((file, i) => { importDeck(draft, file.name, contents[i], new Date(), i === 0 ? targetId : null); });
      draft.view = 'library';
    }, {focus: true});
    if (hasExisting) {
      confirmAction('Update existing decks?', 'A selected file matches a deck already saved here. Matching cards keep their progress. Changed or removed cards and unfinished sessions are replaced by the new content.', applyImport, 'Update decks');
    } else if (await applyImport()) toast(`${files.length === 1 ? 'Deck' : `${files.length} decks`} imported. Ready to study.`);
  } catch (error) { showNotice(error.message); }
  finally { updateTarget = null; deckInput.value = ''; }
}

deckInput.addEventListener('change', () => { void importFiles([...deckInput.files]); });
backupInput.addEventListener('change', async () => {
  const file = backupInput.files[0]; if (!file) return;
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error('This backup is too large. Choose a Revolv backup smaller than 16 MB.');
    const backup = validateState(JSON.parse(await file.text()));
    confirmAction('Restore this workspace?', `Replace this browser’s workspace with <strong>${backup.decks.filter(d => !d.archived).length} decks</strong> and <strong>${number(backup.stats.total_cards_reviewed)} reviews</strong> from this backup? Export the current workspace first if you want to keep it.`, async () => transact(() => backup, {focus: true, restore: true}), 'Restore workspace', true);
  } catch (error) { showNotice(error instanceof SyntaxError ? 'This file is not valid JSON. Choose an exported Revolv backup. Your workspace has not changed.' : error.message); }
  finally { backupInput.value = ''; }
});

document.addEventListener('keydown', event => {
  if (dialog.open || event.repeat || event.altKey || event.isComposing) return;
  const el = event.target;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void handleAction('stats'); return; }
  if (el.matches('input,textarea,select,[contenteditable=true]')) return;
  if (event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape' && ['study', 'complete'].includes(state.view)) { event.preventDefault(); void handleAction('library'); return; }
  if (state.view !== 'study') return;
  if (event.key === ' ' && !el.closest('button,a,summary')) { event.preventDefault(); void handleAction(activeDeck(state).session.revealed && !activeDeck(state).session.answerHidden ? 'hide-answer' : 'reveal'); }
  else if (['1', '2', '3'].includes(event.key)) { event.preventDefault(); void handleAction('rate', {dataset: {rating: event.key}}); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); void handleAction('previous'); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); void handleAction('skip'); }
});

main.addEventListener('dragover', event => { if (state.view === 'library') { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
main.addEventListener('drop', event => { event.preventDefault(); if (state.view === 'library') { updateTarget = null; void importFiles([...event.dataTransfer.files]); } });
dialog.addEventListener('cancel', () => { pendingAction = null; });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { dialog.close(); pendingAction = null; } } });
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) showNotice('Your saved workspace changed in another tab. Reload it before continuing so no progress is overwritten.', 'reload'); });
readSavedState();
render();
