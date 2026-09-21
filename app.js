'use strict';

const Wasl = (() => {

  const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  const PRAYER_LABELS = {
    Fajr:    { en: 'Fajr',    ar: 'الفجر' },
    Dhuhr:   { en: 'Dhuhr',   ar: 'الظهر' },
    Asr:     { en: 'Asr',     ar: 'العصر' },
    Maghrib: { en: 'Maghrib', ar: 'المغرب' },
    Isha:    { en: 'Isha',    ar: 'العشاء' },
  };

  // ── Settings ────────────────────────────────────────────────────────
  function getSettings() {
    return JSON.parse(localStorage.getItem('wasl_settings') || JSON.stringify({
      method: 2,   // 2 = ISNA (North America), 3 = MWL, 4 = Makkah
      lat: null,
      lon: null,
      city: '',
    }));
  }
  function saveSettings(s) {
    localStorage.setItem('wasl_settings', JSON.stringify({ ...getSettings(), ...s }));
  }

  // ── Geolocation ─────────────────────────────────────────────────────
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return; }
      navigator.geolocation.getCurrentPosition(
        p  => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        e  => reject(e),
        { timeout: 12000, maximumAge: 600000 }
      );
    });
  }

  // Reverse geocode city name (nominatim, no key needed)
  async function getCityName(lat, lon) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
      const d = await r.json();
      return d.address?.city || d.address?.town || d.address?.village || d.address?.county || '';
    } catch { return ''; }
  }

  // ── Prayer Times ────────────────────────────────────────────────────
  function _todayStr() { return new Date().toISOString().split('T')[0]; }

  function getCachedPrayers() {
    const raw = localStorage.getItem('wasl_prayers_' + _todayStr());
    return raw ? JSON.parse(raw) : null;
  }
  function cachePrayers(data) {
    localStorage.setItem('wasl_prayers_' + _todayStr(), JSON.stringify(data));
  }

  async function fetchPrayerTimes(lat, lon) {
    const { method } = getSettings();
    const ts = Math.floor(Date.now() / 1000);
    const url = `https://api.aladhan.com/v1/timings/${ts}?latitude=${lat}&longitude=${lon}&method=${method}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();
    if (data.code !== 200) throw new Error('API error');
    return data.data;  // { timings:{Fajr,Dhuhr,...}, date:{hijri,...} }
  }

  // parse "HH:MM" into today's Date object
  function parseTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  // returns { prayer, time } for the next upcoming prayer, or null if past Isha
  function getNextPrayer(timings) {
    const now = new Date();
    for (const p of PRAYERS) {
      const t = parseTime(timings[p]);
      if (t > now) return { prayer: p, time: t };
    }
    return null; // all done today
  }

  // ── Prayer Tracking ─────────────────────────────────────────────────
  function _logKey(dateStr) { return 'wasl_log_' + (dateStr || _todayStr()); }

  function getPrayerLog(dateStr) {
    return JSON.parse(localStorage.getItem(_logKey(dateStr)) || '{}');
  }
  function markPrayer(prayer, done) {
    const log = getPrayerLog();
    if (done) log[prayer] = new Date().toISOString();
    else delete log[prayer];
    localStorage.setItem(_logKey(), JSON.stringify(log));
  }
  function isPrayerDone(prayer, dateStr) {
    return !!getPrayerLog(dateStr)[prayer];
  }
  function getDayCount(dateStr) {
    return PRAYERS.filter(p => isPrayerDone(p, dateStr)).length;
  }

  // how many consecutive full days (all 5) ending yesterday
  function getStreak() {
    let streak = 0;
    for (let i = 1; i <= 365; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      if (getDayCount(key) === 5) streak++;
      else break;
    }
    return streak;
  }

  // ── Dhikr ───────────────────────────────────────────────────────────
  const DHIKR_LIST = [
    { arabic: 'سُبْحَانَ اللّٰهِ',      latin: 'Subhanallah',    meaning: 'Glory be to Allah',          target: 33 },
    { arabic: 'الْحَمْدُ لِلَّهِ',       latin: 'Alhamdulillah',  meaning: 'All praise is for Allah',     target: 33 },
    { arabic: 'اللّٰهُ أَكْبَرُ',        latin: 'Allahu Akbar',   meaning: 'Allah is the Greatest',       target: 34 },
    { arabic: 'لَا إِلَٰهَ إِلَّا اللّٰهُ', latin: 'La ilaha illallah', meaning: 'There is no god but Allah', target: 0  },
  ];

  function getDhikrState() {
    return JSON.parse(localStorage.getItem('wasl_dhikr') || JSON.stringify({ count: 0, index: 0 }));
  }
  function saveDhikrState(s) {
    localStorage.setItem('wasl_dhikr', JSON.stringify(s));
  }
  function resetDhikr() {
    saveDhikrState({ count: 0, index: 0 });
  }

  // ── Quran bookmarks ─────────────────────────────────────────────────
  function getBookmark() {
    return JSON.parse(localStorage.getItem('wasl_bookmark') || 'null');
  }
  function setBookmark(surah, ayah) {
    localStorage.setItem('wasl_bookmark', JSON.stringify({ surah, ayah, ts: Date.now() }));
  }

  // ── Qibla ───────────────────────────────────────────────────────────
  async function getQiblaDirection(lat, lon) {
    const res  = await fetch(`https://api.aladhan.com/v1/qibla/${lat}/${lon}`);
    const data = await res.json();
    return data.data.direction; // degrees clockwise from north
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function formatCountdown(ms) {
    if (ms <= 0) return '0:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function formatTime12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = ((h % 12) || 12);
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  // ── Notifications ───────────────────────────────────────────────────
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      return reg;
    } catch (e) {
      console.warn('[Wasl] SW registration failed:', e);
      return null;
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  const PRAYER_NOTIF = {
    Fajr:    { ar: 'الفجر',  msg: 'Rise and pray Fajr. The angels witness the dawn prayer.' },
    Dhuhr:   { ar: 'الظهر',  msg: 'Take a moment from your day. Dhuhr time.' },
    Asr:     { ar: 'العصر',  msg: "Don't delay — Asr time is now." },
    Maghrib: { ar: 'المغرب', msg: 'The sun has set. Pray Maghrib before the time passes.' },
    Isha:    { ar: 'العشاء', msg: 'End your day in prayer. Isha awaits you.' },
  };

  async function scheduleNotifications(timings) {
    if (Notification.permission !== 'granted') return;

    const sw = await navigator.serviceWorker?.ready;
    if (!sw) return;

    const now    = new Date();
    const notifs = [];

    // ── Prayer time alerts ──
    PRAYERS.forEach(prayer => {
      const t = parseTime(timings[prayer]);
      if (t <= now) return;
      const info = PRAYER_NOTIF[prayer];
      notifs.push({
        at:    t.getTime(),
        title: `${prayer}  ${info.ar}`,
        body:  info.msg,
        tag:   `prayer_${prayer}`,
        url:   './',
      });

      // ── Dhikr reminder 10 min after each prayer ──
      const dhikrTime = new Date(t.getTime() + 10 * 60 * 1000);
      notifs.push({
        at:    dhikrTime.getTime(),
        title: 'Time for Dhikr 📿',
        body:  'Say Subhanallah 33 · Alhamdulillah 33 · Allahu Akbar 34',
        tag:   `dhikr_${prayer}`,
        url:   './dhikr.html',
      });
    });

    // ── Quran reminder after Fajr ──
    const fajrTime = parseTime(timings['Fajr']);
    if (fajrTime > now) {
      const quranTime = new Date(fajrTime.getTime() + 20 * 60 * 1000);
      notifs.push({
        at:    quranTime.getTime(),
        title: 'Read Quran 📖',
        body:  'Start your morning with the words of Allah.',
        tag:   'quran_daily',
        url:   './quran.html',
      });
    }

    sw.active?.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', prayers: notifs });
  }

  function getNotifEnabled() {
    return localStorage.getItem('wasl_notif') !== 'false';
  }
  function setNotifEnabled(v) {
    localStorage.setItem('wasl_notif', v ? 'true' : 'false');
  }

  return {
    PRAYERS, PRAYER_LABELS, DHIKR_LIST,
    getSettings, saveSettings,
    getLocation, getCityName,
    fetchPrayerTimes, getCachedPrayers, cachePrayers,
    parseTime, getNextPrayer,
    getPrayerLog, markPrayer, isPrayerDone, getDayCount, getStreak,
    getDhikrState, saveDhikrState, resetDhikr,
    getBookmark, setBookmark,
    getQiblaDirection,
    formatCountdown, formatTime12,
    registerSW, requestNotificationPermission,
    scheduleNotifications, getNotifEnabled, setNotifEnabled,
  };
})();

// 114 Surahs
const SURAHS = [
  [1,'Al-Fatiha','الفاتحة',7,'The Opening'],
  [2,'Al-Baqarah','البقرة',286,'The Cow'],
  [3,"Ali 'Imran",'آل عمران',200,'Family of Imran'],
  [4,'An-Nisa','النساء',176,'The Women'],
  [5,"Al-Ma'idah",'المائدة',120,'The Table'],
  [6,"Al-An'am",'الأنعام',165,'The Cattle'],
  [7,"Al-A'raf",'الأعراف',206,'The Heights'],
  [8,'Al-Anfal','الأنفال',75,'The Spoils of War'],
  [9,'At-Tawbah','التوبة',129,'The Repentance'],
  [10,'Yunus','يونس',109,'Jonah'],
  [11,'Hud','هود',123,'Hud'],
  [12,'Yusuf','يوسف',111,'Joseph'],
  [13,"Ar-Ra'd",'الرعد',43,'The Thunder'],
  [14,'Ibrahim','إبراهيم',52,'Abraham'],
  [15,'Al-Hijr','الحجر',99,'The Rocky Tract'],
  [16,'An-Nahl','النحل',128,'The Bee'],
  [17,"Al-Isra",'الإسراء',111,'The Night Journey'],
  [18,'Al-Kahf','الكهف',110,'The Cave'],
  [19,'Maryam','مريم',98,'Mary'],
  [20,'Ta-Ha','طه',135,'Ta-Ha'],
  [21,'Al-Anbiya','الأنبياء',112,'The Prophets'],
  [22,'Al-Hajj','الحج',78,'The Pilgrimage'],
  [23,"Al-Mu'minun",'المؤمنون',118,'The Believers'],
  [24,'An-Nur','النور',64,'The Light'],
  [25,'Al-Furqan','الفرقان',77,'The Criterion'],
  [26,"Ash-Shu'ara",'الشعراء',227,'The Poets'],
  [27,'An-Naml','النمل',93,'The Ant'],
  [28,'Al-Qasas','القصص',88,'The Stories'],
  [29,'Al-Ankabut','العنكبوت',69,'The Spider'],
  [30,'Ar-Rum','الروم',60,'The Romans'],
  [31,'Luqman','لقمان',34,'Luqman'],
  [32,'As-Sajdah','السجدة',30,'The Prostration'],
  [33,'Al-Ahzab','الأحزاب',73,'The Combined Forces'],
  [34,'Saba','سبإ',54,'Sheba'],
  [35,'Fatir','فاطر',45,'Originator'],
  [36,'Ya-Sin','يس',83,'Ya Sin'],
  [37,'As-Saffat','الصافات',182,'Those Who Set the Ranks'],
  [38,'Sad','ص',88,'The Letter Sad'],
  [39,'Az-Zumar','الزمر',75,'The Troops'],
  [40,'Ghafir','غافر',85,'The Forgiver'],
  [41,'Fussilat','فصلت',54,'Explained in Detail'],
  [42,'Ash-Shura','الشورى',53,'The Consultation'],
  [43,'Az-Zukhruf','الزخرف',89,'The Ornaments of Gold'],
  [44,'Ad-Dukhan','الدخان',59,'The Smoke'],
  [45,'Al-Jathiyah','الجاثية',37,'The Crouching'],
  [46,'Al-Ahqaf','الأحقاف',35,'The Wind-Curved Sandhills'],
  [47,'Muhammad','محمد',38,'Muhammad'],
  [48,'Al-Fath','الفتح',29,'The Victory'],
  [49,'Al-Hujurat','الحجرات',18,'The Rooms'],
  [50,'Qaf','ق',45,'The Letter Qaf'],
  [51,'Adh-Dhariyat','الذاريات',60,'The Winnowing Winds'],
  [52,'At-Tur','الطور',49,'The Mount'],
  [53,'An-Najm','النجم',62,'The Star'],
  [54,'Al-Qamar','القمر',55,'The Moon'],
  [55,'Ar-Rahman','الرحمن',78,'The Beneficent'],
  [56,"Al-Waqi'ah",'الواقعة',96,'The Inevitable'],
  [57,'Al-Hadid','الحديد',29,'The Iron'],
  [58,'Al-Mujadila','المجادلة',22,'The Pleading Woman'],
  [59,'Al-Hashr','الحشر',24,'The Exile'],
  [60,'Al-Mumtahanah','الممتحنة',13,'She That is to be Examined'],
  [61,'As-Saf','الصف',14,'The Ranks'],
  [62,"Al-Jumu'ah",'الجمعة',11,'The Congregation'],
  [63,'Al-Munafiqun','المنافقون',11,'The Hypocrites'],
  [64,'At-Taghabun','التغابن',18,'Mutual Disillusion'],
  [65,'At-Talaq','الطلاق',12,'Divorce'],
  [66,'At-Tahrim','التحريم',12,'The Prohibition'],
  [67,'Al-Mulk','الملك',30,'The Sovereignty'],
  [68,'Al-Qalam','القلم',52,'The Pen'],
  [69,'Al-Haqqah','الحاقة',52,'The Reality'],
  [70,"Al-Ma'arij",'المعارج',44,'The Ascending Stairways'],
  [71,'Nuh','نوح',28,'Noah'],
  [72,'Al-Jinn','الجن',28,'The Jinn'],
  [73,'Al-Muzzammil','المزمل',20,'The Enshrouded One'],
  [74,'Al-Muddaththir','المدثر',56,'The Cloaked One'],
  [75,'Al-Qiyamah','القيامة',40,'The Resurrection'],
  [76,'Al-Insan','الإنسان',31,'The Man'],
  [77,'Al-Mursalat','المرسلات',50,'The Emissaries'],
  [78,"An-Naba",'النبأ',40,'The Tidings'],
  [79,"An-Nazi'at",'النازعات',46,'Those Who Drag Forth'],
  [80,'Abasa','عبس',42,'He Frowned'],
  [81,'At-Takwir','التكوير',29,'The Overthrowing'],
  [82,'Al-Infitar','الانفطار',19,'The Cleaving'],
  [83,'Al-Mutaffifin','المطففين',36,'The Defrauding'],
  [84,'Al-Inshiqaq','الانشقاق',25,'The Sundering'],
  [85,'Al-Buruj','البروج',22,'The Mansions of the Stars'],
  [86,'At-Tariq','الطارق',17,'The Nightcomer'],
  [87,"Al-A'la",'الأعلى',19,'The Most High'],
  [88,'Al-Ghashiyah','الغاشية',26,'The Overwhelming'],
  [89,'Al-Fajr','الفجر',30,'The Dawn'],
  [90,'Al-Balad','البلد',20,'The City'],
  [91,'Ash-Shams','الشمس',15,'The Sun'],
  [92,'Al-Layl','الليل',21,'The Night'],
  [93,'Ad-Duha','الضحى',11,'The Morning Hours'],
  [94,'Ash-Sharh','الشرح',8,'The Relief'],
  [95,'At-Tin','التين',8,'The Fig'],
  [96,"Al-Alaq",'العلق',19,'The Clot'],
  [97,'Al-Qadr','القدر',5,'The Night of Power'],
  [98,'Al-Bayyinah','البينة',8,'The Clear Proof'],
  [99,'Az-Zalzalah','الزلزلة',8,'The Earthquake'],
  [100,"Al-Adiyat",'العاديات',11,'The Courser'],
  [101,"Al-Qari'ah",'القارعة',11,'The Calamity'],
  [102,'At-Takathur','التكاثر',8,'The Rivalry'],
  [103,"Al-'Asr",'العصر',3,'The Declining Day'],
  [104,'Al-Humazah','الهمزة',9,'The Traducer'],
  [105,'Al-Fil','الفيل',5,'The Elephant'],
  [106,'Quraysh','قريش',4,'Quraysh'],
  [107,"Al-Ma'un",'الماعون',7,'The Small Kindnesses'],
  [108,'Al-Kawthar','الكوثر',3,'The Abundance'],
  [109,'Al-Kafirun','الكافرون',6,'The Disbelievers'],
  [110,'An-Nasr','النصر',3,'The Divine Support'],
  [111,'Al-Masad','المسد',5,'The Palm Fibre'],
  [112,'Al-Ikhlas','الإخلاص',4,'The Sincerity'],
  [113,'Al-Falaq','الفلق',5,'The Daybreak'],
  [114,'An-Nas','الناس',6,'Mankind'],
];
