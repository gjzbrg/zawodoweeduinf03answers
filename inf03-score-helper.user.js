// ==UserScript==
// @name         INF.03 practice score helper
// @namespace    local.inf03-practice
// @version      1.0.0
// @description  Randomly answers a chosen number of questions correctly in a practice exam.
// @match        https://zawodowe.edu.pl/egzamin/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const panelId = 'inf03-score-helper';
  if (!/^\/egzamin\/[^/]+\/?$/.test(location.pathname)) return;
  if (!document.querySelector('h1')?.textContent.includes('INF.03')) return;
  if (document.getElementById(panelId)) return;

  const style = document.createElement('style');
  style.textContent = `
    #${panelId} {
      position: fixed;
      z-index: 2147483647;
      top: 16px;
      right: 16px;
      width: min(340px, calc(100vw - 32px));
      padding: 14px;
      color: #17202a;
      background: #fff;
      border: 1px solid #9aa4ad;
      border-radius: 6px;
      box-shadow: 0 4px 18px #0003;
      font: 14px/1.4 system-ui, sans-serif;
    }
    #${panelId} label { display: block; margin: 8px 0 4px; font-weight: 600; }
    #${panelId} input, #${panelId} textarea, #${panelId} button {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    #${panelId} select { max-width: 92px; margin-left: 6px; font: inherit; }
    #${panelId} input, #${panelId} textarea { padding: 7px; border: 1px solid #89939d; border-radius: 4px; }
    #${panelId} textarea { min-height: 66px; resize: vertical; }
    #${panelId} button { margin-top: 8px; padding: 8px; cursor: pointer; }
    #${panelId} [data-status] { min-height: 2.8em; margin: 8px 0 0; }
    #${panelId} details { margin-top: 8px; }
    #${panelId} ol { max-height: 180px; overflow: auto; padding-left: 24px; }
  `;
  document.head.append(style);

  const panel = document.createElement('section');
  panel.id = panelId;
  panel.setAttribute('aria-label', 'Losowe odpowiedzi INF.03');
  panel.innerHTML = `
    <strong>Losowe odpowiedzi INF.03</strong>
    <label for="${panelId}-count">Liczba poprawnych odpowiedzi</label>
    <input id="${panelId}-count" type="number" min="0" max="40" value="20">
    <button type="button" data-check>Odczytaj klucz dla tego arkusza</button>
    <button type="button" data-run>Losuj i ustaw odpowiedzi</button>
    <button type="button" data-cancel disabled>Anuluj</button>
     <details>
      <summary>Odpowiedzi odczytane z kart pytań</summary>
       <ol data-key-results></ol>
     </details>
    <p data-status aria-live="polite">Wybierz wynik i uruchom. Klucz zostanie pobrany automatycznie.</p>
  `;
  document.body.append(panel);

  const countInput = panel.querySelector('input');
  const checkButton = panel.querySelector('[data-check]');
  const runButton = panel.querySelector('[data-run]');
  const cancelButton = panel.querySelector('[data-cancel]');
  const status = panel.querySelector('[data-status]');
  const keyResults = panel.querySelector('[data-key-results]');
  const correctAnswers = new Map();
  let cancelled = false;

  function randomIndex(max) {
    if (globalThis.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      globalThis.crypto.getRandomValues(value);
      return value[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function waitFor(predicate, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (predicate()) return resolve();
        if (Date.now() - started >= timeout) return reject(new Error('Nie udało się wczytać pytania.'));
        setTimeout(check, 100);
      };
      check();
    });
  }

  function getQuestionNumber() {
    const heading = [...document.querySelectorAll('h1, h2, h3')]
      .find(element => /^Pytanie\s+\d+$/.test(element.textContent.trim()));
    return heading ? Number(heading.textContent.trim().replace(/\D/g, '')) : null;
  }

  function getQuestionButton(number) {
    return [...document.querySelectorAll('button')]
      .find(button => button.textContent.trim() === String(number));
  }

   function getAnswerLabel(element) {
    const ariaLabel = (element.getAttribute('aria-label') || '').trim();
    const ariaMatch = ariaLabel.match(/Odpowiedź\s*([A-D])/i);
    if (ariaMatch) return ariaMatch[1].toUpperCase();

    const text = (element.textContent || '').trim();
    const textMatch = text.match(/^([A-D])\./i);
    return textMatch ? textMatch[1].toUpperCase() : null;
  }

  function getAnswerButton(answerLabel) {
    const target = String(answerLabel || '').trim().toUpperCase();
    return [...document.querySelectorAll('.v2-answer[role="button"], .v2-answer')]
      .find(element => getAnswerLabel(element) === target);
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
  }

  async function fetchCorrectAnswer(number) {
     const basePath = location.pathname.replace(/\/$/, '');
    const response = await fetch(`${basePath}/pytanie/${number}/`);
    if (!response.ok) throw new Error(`Nie udało się pobrać pytania ${number}.`);
    const question = (await response.json()).question;
    if (!question?.slug || !Array.isArray(question.answers)) {
      throw new Error(`Brak sluga lub odpowiedzi dla pytania ${number}.`);
    }

    const detailPath = `/technik-informatyk/INF.03/${encodeURIComponent(question.slug)}/`;
    const detailResponse = await fetch(detailPath);
    if (!detailResponse.ok) throw new Error(`Nie udało się otworzyć karty pytania ${number}.`);
    const html = await detailResponse.text();
    const detailDocument = new DOMParser().parseFromString(html, 'text/html');
    const correctButtons = [...detailDocument.querySelectorAll('.v2-answer[data-is-correct="true"], button.v2-answer[data-is-correct="true"]')];
    if (correctButtons.length !== 1) {
      throw new Error(`Karta pytania ${number} nie wskazuje jednej poprawnej odpowiedzi.`);
    }

    const correctButton = correctButtons[0];
    const correctId = correctButton.dataset.answer;
    const matchingAnswers = question.answers.filter(candidate => String(candidate.original_number) === correctId);
    if (matchingAnswers.length !== 1) {
      throw new Error(`Nie można jednoznacznie dopasować ID odpowiedzi w pytaniu ${number}.`);
    }
    const answer = matchingAnswers[0];
    return { answer, slug: question.slug };
   }

   async function loadCorrectAnswers() {
     checkButton.disabled = true;
     correctAnswers.clear();
     keyResults.replaceChildren();

     try {
       for (let number = 1; number <= 40; number += 1) {
         const row = document.createElement('li');
        try {
          const { answer, slug } = await fetchCorrectAnswer(number);
          correctAnswers.set(number, answer);
          row.textContent = `Pytanie ${number}: ${answer.label} (slug: ${slug})`;
        } catch (error) {
          row.textContent = `Pytanie ${number}: ${error.message}`;
        }
         keyResults.append(row);
         status.textContent = `Sprawdzam odpowiedzi: ${number}/40`;
       }

      status.textContent = correctAnswers.size === 40
        ? 'Gotowe: odczytano i dopasowano klucz dla wszystkich 40 pytań.'
        : `Odczytano klucz dla ${correctAnswers.size}/40 pytań. Nie ustawiaj odpowiedzi, dopóki nie uda się dopasować wszystkich.`;
     } catch (error) {
       status.textContent = error.message;
     } finally {
       checkButton.disabled = false;
     }
  }

  function shuffle(values) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = randomIndex(index + 1);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  }

  runButton.addEventListener('click', async () => {
    if (runButton.disabled) return;

    const target = Number(countInput.value);
    if (!Number.isInteger(target) || target < 0 || target > 40) {
      status.textContent = 'Podaj liczbę od 0 do 40.';
      return;
    }
    runButton.disabled = true;
    if (correctAnswers.size !== 40) {
      await loadCorrectAnswers();
      if (correctAnswers.size !== 40) {
        runButton.disabled = false;
        return;
      }
    }

    const correctQuestions = new Set(shuffle(Array.from({ length: 40 }, (_, index) => index + 1)).slice(0, target));
    cancelled = false;
    cancelButton.disabled = false;

    try {
      for (let number = 1; number <= 40; number += 1) {
        if (cancelled) break;
        const questionButton = getQuestionButton(number);
        if (!questionButton) throw new Error(`Nie znaleziono nawigacji do pytania ${number}.`);
        questionButton.click();
        await waitFor(() => getQuestionNumber() === number);

        const correctAnswer = correctAnswers.get(number);
        let chosenAnswerLabel = correctAnswer?.label;
        if (!correctQuestions.has(number)) {
          const answerOptions = [...document.querySelectorAll('.v2-answer[role="button"], .v2-answer')];
          const wrongAnswers = answerOptions.filter(element => getAnswerLabel(element) !== correctAnswer?.label);
          chosenAnswerLabel = getAnswerLabel(wrongAnswers[randomIndex(wrongAnswers.length)]);
        }

        const answerButton = getAnswerButton(chosenAnswerLabel);
        if (!answerButton) throw new Error(`Nie znaleziono odpowiedzi do pytania ${number}.`);
        const wasAnswered = questionButton.dataset.answered === 'true';
        questionButton.dataset.answered = 'false';
        questionButton.classList.remove('is-answered');
        answerButton.click();
        status.textContent = `Zapisuję odpowiedź ${number}/40...`;
        try {
          await waitFor(() => questionButton.dataset.answered === 'true', 15000);
        } catch (error) {
          if (wasAnswered) {
            questionButton.dataset.answered = 'true';
            questionButton.classList.add('is-answered');
          }
          throw error;
        }
        status.textContent = `Zapisano odpowiedź ${number}/40.`;
      }
      status.textContent = cancelled
        ? 'Przerwano. Zapisano odpowiedzi ustawione do tej pory.'
        : `Gotowe: ustawiono ${target} odpowiedzi zgodnych z podanym kluczem. Egzamin nie został zakończony.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      runButton.disabled = false;
      cancelButton.disabled = true;
    }
  });

  cancelButton.addEventListener('click', () => {
    cancelled = true;
    status.textContent = 'Anulowanie po bieżącym pytaniu...';
  });

   checkButton.addEventListener('click', loadCorrectAnswers);
})();