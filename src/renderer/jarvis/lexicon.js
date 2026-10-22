// Lexique personnel de la dictee : noms propres (villes, projets, personnes)
// que Whisper ne connait pas. Un mot entendu qui « sonne » comme une entree
// du lexique est remplace par l'orthographe de l'entree.
(function (root) {
  // Empreinte sonore approximative du francais : accents, lettres muettes et
  // graphies equivalentes retirees (« Bormelais-Mimosa » = « Bormes-les-Mimosas »).
  function soundKey(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .replace(/eau|au/g, "o")
      .replace(/ai|ei|ez|er|et/g, "e")
      .replace(/ph/g, "f")
      .replace(/qu|k/g, "c")
      .replace(/[hse]/g, "")
      .replace(/(.)\1+/g, "$1");
  }

  function distance(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return previous[b.length];
  }

  // Ecart relatif entre deux empreintes (0 = identiques). Entree courte
  // (empreinte < 5 lettres) : seulement si identique, pour ne pas remplacer
  // des mots courants.
  function gap(candidate, key) {
    if (!candidate || !key) {
      return 1;
    }
    if (key.length < 5) {
      return candidate === key ? 0 : 1;
    }
    return distance(candidate, key) / Math.max(candidate.length, key.length);
  }

  // Remplace dans le texte les passages qui sonnent comme une entree du lexique.
  // Le groupe de mots le plus proche est retenu (a egalite, le plus court :
  // « a » ou « ? » voisins ne sont pas avales), puis on recommence.
  // Renvoie { text, fixes: [« entendu » -> « entree »] }.
  function apply(text, entries) {
    // Mots deja corriges (ou deja bien ecrits) : verrouilles.
    let words = String(text)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ word, locked: entries.includes(word.replace(/^[(«"]+|[.,;:!?…)»"]+$/g, "")) }));
    const fixes = [];
    for (const entry of entries) {
      const key = soundKey(entry);
      const size = entry.split(/[\s-]+/).length;
      for (let round = 0; round < 10; round += 1) {
        let best = null;
        for (let start = 0; start < words.length; start += 1) {
          for (let length = 1; length <= Math.min(size + 2, words.length - start); length += 1) {
            const slice = words.slice(start, start + length);
            if (slice.some((item) => item.locked)) {
              break;
            }
            const score = gap(soundKey(slice.map((item) => item.word).join(" ")), key);
            if (score <= 0.2 && (!best || score < best.score || (score === best.score && length < best.length))) {
              best = { start, length, score };
            }
          }
        }
        if (!best) {
          break;
        }
        const slice = words.slice(best.start, best.start + best.length).map((item) => item.word);
        const trailing = slice[slice.length - 1].match(/[.,;:!?…)»"]+$/)?.[0] || "";
        const leading = slice[0].match(/^[(«"]+/)?.[0] || "";
        fixes.push(`« ${slice.join(" ")} » -> « ${entry} »`);
        words = [...words.slice(0, best.start), { word: `${leading}${entry}${trailing}`, locked: true }, ...words.slice(best.start + best.length)];
      }
    }
    return { text: words.map((item) => item.word).join(" "), fixes };
  }

  const api = { apply, soundKey };
  root.JarvisLexicon = api;
  if (typeof module !== "undefined") {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
