// ============================================================================
//  RewardOffers.cs   (HideSeek.Monetization)
//  Otak di belakang tombol "Tonton iklan" di HUD.
//
//  Tiga penawaran (semuanya dibatasi per ronde supaya tidak jadi pay-to-win):
//    1) HIDER REVIVE      - hider yang sudah jadi hantu boleh bangkit dengan 1 HP.
//                           HARUS disahkan Host (evt EvtRewardRevive -> PlayerCombat.RpcRevived).
//    2) SKIP COOLDOWN     - reset cooldown skill pemain sendiri (hider/seeker).
//    3) SEEKER FRENZY     - +25% kecepatan & +1.5m jangkauan tangkap selama 10 detik.
//
//  Tidak ada objek yang wajib dibuat manual: RewardOffers membuat dirinya (dan
//  AdsManager) di atas HideSeek_GameRoot saat pertama kali dibutuhkan.
// ============================================================================
using System.Collections;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Players;
using HideSeek.Skills;
using Photon.Pun;
using UnityEngine;

namespace HideSeek.Monetization
{
    /// <summary>Penawaran reward yang sedang tersedia untuk pemain lokal.</summary>
    public enum RewardOfferType { None = 0, HiderRevive = 1, CooldownSkip = 2, SeekerFrenzy = 3 }

    public class RewardOffers : MonoBehaviourPunCallbacks
    {
        public static RewardOffers Instance { get; private set; }

        [Header("Switch")]
        [Tooltip("Sembunyikan semua penawaran reward (mis. untuk build tanpa iklan).")]
        public bool offersEnabled = true;
        [Tooltip("Tulis log keputusan (kenapa offer None / kenapa request ditolak).")]
        public bool verboseLogs = true;

        [Header("Kuota per ronde (override nilai HideSeekConstants bila ingin beda)")]
        [Range(0, 3)] public int maxRevivesPerRound = HideSeekConstants.MaxRevivesPerRound;
        [Range(0, 3)] public int maxCooldownSkips = HideSeekConstants.MaxCooldownSkipsPerRound;
        [Range(0, 3)] public int maxFrenzies = HideSeekConstants.MaxFrenziesPerRound;

        /// <summary>Naik tiap kali UI perlu tahu (reward berubah/granted) - didengar UIManager.</summary>
        public event System.Action OnOffersChanged;

        // pemakaian ronde ini
        private int revivesUsed, skipsUsed, frenziesUsed;
        private int lastRoundSeen = -1;
        private bool busy;

        // ============================== LIFECYCLE ==============================

        /// <summary>Ambil instance; dibuat otomatis di HideSeek_GameRoot bila belum ada.</summary>
        public static RewardOffers EnsureExists()
        {
            if (Instance != null) return Instance;

            GameObject root = GameObject.Find(GameManager.GameRootName);
            if (root == null)
            {
                var gm = GameManager.Instance;
                root = gm != null ? gm.gameObject : null;
            }
            if (root == null)
            {
                root = new GameObject("HideSeek_GameRoot");
                DontDestroyOnLoad(root);
            }
            var ro = root.GetComponent<RewardOffers>();
            if (ro == null) ro = root.AddComponent<RewardOffers>();
            return ro;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            AdsManager.EnsureExists();                       // iklan siap sejak awal (hemat waktu tunggu)
        }

        private void OnEnable()
        {
            base.OnEnable();
            if (GameManager.Instance != null) GameManager.Instance.OnPhaseChanged += HandlePhase;
        }

        private void OnDisable()
        {
            base.OnDisable();
            if (GameManager.Instance != null) GameManager.Instance.OnPhaseChanged -= HandlePhase;
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        /// <summary>Countdown = ronde baru -> reset kuota reward.</summary>
        private void HandlePhase(GameState state, float remain)
        {
            if (state == GameState.Countdown) ResetQuotas();
        }

        public void ResetQuotas()
        {
            revivesUsed = skipsUsed = frenziesUsed = 0;
            Raise();
        }

        // ================================ QUERY ================================

        private PlayerController Me
        {
            get
            {
                if (PhotonNetwork.LocalPlayer == null) return null;
                return PlayerRegistry.Get(PhotonNetwork.LocalPlayer.ActorNumber);
            }
        }

        /// <summary>Penawaran terbaik saat ini (None = tombol disembunyikan).</summary>
        public RewardOfferType CurrentOffer
        {
            get
            {
                if (!offersEnabled || busy) return RewardOfferType.None;
                var gm = GameManager.Instance;
                if (gm == null || !gm.IsRoundRunning) return RewardOfferType.None;

                PlayerController me = Me;
                if (me == null) return RewardOfferType.None;

                // 1) hider mati -> tawarkan revive (paling berharga, taruh paling depan)
                if (me.Role == GameRole.Hider && me.IsGhost && revivesUsed < maxRevivesPerRound)
                    return RewardOfferType.HiderRevive;

                // 2) skill masih cooldown -> skip
                if (skipsUsed < maxCooldownSkips && CooldownRemaining(me) > 0.6f)
                    return RewardOfferType.CooldownSkip;

                // 3) seeker -> frenzy
                if (me.Role == GameRole.Seeker && frenziesUsed < maxFrenzies)
                    return RewardOfferType.SeekerFrenzy;

                return RewardOfferType.None;
            }
        }

        /// <summary>Sisa cooldown skill milik pemain lokal (0 bila tidak ada skill/cooldown).</summary>
        private static float CooldownRemaining(PlayerController me)
        {
            if (me.Role == GameRole.Hider && me.HiderSkills != null) return me.HiderSkills.CooldownRemaining;
            if (me.Role == GameRole.Seeker && me.SeekerSkills != null) return me.SeekerSkills.CooldownRemaining;
            return 0f;
        }

        /// <summary>Label tombol (Bahasa Indonesia pendek, muat di HUD mobile).</summary>
        public string OfferLabel
        {
            get
            {
                switch (CurrentOffer)
                {
                    case RewardOfferType.HiderRevive: return "HIDUP LAGI";
                    case RewardOfferType.CooldownSkip: return "SKIP COOLDOWN";
                    case RewardOfferType.SeekerFrenzy: return "FRENZY 10s";
                    default: return "";
                }
            }
        }

        /// <summary>Sisa kuota, untuk sub-label ("2x lagi").</summary>
        public string QuotaLabel
        {
            get
            {
                int left = RemainingFor(CurrentOffer);
                return left > 0 ? left + "x lagi ronde ini" : "kuota habis";
            }
        }

        private int RemainingFor(RewardOfferType t)
        {
            switch (t)
            {
                case RewardOfferType.HiderRevive: return Mathf.Max(0, maxRevivesPerRound - revivesUsed);
                case RewardOfferType.CooldownSkip: return Mathf.Max(0, maxCooldownSkips - skipsUsed);
                case RewardOfferType.SeekerFrenzy: return Mathf.Max(0, maxFrenzies - frenziesUsed);
                default: return 0;
            }
        }

        // =============================== REQUEST ===============================

        /// <summary>
        /// Dipanggil tombol HUD: tampilkan iklan, lalu (bila reward earned) berikan hadiahnya.
        /// Tidak ada jalur lain untuk mendapat reward - grant hanya lewat callback AdsManager.
        /// </summary>
        public void RequestCurrentOffer()
        {
            RewardOfferType offer = CurrentOffer;
            if (offer == RewardOfferType.None) { Log("tidak ada penawaran aktif"); return; }
            if (busy) return;
            busy = true;

            AdsManager ads = AdsManager.EnsureExists();
            ads.ShowRewarded(earned =>
            {
                busy = false;
                if (!earned)
                {
                    Toast("Iklan belum selesai ditonton - reward tidak diberikan.");
                    Raise();
                    return;
                }
                Grant(offer);
                Raise();
            });
        }

        /// <summary>Eksekusi hadiahnya (dipanggil hanya setelah iklan sukses).</summary>
        private void Grant(RewardOfferType offer)
        {
            PlayerController me = Me;
            if (me == null) return;

            switch (offer)
            {
                case RewardOfferType.HiderRevive:
                    revivesUsed++;
                    // Ajukan ke Host. Host yang memvalidasi & broadcast RPC, jadi klien lain
                    // tidak bisa menyangkal state (revive "hantu" tanpa izin host diabaikan).
                    HideSeekConstants.Net.RaiseMaster(HideSeekConstants.EvtRewardRevive,
                        new ExitGames.Client.Photon.Hashtable { { "a", PhotonNetwork.LocalPlayer != null ? PhotonNetwork.LocalPlayer.ActorNumber : 0 } },
                        true);
                    Toast("Mengirim permintaan revive ke Host...");
                    break;

                case RewardOfferType.CooldownSkip:
                    skipsUsed++;
                    if (me.Role == GameRole.Hider && me.HiderSkills != null) me.HiderSkills.SkipCooldown(0);
                    if (me.Role == GameRole.Seeker && me.SeekerSkills != null) me.SeekerSkills.SkipCooldown();
                    Toast("Cooldown direset!");
                    break;

                case RewardOfferType.SeekerFrenzy:
                    frenziesUsed++;
                    me.ApplySpeedBoost(HideSeekConstants.FrenzySpeedMultiplier,
                                       HideSeekConstants.FrenzyDuration,
                                       HideSeekConstants.FrenzyCatchRangeBonus);
                    Toast("FRENZY! +" + Mathf.RoundToInt((HideSeekConstants.FrenzySpeedMultiplier - 1f) * 100f) +
                          "% kecepatan, jangkauan tangkap +" +
                          HideSeekConstants.FrenzyCatchRangeBonus.ToString("0.0") + "m");
                    break;
            }
        }

        private void Toast(string m)
        {
            var gm = GameManager.Instance;
            if (gm != null) gm.Announce(m);
            Log(m);
        }

        private void Raise()
        {
            if (OnOffersChanged != null) OnOffersChanged();
        }

        private void Log(string m) { if (verboseLogs) Debug.Log("[HideSeek/Reward] " + m); }
    }
}
