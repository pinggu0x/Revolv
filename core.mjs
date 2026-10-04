// Revolv study model. No DOM, network requests, or storage side effects.
export const STORAGE_KEY = 'revolv.browser.v1';
export const DAY = 86400000;

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createState() {
  return {
    version: 1,
    decks: [],
    preferences: {randomize: false, daily_goal: 20},
    stats: {
      total_cards_reviewed: 0, study_sessions: 0, current_streak: 0,
      longest_streak: 0, last_study_date: null, daily_reviews: {},
      accuracy: {hard: 0, good: 0, easy: 0},
      choice_attempts: 0, choice_correct: 0,
    },
    view: 'library', activeDeckId: null,
  };
}

function newCard(question, answer, module, section, now, occurrence) {
  return {
    id: JSON.stringify([module, section, question, occurrence]),
    question, answer, module, section,
    due_date: now.toISOString(), interval: 0, ease_factor: 2.5, repetitions: 0,
  };
}

export function parseMarkdown(content, now = new Date()) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim());
  if (!lines.includes('?') && lines.some(line => /^[A-D][.)]\s+/.test(line))) {
    return parseNumberedQuiz(lines, now);
  }
  const cards = [];
  const occurrences = new Map();
  let module = '', section = '', question = [], answer = [], inAnswer = false;
  function flush() {
    const q = question.join('\n').trim(), a = answer.join('\n').trim();
    const choices = [];
    const prompt = [];
    for (const line of question) {
      const match = line.match(/^[-*] \[([ xX])\]\s+(.+)$/);
      if (match) choices.push({text: match[2], correct: match[1].toLowerCase() === 'x'});
      else {
        if (choices.length) throw new Error('Choice options must come after the full question and before the ? separator.');
        prompt.push(line);
      }
    }
    if (choices.length && (choices.length < 2 || !choices.some(c => c.correct) || !prompt.length || !inAnswer)) {
      throw new Error('A choice card needs a question, at least two options, at least one [x] correct option, and a ? separator.');
    }
    if (q && (a || choices.length)) {
      const key = JSON.stringify([module, section, q]);
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      const card = newCard(q, a, module, section, now, occurrence);
      if (choices.length) { card.question = prompt.join('\n'); card.choices = choices; }
      cards.push(card);
    }
    question = []; answer = []; inAnswer = false;
  }
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## MODULE')) { module = line.replace(/^##\s*/, ''); section = ''; continue; }
    if (line.startsWith('###')) { section = line.replace(/^###\s*/, ''); continue; }
    if (line.startsWith('#flashcards') || line.startsWith('<!--SR:')) continue;
    if (line === '---') { flush(); continue; }
    if (line === '?') { inAnswer = true; continue; }
    if (line) (inAnswer ? answer : question).push(line);
  }
  flush();
  return cards;
}

function parseNumberedQuiz(lines, now) {
  const keyStart = lines.findIndex(line => /^#{1,6}\s+Answer\s+Key\s*#*$/i.test(line));
  if (keyStart < 0) throw new Error('This A–D quiz needs an Answer Key section, with entries such as 1. B.');
  const answers = new Map();
  for (const line of lines.slice(keyStart + 1)) {
    if (!line || line === '---') continue;
    const match = line.match(/^(\d+)[.)]\s*([A-D])(?:\s*[—–:\-]\s*(.*))?$/i);
    if (!match) throw new Error(`Invalid answer key entry: ${line}. Use a question number and one letter A–D, such as 1. B.`);
    const id = Number(match[1]);
    if (answers.has(id)) throw new Error(`Duplicate answer key entry for question ${id}.`);
    answers.set(id, {letter: match[2].toUpperCase(), explanation: match[3] || ''});
  }
  const questions = [], numbers = new Set();
  let module = '', section = '', current = null;
  function flush() {
    if (!current) return;
    if (current.options.map(option => option.letter).join('') !== 'ABCD') {
      throw new Error(`Question ${current.number} needs four options labeled A, B, C, D in order.`);
    }
    questions.push(current); current = null;
  }
  for (const line of lines.slice(0, keyStart)) {
    if (!line || line === '---' || line.startsWith('<!--SR:')) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      if (heading[1].length === 2) { module = heading[2]; section = ''; }
      else if (heading[1].length >= 3) section = heading[2];
      continue;
    }
    if (line.startsWith('#')) continue;
    const question = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (question) {
      flush();
      const id = Number(question[1]);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('Question numbers must be positive integers.');
      if (numbers.has(id)) throw new Error(`Duplicate question number ${id}.`);
      numbers.add(id);
      current = {number: id, question: question[2], module, section, options: []};
      continue;
    }
    const option = line.match(/^([A-D])[.)]\s+(.+)$/);
    if (option) {
      if (!current) throw new Error('An A–D option appears without a numbered question.');
      current.options.push({letter: option[1], text: option[2]});
    } else if (current) {
      if (current.options.length) current.options.at(-1).text += '\n' + line;
      else current.question += '\n' + line;
    }
  }
  flush();
  for (const id of answers.keys()) if (!numbers.has(id)) throw new Error(`Answer key refers to unknown question ${id}.`);
  const occurrences = new Map();
  return questions.map(question => {
    const answer = answers.get(question.number);
    if (!answer) throw new Error(`Missing answer key entry for question ${question.number}.`);
    const choices = question.options.map(option => ({text: option.text, correct: option.letter === answer.letter}));
    // Use the same identity as checklist cards; numbering is not study content.
    const source = [question.question, ...choices.map(c => `- [${c.correct ? 'x' : ' '}] ${c.text}`)].join('\n');
    const key = JSON.stringify([question.module, question.section, source]);
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    const card = newCard(source, answer.explanation || choices.find(c => c.correct).text, question.module, question.section, now, occurrence);
    card.question = question.question; card.choices = choices;
    return card;
  });
}

export function importDeck(state, filename, content, now = new Date(), targetId = null) {
  const cards = parseMarkdown(content, now);
  if (!cards.length) throw new Error('No flashcards found. Use question/answer cards with ? and ---, or numbered A–D questions with an Answer Key section.');
  const existing = targetId ? state.decks.find(d => d.id === targetId) : state.decks.find(d => d.filename === filename);
  if (targetId && !existing) throw new Error('This deck no longer exists. Return to the library and import again.');
  if (existing) {
    const progress = new Map(existing.cards.map(c => [c.id, c]));
    for (const card of cards) {
      const saved = progress.get(card.id);
      if (saved) for (const field of ['due_date', 'interval', 'ease_factor', 'repetitions']) card[field] = saved[field];
    }
    existing.cards = cards;
    existing.filename = filename;
    existing.archived = false;
    existing.updated = now.toISOString();
    // Content updates invalidate answer/selection state; schedules remain intact.
    existing.session = null;
    return existing;
  }
  const deck = {
    id: crypto.randomUUID(), filename,
    name: filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    cards, archived: false, session: null, updated: now.toISOString(),
  };
  state.decks.push(deck);
  return deck;
}

export function dueCards(deck, now = new Date()) {
  return deck.cards.filter(c => new Date(c.due_date) <= now)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
}

export function activeDeck(state) {
  return state.decks.find(d => d.id === state.activeDeckId && !d.archived) || null;
}

export function currentCard(state) {
  const deck = activeDeck(state);
  return deck?.session ? deck.cards.find(c => c.id === deck.session.queue[deck.session.index]) || null : null;
}

export function startSession(state, id, now = new Date(), random = Math.random) {
  const deck = state.decks.find(d => d.id === id && !d.archived);
  if (!deck) throw new Error('Deck not found.');
  const due = dueCards(deck, now);
  const dueIds = new Set(due.map(c => c.id));
  if (deck.session) {
    const old = deck.session;
    const current = old.queue[old.index];
    const queue = old.queue.filter(key => dueIds.has(key));
    const index = old.queue.slice(0, old.index).filter(key => dueIds.has(key)).length;
    deck.session = queue.length && index < queue.length ? {
      ...old, queue, index, history: old.history.filter(key => dueIds.has(key)),
      revealed: current === queue[index] && old.revealed,
      selected: current === queue[index] ? old.selected : [],
      answerHidden: current === queue[index] && !!old.answerHidden,
    } : null;
  }
  if (!deck.session && due.length) {
    const queue = due.map(c => c.id);
    if (state.preferences.randomize) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    deck.session = {queue, index: 0, history: [], revealed: false, selected: [], reviewed: 0};
  }
  state.activeDeckId = id;
  state.view = deck.session ? 'study' : 'complete';
  return deck.session;
}

export function intervals(card) {
  let good, easy;
  if (card.repetitions === 0) { good = 1; easy = 3; }
  else if (card.repetitions === 1) { good = 6; easy = 8; }
  else {
    good = Math.floor(card.interval * Math.max(1.3, card.ease_factor - 0.05));
    easy = Math.floor(card.interval * (card.ease_factor + 0.15) * 1.3);
  }
  return {good, easy};
}

function updateStatistics(stats, rating, now) {
  const today = dayKey(now);
  stats.total_cards_reviewed++;
  stats.daily_reviews[today] = (stats.daily_reviews[today] || 0) + 1;
  stats.accuracy[['hard', 'good', 'easy'][rating - 1]]++;
  if (stats.last_study_date !== today) {
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    stats.current_streak = stats.last_study_date === dayKey(yesterday) ? stats.current_streak + 1 : 1;
    stats.last_study_date = today;
    stats.longest_streak = Math.max(stats.longest_streak, stats.current_streak);
  }
}

export function rateCurrent(state, rating, now = new Date(), random = Math.random) {
  const deck = activeDeck(state), card = currentCard(state);
  if (!card || ![1, 2, 3].includes(rating)) throw new Error('Choose Hard, Good, or Easy for the current card.');
  const session = deck.session;
  const next = intervals(card);
  if (rating === 1) {
    card.ease_factor = Math.max(1.3, card.ease_factor - 0.15);
    card.repetitions = Math.max(0, card.repetitions - 1);
    card.interval = 0;
    card.due_date = now.toISOString();
    session.queue.splice(session.index, 1);
    session.queue.splice(Math.min(session.index + 3 + Math.floor(random() * 3), session.queue.length), 0, card.id);
  } else {
    card.interval = rating === 2 ? next.good : next.easy;
    card.ease_factor = rating === 2 ? Math.max(1.3, card.ease_factor - 0.05) : card.ease_factor + 0.15;
    card.repetitions++;
    const due = new Date(now.getTime() + card.interval * DAY);
    if (!Number.isFinite(due.getTime())) throw new Error('Review date is outside the supported range. Export your data and reset this deck.');
    card.due_date = due.toISOString();
    session.history.push(card.id);
    session.index++;
  }
  session.reviewed++;
  session.revealed = false;
  session.answerHidden = false;
  session.selected = [];
  updateStatistics(state.stats, rating, now);
  if (session.index >= session.queue.length) {
    deck.lastSessionReviews = session.reviewed;
    deck.session = null;
    state.stats.study_sessions++;
    state.view = 'complete';
  }
}

export function navigateSession(state, direction) {
  const deck = activeDeck(state), card = currentCard(state);
  if (!card) return;
  const session = deck.session;
  if (direction === 'skip' && session.index < session.queue.length - 1) {
    session.history.push(card.id);
    session.index++;
  } else if (direction === 'previous' && session.history.length) {
    const previous = session.history.pop();
    const index = session.queue.indexOf(previous);
    if (index >= 0) session.index = index;
  } else return;
  session.revealed = false;
  session.answerHidden = false;
  session.selected = [];
}

export function choiceResult(card, selected) {
  const correct = card.choices.map((choice, index) => choice.correct ? index : -1).filter(index => index >= 0);
  return selected.length === correct.length && correct.every(index => selected.includes(index));
}

export function submitChoices(state) {
  const deck = activeDeck(state), card = currentCard(state);
  if (!card?.choices) throw new Error('This is not a choice card.');
  if (!deck.session.selected.length) throw new Error('Select an answer before checking it.');
  if (!deck.session.selected.every(index => Number.isInteger(index) && index >= 0 && index < card.choices.length)) {
    throw new Error('Choose one of the available options.');
  }
  const correct = choiceResult(card, deck.session.selected);
  if (!deck.session.revealed) {
    state.stats.choice_attempts++;
    if (correct) state.stats.choice_correct++;
    deck.session.revealed = true;
  }
  return correct;
}

export function resetProgress(deck, now = new Date()) {
  for (const card of deck.cards) {
    card.due_date = now.toISOString(); card.interval = 0;
    card.ease_factor = 2.5; card.repetitions = 0;
  }
  deck.session = null;
  deck.lastSessionReviews = 0;
}

export function visibleStreak(stats, now = new Date()) {
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return [dayKey(now), dayKey(yesterday)].includes(stats.last_study_date) ? stats.current_streak : 0;
}

export function validateState(value) {
  const invalid = () => { throw new Error('This backup or saved data is not a valid Revolv web app file. Your existing data has not been changed.'); };
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const text = x => typeof x === 'string';
  const count = x => Number.isSafeInteger(x) && x >= 0;
  const date = x => text(x) && Number.isFinite(new Date(x).getTime());
  if (!object(value) || value.version !== 1 || !Array.isArray(value.decks) ||
      !object(value.preferences) || typeof value.preferences.randomize !== 'boolean' ||
      !count(value.preferences.daily_goal) || value.preferences.daily_goal < 1 ||
      !['library', 'study', 'stats', 'complete'].includes(value.view) ||
      !(value.activeDeckId === null || text(value.activeDeckId))) invalid();
  const stats = value.stats;
  if (!object(stats) || !object(stats.accuracy) || !object(stats.daily_reviews) ||
      !['total_cards_reviewed', 'study_sessions', 'current_streak', 'longest_streak', 'choice_attempts', 'choice_correct'].every(k => count(stats[k])) ||
      stats.choice_correct > stats.choice_attempts ||
      !['hard', 'good', 'easy'].every(k => count(stats.accuracy[k])) ||
      !(stats.last_study_date === null || /^\d{4}-\d{2}-\d{2}$/.test(stats.last_study_date)) ||
      !Object.entries(stats.daily_reviews).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && count(v))) invalid();
  const deckIds = new Set();
  for (const deck of value.decks) {
    if (!object(deck) || !text(deck.id) || deckIds.has(deck.id) || !text(deck.name) || !text(deck.filename) ||
        typeof deck.archived !== 'boolean' || !date(deck.updated) || !Array.isArray(deck.cards) || !deck.cards.length ||
        !(deck.lastSessionReviews === undefined || count(deck.lastSessionReviews))) invalid();
    deckIds.add(deck.id);
    const ids = new Set();
    for (const card of deck.cards) {
      if (!object(card) || !['id', 'question', 'answer', 'module', 'section'].every(k => text(card[k])) ||
          !card.question.trim() || (!card.answer.trim() && !card.choices) || ids.has(card.id) || !date(card.due_date) ||
          !count(card.interval) || !count(card.repetitions) || !Number.isFinite(card.ease_factor) || card.ease_factor < 1.3) invalid();
      ids.add(card.id);
      if (card.choices !== undefined && (!Array.isArray(card.choices) || card.choices.length < 2 ||
          !card.choices.every(c => object(c) && text(c.text) && c.text.trim() && typeof c.correct === 'boolean') ||
          !card.choices.some(c => c.correct))) invalid();
    }
    if (deck.session !== null) {
      const s = deck.session;
      if (!object(s) || !Array.isArray(s.queue) || !s.queue.length || !s.queue.every(id => ids.has(id)) ||
          new Set(s.queue).size !== s.queue.length || !count(s.index) || s.index >= s.queue.length ||
          !Array.isArray(s.history) || !s.history.every(id => s.queue.includes(id)) ||
          typeof s.revealed !== 'boolean' || !Array.isArray(s.selected) || !s.selected.every(count) || !count(s.reviewed)) invalid();
      if (s.answerHidden !== undefined && typeof s.answerHidden !== 'boolean') invalid();
      const card = deck.cards.find(c => c.id === s.queue[s.index]);
      if (new Set(s.selected).size !== s.selected.length ||
          (card.choices ? !s.selected.every(i => i < card.choices.length) ||
            (card.choices.filter(c => c.correct).length === 1 && s.selected.length > 1) ||
            (s.revealed && !s.selected.length) : s.selected.length !== 0)) invalid();
    }
  }
  if (value.activeDeckId !== null && !deckIds.has(value.activeDeckId)) invalid();
  if (['study', 'complete'].includes(value.view) && !activeDeck(value)) invalid();
  if (value.view === 'study' && !currentCard(value)) invalid();
  return value;
}
