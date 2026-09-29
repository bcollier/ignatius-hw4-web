// ================================================================ words to wait with
// Short sayings from the desert, the mystics and the teachers of prayer, shown while the
// server wakes and while a retreat is being made. Only sayings that can be traced to the
// person are included; the few that tradition hands down without a firm source say
// "attributed". Many popular lines are misattributed (Teresa never wrote "Christ has no
// body now on earth but yours"), so check before adding one.

const QUOTES = [
  // The desert mothers and fathers (Sayings of the Desert Fathers)
  { text: "Go, sit in your cell, and your cell will teach you everything.", who: "Abba Moses", where: "Sayings of the Desert Fathers" },
  { text: "If you will, you can become all flame.", who: "Abba Joseph of Panephysis", where: "Sayings of the Desert Fathers" },
  { text: "It is possible to be a solitary in one's mind while living in a crowd, and it is possible for one who is a solitary to live in the crowd of his own thoughts.", who: "Amma Syncletica", where: "Sayings of the Desert Mothers" },
  { text: "I saw the snares that the enemy spreads out over the world and I said, groaning, ‘What can get through from such snares?’ Then I heard a voice saying to me, ‘Humility.’", who: "Abba Anthony the Great", where: "Sayings of the Desert Fathers" },
  { text: "Just as the trees, if they have not stood before the winter's storms, cannot bear fruit, so it is with us.", who: "Amma Theodora", where: "Sayings of the Desert Mothers" },
  { text: "Teach your mouth to say that which you have in your heart.", who: "Abba Poemen", where: "Sayings of the Desert Fathers" },
  { text: "Do not give your heart to that which does not satisfy your heart.", who: "Abba Poemen", where: "Sayings of the Desert Fathers" },

  // Saint Ignatius of Loyola
  { text: "Love ought to show itself in deeds more than in words.", who: "Saint Ignatius of Loyola", where: "Spiritual Exercises, 230" },
  { text: "Take, Lord, and receive all my liberty, my memory, my understanding, and all my will. Give me only your love and your grace; that is enough for me.", who: "Saint Ignatius of Loyola", where: "Spiritual Exercises, 234" },
  { text: "It is not much knowledge that fills and satisfies the soul, but the inner feeling and relishing of things.", who: "Saint Ignatius of Loyola", where: "Spiritual Exercises, 2" },
  { text: "Seek God in all things.", who: "Saint Ignatius of Loyola", where: "Constitutions of the Society of Jesus, 288" },
  { text: "Act as if everything depended on you; trust as if everything depended on God.", who: "Saint Ignatius of Loyola (attributed)", where: "" },

  // Saint John of the Cross
  { text: "In the evening of life, we will be examined in love.", who: "Saint John of the Cross", where: "Sayings of Light and Love, 59" },
  { text: "Where there is no love, put love, and you will draw out love.", who: "Saint John of the Cross", where: "Letter to María de la Encarnación, 1591" },
  { text: "O guiding night! O night more lovely than the dawn!", who: "Saint John of the Cross", where: "The Dark Night" },
  { text: "The soul that walks in love neither tires others nor grows tired.", who: "Saint John of the Cross", where: "Sayings of Light and Love, 96" },

  // Julian of Norwich
  { text: "All shall be well, and all shall be well, and all manner of thing shall be well.", who: "Julian of Norwich", where: "Revelations of Divine Love, 27" },
  { text: "He did not say, ‘You shall not be tempest-tossed, you shall not be work-weary, you shall not be discomforted.’ But he said, ‘You shall not be overcome.’", who: "Julian of Norwich", where: "Revelations of Divine Love, 68" },
  { text: "The fullness of joy is to behold God in everything.", who: "Julian of Norwich", where: "Revelations of Divine Love, 35" },
  { text: "Love was his meaning.", who: "Julian of Norwich", where: "Revelations of Divine Love, 86" },

  // Saint Teresa of Ávila
  { text: "Let nothing disturb you, let nothing frighten you. All things are passing; God never changes. Patience obtains all things. Whoever has God lacks nothing. God alone suffices.", who: "Saint Teresa of Ávila", where: "her bookmark prayer" },
  { text: "Prayer is nothing else than an intimate sharing between friends; it means taking time frequently to be alone with him who we know loves us.", who: "Saint Teresa of Ávila", where: "The Book of Her Life, 8" },

  // Other mystics and teachers of prayer
  { text: "You have made us for yourself, O Lord, and our heart is restless until it rests in you.", who: "Saint Augustine", where: "Confessions, I.1" },
  { text: "Late have I loved you, Beauty so ancient and so new, late have I loved you!", who: "Saint Augustine", where: "Confessions, X.27" },
  { text: "The eye with which I see God is the same eye with which God sees me.", who: "Meister Eckhart", where: "Sermon 12" },
  { text: "By love he may be gotten and holden; but by thought never.", who: "The Cloud of Unknowing", where: "chapter 6" },
  { text: "The time of business does not with me differ from the time of prayer.", who: "Brother Lawrence", where: "The Practice of the Presence of God" },
  { text: "For me, prayer is a surge of the heart; it is a simple look turned toward heaven, a cry of recognition and of love.", who: "Saint Thérèse of Lisieux", where: "Story of a Soul" },
  { text: "Have patience with all things, but first of all with yourself.", who: "Saint Francis de Sales", where: "letters" },
  { text: "The world is charged with the grandeur of God.", who: "Gerard Manley Hopkins", where: "God's Grandeur" },
  { text: "Reading seeks the sweetness of a blessed life, meditation perceives it, prayer asks for it, contemplation tastes it.", who: "Guigo II", where: "The Ladder of Monks" },

  // Twentieth-century teachers
  { text: "My Lord God, I have no idea where I am going. I do not see the road ahead of me.", who: "Thomas Merton", where: "Thoughts in Solitude" },
  { text: "The beginning of love is to let those we love be perfectly themselves.", who: "Thomas Merton", where: "No Man Is an Island" },
  { text: "The prayer preceding all prayers is, ‘May it be the real I who speaks. May it be the real Thou that I speak to.’", who: "C. S. Lewis", where: "Letters to Malcolm" },
  { text: "We are not necessarily doubting that God will do the best for us; we are wondering how painful the best will turn out to be.", who: "C. S. Lewis", where: "Letters" },
  { text: "We do not think ourselves into new ways of living; we live ourselves into new ways of thinking.", who: "Richard Rohr", where: "" },
  { text: "Everything belongs.", who: "Richard Rohr", where: "Everything Belongs" },
];

function randomQuote(except) {
  const pool = QUOTES.filter((q) => q !== except);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Show a quote in a <figure> (blockquote + figcaption), changing every `seconds` with a
// fade, until stopQuotes(figure). Returns the timer.
function showQuotes(figure, seconds = 20) {
  stopQuotes(figure);
  let current = null;
  const next = () => {
    current = randomQuote(current);
    figure.classList.remove("shown");
    setTimeout(() => {
      figure.querySelector("blockquote").textContent = current.text;
      figure.querySelector("figcaption").textContent = current.where ? `${current.who}, ${current.where}` : current.who;
      figure.classList.add("shown");
    }, figure.dataset.started ? 600 : 0);
    figure.dataset.started = "1";
  };
  next();
  figure._quoteTimer = setInterval(next, seconds * 1000);
  return figure._quoteTimer;
}

function stopQuotes(figure) {
  if (figure?._quoteTimer) clearInterval(figure._quoteTimer);
  if (figure) delete figure.dataset.started;
}
