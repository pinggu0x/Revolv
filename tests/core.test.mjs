import test from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../core.mjs';
const now = new Date('2026-10-04T12:00:00');
const markdown = '## MODULE 1\n### Cells\n#flashcards\nWhat is a cell?\n?\nThe basic unit of life.\n<!--SR:ignored-->\n---\nName two types.\n?\nProkaryotic\nEukaryotic';
const numberedQuiz = `# Quiz
## Module 1: Ethics
### Foundations
1. Which discipline studies morality?
   A. Physics
   B. Ethics
   C. Chemistry
   D. Astronomy

2. Which number is even?
   A. 1
   B. 3
   C. 4
   D. 5

## Answer Key
1. B — Ethics
2. C — Divisible by two.
`;
function setup(count = 4) {
  const state = core.createState();
  const text = Array.from({length: count}, (_, i) => `Question ${i}\n?\nAnswer ${i}`).join('\n---\n');
  const deck = core.importDeck(state, 'Biology.md', text, now);
  core.startSession(state, deck.id, now);
  return {state, deck};
}

test('parses desktop Markdown with module, section, multiline answer and final card', () => {
  const cards = core.parseMarkdown(markdown, now);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].module, 'MODULE 1');
  assert.equal(cards[0].section, 'Cells');
  assert.equal(cards[1].answer, 'Prokaryotic\nEukaryotic');
  assert.equal(cards[0].due_date, now.toISOString());
});

test('imports numbered A–D quizzes with a separate answer key as single-choice cards', () => {
  const state = core.createState();
  const deck = core.importDeck(state, 'quiz.md', numberedQuiz, now);
  assert.equal(deck.cards.length, 2);
  assert.equal(deck.cards[0].question, 'Which discipline studies morality?');
  assert.equal(deck.cards[0].module, 'Module 1: Ethics');
  assert.equal(deck.cards[0].section, 'Foundations');
  assert.deepEqual(deck.cards[0].choices.map(c => c.correct), [false, true, false, false]);
  assert.equal(deck.cards[1].answer, 'Divisible by two.');
  core.startSession(state, deck.id, now);
  deck.session.selected = [1];
  assert.equal(core.submitChoices(state), true);
  assert.doesNotThrow(() => core.validateState(state));
});

test('numbered quizzes reject missing, duplicate, invalid and unknown answer keys atomically', () => {
  const cases = [
    [numberedQuiz.replace('2. C — Divisible by two.', ''), /answer.*2|2.*answer/i],
    [numberedQuiz + '1. A\n', /duplicate/i],
    [numberedQuiz.replace('2. C —', '2. E —'), /answer key/i],
    [numberedQuiz + '3. A\n', /unknown|no question/i],
    [numberedQuiz.replace('   D. Astronomy\n', ''), /A.*D|four options/i],
    [numberedQuiz.split('## Answer Key')[0], /answer key/i],
    [numberedQuiz.replace('2. Which number', '1. Which number'), /duplicate/i],
  ];
  for (const [text, message] of cases) {
    const state = core.createState();
    assert.throws(() => core.importDeck(state, 'quiz.md', text, now), message);
    assert.equal(state.decks.length, 0);
  }
});

test('answer keys can omit explanations and reimport preserves matching quiz progress', () => {
  const state = core.createState();
  const text = numberedQuiz.replace('1. B — Ethics', '1. B').replace('2. C — Divisible by two.', '2. C');
  const deck = core.importDeck(state, 'quiz.md', text, now);
  assert.equal(deck.cards[0].answer, 'Ethics');
  core.startSession(state, deck.id, now);
  core.rateCurrent(state, 3, now);
  core.importDeck(state, 'quiz.md', text, now);
  assert.equal(state.decks[0].cards[0].interval, 3);
});
test('empty decks are rejected and duplicate questions have separate identities', () => {
  const state = core.createState();
  assert.throws(() => core.importDeck(state, 'Empty.md', 'No separator', now), /No flashcards/);
  assert.equal(state.decks.length, 0);
  const cards = core.parseMarkdown('Same\n?\nFirst\n---\nSame\n?\nSecond', now);
  assert.notEqual(cards[0].id, cards[1].id);
});
test('Good schedules new cards for one day, then six days, and previews agree', () => {
  const {state, deck} = setup(1);
  assert.equal(core.intervals(deck.cards[0]).good, 1);
  core.rateCurrent(state, 2, now);
  assert.equal(deck.cards[0].interval, 1);
  assert.equal(new Date(deck.cards[0].due_date) - now, 86400000);
  const later = new Date(now.getTime() + 86400001);
  core.startSession(state, deck.id, later);
  assert.equal(core.intervals(deck.cards[0]).good, 6);
  core.rateCurrent(state, 2, later);
  assert.equal(deck.cards[0].interval, 6);
});
test('Easy schedules three and eight days and mature intervals use adjusted ease', () => {
  const {state, deck} = setup(1);
  core.rateCurrent(state, 3, now);
  assert.equal(deck.cards[0].interval, 3);
  core.startSession(state, deck.id, new Date(now.getTime() + 3 * 86400000));
  assert.equal(core.intervals(deck.cards[0]).easy, 8);
  core.rateCurrent(state, 3, new Date(now.getTime() + 3 * 86400000));
  assert.equal(deck.cards[0].interval, 8);
  deck.cards[0].repetitions = 4;
  deck.cards[0].interval = 10;
  deck.cards[0].ease_factor = 2.5;
  assert.equal(core.intervals(deck.cards[0]).good, 24);
  assert.equal(core.intervals(deck.cards[0]).easy, 34);
});
test('Hard stays due and returns three to five cards later, including single-card queues', () => {
  const {state, deck} = setup(6);
  const first = deck.cards[0].id;
  core.rateCurrent(state, 1, now, () => 0);
  assert.equal(deck.session.queue[3], first);
  assert.equal(deck.session.index, 0);
  assert.equal(deck.cards[0].repetitions, 0);
  assert.equal(deck.cards[0].interval, 0);
  assert.equal(core.dueCards(deck, now).length, 6);
  const single = setup(1);
  core.rateCurrent(single.state, 1, now);
  assert.equal(single.deck.session.queue.length, 1);
  assert.equal(single.deck.session.index, 0);
});
test('skip and previous preserve ratings, use stable history, and cannot skip the last card', () => {
  const {state, deck} = setup(3);
  core.navigateSession(state, 'skip');
  assert.equal(deck.session.index, 1);
  core.navigateSession(state, 'previous');
  assert.equal(deck.session.index, 0);
  assert.equal(state.stats.total_cards_reviewed, 0);
  core.navigateSession(state, 'skip');
  core.navigateSession(state, 'skip');
  core.navigateSession(state, 'skip');
  assert.equal(deck.session.index, 2);
});
test('saved sessions survive JSON round trip with answer, order and current position', () => {
  const {state, deck} = setup(4);
  core.rateCurrent(state, 2, now);
  deck.session.revealed = true;
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  const restoredDeck = restored.decks[0];
  core.startSession(restored, restoredDeck.id, now);
  assert.equal(restoredDeck.session.queue[restoredDeck.session.index], deck.cards[1].id);
  assert.equal(restoredDeck.session.revealed, true);
  assert.equal(restoredDeck.session.queue.length, 3);
  assert.equal(restored.stats.total_cards_reviewed, 1);
});
test('reimport preserves matching progress and removed decks can be recovered', () => {
  const {state, deck} = setup(2);
  core.rateCurrent(state, 3, now);
  deck.archived = true;
  const updated = core.importDeck(state, 'Biology.md', 'Question 0\n?\nUpdated answer\n---\nNew question\n?\nNew answer', now);
  assert.equal(state.decks.length, 1);
  assert.equal(updated.archived, false);
  assert.equal(updated.cards[0].answer, 'Updated answer');
  assert.equal(updated.cards[0].interval, 3);
  assert.equal(updated.cards[1].repetitions, 0);
});
test('shuffle keeps every due card exactly once and excludes future cards', () => {
  const {state, deck} = setup(5);
  deck.session = null;
  deck.cards[0].due_date = new Date(now.getTime() + 86400000).toISOString();
  state.preferences.randomize = true;
  core.startSession(state, deck.id, now, () => 0);
  assert.equal(deck.session.queue.length, 4);
  assert.equal(new Set(deck.session.queue).size, 4);
  assert.ok(!deck.session.queue.includes(deck.cards[0].id));
  assert.notDeepEqual(deck.session.queue, deck.cards.slice(1).map(c => c.id));
});
test('statistics track ratings, daily goals and consecutive-day streaks', () => {
  const {state, deck} = setup(4);
  core.rateCurrent(state, 1, now);
  core.rateCurrent(state, 2, now);
  assert.equal(state.stats.current_streak, 1);
  assert.equal(state.stats.daily_reviews[core.dayKey(now)], 2);
  const tomorrow = new Date(now.getTime() + 86400000);
  core.rateCurrent(state, 3, tomorrow);
  assert.equal(state.stats.current_streak, 2);
  core.rateCurrent(state, 3, new Date(now.getTime() + 4 * 86400000));
  assert.equal(state.stats.current_streak, 1);
  assert.equal(state.stats.longest_streak, 2);
  assert.deepEqual(state.stats.accuracy, {hard: 1, good: 1, easy: 2});
});
test('malformed persisted data is rejected instead of silently clearing progress', () => {
  assert.throws(() => core.validateState({version: 99}), /backup|data/i);
  const {state} = setup();
  state.decks[0].cards[0].due_date = 'bad date';
  assert.throws(() => core.validateState(state), /backup|data/i);
});

test('single-choice and multiple-choice cards parse alongside original flashcards', () => {
  const cards = core.parseMarkdown('Capital of France?\n- [ ] Rome\n- [x] Paris\n?\nParis is the capital.\n---\nSelect primes.\n- [x] 2\n- [x] 3\n- [ ] 4\n?\n---\nPlain question\n?\nPlain answer', now);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].question, 'Capital of France?');
  assert.deepEqual(cards[0].choices, [{text: 'Rome', correct: false}, {text: 'Paris', correct: true}]);
  assert.equal(cards[1].choices.filter(c => c.correct).length, 2);
  assert.equal(cards[2].choices, undefined);
});
test('malformed choice cards reject the import instead of dropping cards', () => {
  for (const text of ['Q\n- [ ] A\n- [ ] B\n?\nExplain', 'Q\n- [x] A\n?\nExplain']) {
    assert.throws(() => core.parseMarkdown(text, now), /choice|option/i);
  }
});
test('choice submission requires a selection and checks exact sets without scheduling', () => {
  const state = core.createState();
  const deck = core.importDeck(state, 'Choices.md', 'Select primes\n- [x] 2\n- [x] 3\n- [ ] 4\n?\nOnly 2 and 3 are prime.', now);
  core.startSession(state, deck.id, now);
  assert.throws(() => core.submitChoices(state), /select|choose/i);
  deck.session.selected = [0];
  assert.equal(core.submitChoices(state), false);
  assert.equal(deck.session.revealed, true);
  assert.equal(deck.cards[0].repetitions, 0);
  assert.equal(state.stats.choice_attempts, 1);
  assert.equal(state.stats.choice_correct, 0);
  core.submitChoices(state);
  assert.equal(state.stats.choice_attempts, 1);
  deck.session.revealed = false;
  deck.session.selected = [1, 0];
  assert.equal(core.submitChoices(state), true);
  assert.equal(state.stats.choice_correct, 1);
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.decks[0].session.selected, [1, 0]);
  restored.decks[0].session.selected = [99];
  assert.throws(() => core.validateState(restored), /data|backup/i);
});

test('resuming past a no-longer-due choice card clears its selection for the next card', () => {
  const state = core.createState();
  const deck = core.importDeck(state, 'Mixed.md', 'Choice\n- [ ] No\n- [x] Yes\n?\n---\nPlain\n?\nAnswer', now);
  core.startSession(state, deck.id, now);
  deck.session.selected = [1];
  deck.session.revealed = true;
  deck.cards[0].due_date = new Date(now.getTime() + 86400000).toISOString();
  core.startSession(state, deck.id, now);
  assert.equal(core.currentCard(state).question, 'Plain');
  assert.equal(deck.session.revealed, false);
  assert.deepEqual(deck.session.selected, []);
  assert.doesNotThrow(() => core.validateState(state));
});
