/* =============================================================================
 * config.example.js — template konfigurasi build web (DI-COMMIT, nilai kosong)
 * -----------------------------------------------------------------------------
 * Jangan isi kunci iklan di file ini (ia masuk git). Salin jadi web/config.js:
 *
 *   cp web/config.example.js web/config.js      lalu isi ID-nya, ATAU
 *   node tools/gen_web_config.js                 (sumber: berkas .env — lihat .env.example)
 *
 * web/config.js di-.gitignore, jadi ID tetap di luar repo. Prioritas nilai:
 *   ?adsAppLixir=… di URL  >  web/config.js  >  file ini  >  default di adsManager.js
 * ========================================================================== */
window.HIDESEEK_CONFIG = {
  ads: {
    platformOrder: ['applixir', 'adinplay'],
    // AppLixir / Google Ad Placement API — nama ad break rewarded.
    appLixirPlacement: '',            // mis. 'rewarded_video'   (env: APPLIXIR_PLACEMENT)
    // AdinPlay — placement id.
    adinPlayPlacement: '',            // mis. 'rewarded_placement' (env: ADINPLAY_PLACEMENT)
    // Slot per jenis reward; kosong = pakai appLixirPlacement di atas.
    adUnits: {
      extra_life: '',                 // "Tonton Iklan +1 Nyawa"
      bonus_coins: '',                // "Dapatkan Koin"
      skip_cooldown: '',              // reward internal game (reset skill)
      frenzy: '',                     // reward internal game (buff 10s)
    },
    testMode: true,                   // false saat rilis (env: ADS_TEST_MODE)
    adCooldownSeconds: 30,            // jeda global antar iklan (env: ADS_COOLDOWN_SECONDS)
    simSeconds: 1.5,                  // durasi iklan simulasi saat testMode (env: ADS_SIM_SECONDS)
    adTimeoutSeconds: 20,             // no-fill timeout SDK (env: ADS_TIMEOUT_SECONDS)
    cooldownKey: 'lastAdTime',        // key localStorage sesuai spesifikasi
  },
  referral: {
    gameName: 'HideSeek Online',
    baseUrl: '',                      // mis. 'https://example.com/hideseek' (env: REFERRAL_BASE_URL)
    coinsForInvitee: 50,
    hpForInvitee: 1,
    coinsForInviter: 100,
    codeLength: 7,
    welcomeSeconds: 6,
  },
  // Saldo awal profil (biar playtest tidak mulai dari nol).
  economy: {
    startCoins: 0,
    coinsPerScore: 0.5,               // koin = round(score * coinsPerScore) tiap akhir ronde
    maxHpBonusPrice: 50,              // harga +1 Max HP di lobby
    maxHpBonusCap: 2,
    extraLifePrice: 25,               // beli 1 nyawa ekstra tanpa iklan
  },
};
