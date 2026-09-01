// ============================================================================
//  UIManager.cs   (SCRIPT #7 - wajib)
//  Menangani SEMUA HUD: label phase + timer besar, countdown 5..1, HP bar/hearts,
//  2 tombol skill dengan cooldown fill, minimap, toast, panel LOBBY dan panel RESULT
//  (termasuk leaderboard yang dibangun dari GameManager.BuildLeaderboard()).
//
//  KEBIJAKAN REFERENSI: semua reference adalah field public -> assign manual di
//  Inspector (sesuai permintaan). Boleh dikosongkan; setiap method null-safe,
//  sehingga UI bisa di-build bertahap tanpa error.
// ============================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Network;
using HideSeek.Players;
using HideSeek.Skills;
using HideSeek.Utils;
using Photon.Pun;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    [DisallowMultipleComponent]
    public class UIManager : MonoBehaviour
    {
        public static UIManager Instance { get; private set; }

        // ============================== KLASSES ================================
        [Serializable]
        public class SkillButtonConfig
        {
            [Tooltip("Tombol skill (slot 0 = kiri, slot 1 = kanan).")]
            public Button button;
            [Tooltip("Image dengan Image.Type = Filled (radial/horizontal) untuk cooldown.")]
            public Image cooldownFill;
            [Tooltip("Label di dalam tombol (nomor cooldown).")]
            public Text cooldownText;
            [Tooltip("Teks tombol saat masih Hider.")]
            public string hiderLabel = "Skill";
            [Tooltip("Teks tombol saat Seeker.")]
            public string seekerLabel = "Skill";
        }

        // ============================ PANELS ==================================
        [Header("Panel (assign manual)")]
        public GameObject lobbyPanel;
        public GameObject hudPanel;
        public GameObject resultPanel;
        public GameObject countdownOverlay;
        public GameObject minimapRoot;

        [Header("Teks status")]
        public Text phaseText;
        public Text timerText;
        public Text roleText;
        public Text playersText;
        public Text countdownText;
        public Text connectionText;
        public Text phaseHintText;

        [Header("HP (Hider)")]
        [Tooltip("Image Filled 0..1 (opsional).")]
        public Image hpBar;
        public Text hpText;
        [Tooltip("3 buah Image hati: aktif = warna penuh, habis = alpha 0.2 (opsional).")]
        public Image[] hearts;

        [Header("Skill (2 tombol utk Seeker, 3 utk Hider)")]
        [Tooltip("Slot 2 khusus Hider: Bekukan/Freeze (paritas web: skill3 + Icon_Freeze).")]
        public SkillButtonConfig[] skills = new SkillButtonConfig[]
        {
            new SkillButtonConfig { hiderLabel = "Kamuflase", seekerLabel = "Radar" },
            new SkillButtonConfig { hiderLabel = "Prop Swap", seekerLabel = "Sonic Blast" },
            new SkillButtonConfig { hiderLabel = "Bekukan", seekerLabel = "" }
        };

        [Header("Referensi lain")]
        public MobileJoystick joystick;
        public MinimapRadarView minimap;

        [Header("Rewarded ad (opsional - lihat Monetization/RewardOffers.cs)")]
        [Tooltip("Tombol reward di HUD. Kosong = tidak ada tombol, reward tetap bisa dipanggil dari kode.")]
        public Button rewardButton;
        [Tooltip("Label aksi di dalam tombol ("HIDUP LAGI", dst).")]
        public Text rewardLabel;
        [Tooltip("Teks kecil sisa kuota.")]
        public Text rewardQuotaText;
        [Tooltip("Objek pembungkus tombol (pakai ini bila tombol berada di panel khusus).")]
        public GameObject rewardRoot;

        [Header("Toast")]
        public GameObject toastRoot;
        public Text toastText;
        [Range(0.5f, 8f)] public float toastDuration = 2.2f;

        [Header("Result & Leaderboard (assign manual)")]
        public Text resultTitleText;
        public Text resultDetailText;
        public RectTransform leaderboardRoot;
        public LeaderboardRow leaderboardRowPrefab;

        [Tooltip("true = UIManager menambahkan listener onClick otomatis ke tombol di bawah ini. " +
                 "Matikan bila Anda sudah wiring tombol lewat Inspector (biar tidak dobel).")]
        public bool autoWireButtons = true;

        [Header("Tombol")]
        public Button startButton;
        public Button leaveButton;
        public Button nextRoundButton;
        public Button quickPlayButton;
        public Button createRoomButton;
        public Button refreshRoomsButton;

        // =============================== CACHE ================================
        private GameManager gm;
        private PlayerController localController;
        private int hpShown = -1;
        private int lastCountdown = int.MaxValue;
        private string lastTimerShown = "";
        private bool wired;
        private readonly List<LeaderboardRow> rowPool = new List<LeaderboardRow>(12);
        private Coroutine toastRoutine;

        // ============================== LIFECYCLE ==============================
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
            WireButtons();
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        private void OnEnable()
        {
            BindGameManager(true);
            if (toastRoot != null) toastRoot.SetActive(false);
        }

        private void OnDisable() { BindGameManager(false); }

        private void Start()
        {
            RefreshLobbyVisibility();
        }

        private void Update()
        {
            if (gm == null) BindGameManager(true);

            HandleShortcuts();
            UpdateStatusTexts();
            UpdateTimerText();
            UpdateSkillButtons();
            UpdateHpBar();
            UpdateRewardButton();
            TryResolveLocalController();
        }

        // ============================== BINDING ================================

        /// <summary>Daftarkan/unregistrar event GameManager (aman dipanggil berkali-kali).</summary>
        private void BindGameManager(bool subscribe)
        {
            GameManager g = GameManager.Instance;
            if (g == null) { if (!subscribe) gm = null; return; }

            if (subscribe)
            {
                g.OnPhaseChanged -= HandlePhaseChanged;
                g.OnPhaseChanged += HandlePhaseChanged;
                g.OnCountdownTick -= HandleCountdownTick;
                g.OnCountdownTick += HandleCountdownTick;
                g.OnNotice -= HandleNotice;
                g.OnNotice += HandleNotice;
                g.OnLocalRoleAssigned -= HandleRoleAssigned;
                g.OnLocalRoleAssigned += HandleRoleAssigned;
                g.OnRoundFinished -= HandleRoundFinished;
                g.OnRoundFinished += HandleRoundFinished;
            }
            else
            {
                g.OnPhaseChanged -= HandlePhaseChanged;
                g.OnCountdownTick -= HandleCountdownTick;
                g.OnNotice -= HandleNotice;
                g.OnLocalRoleAssigned -= HandleRoleAssigned;
                g.OnRoundFinished -= HandleRoundFinished;
            }
            gm = subscribe ? g : null;
        }

        /// <summary>Cari PlayerController milik pemain lokal (spawn bisa terjadi setelah UI dibuat).</summary>
        private void TryResolveLocalController()
        {
            if (localController != null) return;
            if (PhotonNetwork.LocalPlayer == null) return;
            PlayerController pc = PlayerRegistry.Get(PhotonNetwork.LocalPlayer.ActorNumber);
            if (pc == null) return;

            localController = pc;
            if (pc.Combat != null)
            {
                pc.Combat.OnHpChanged -= HandleHpChanged;
                pc.Combat.OnHpChanged += HandleHpChanged;
                HandleHpChanged(pc.Combat.Hp, pc.Combat.MaxHp);
            }
            HandleRoleAssigned(pc.Role);
        }

        private void WireButtons()
        {
            if (wired) return;
            wired = true;

            // Tombol start / next round -> minta Host memulai ronde.
            SafeListen(startButton, delegate { if (GameManager.Instance != null) GameManager.Instance.RequestStartMatch(); });
            SafeListen(nextRoundButton, delegate { if (GameManager.Instance != null) GameManager.Instance.RequestNextRound(); });
            SafeListen(leaveButton, delegate { if (NetworkManager.Instance != null) NetworkManager.Instance.LeaveRoom(true); });
            SafeListen(quickPlayButton, delegate { if (NetworkManager.Instance != null) NetworkManager.Instance.JoinQuickPlay(); });
            SafeListen(createRoomButton, delegate { if (NetworkManager.Instance != null) NetworkManager.Instance.CreateRoom(null, false); });
            SafeListen(refreshRoomsButton, delegate { if (RoomListUI.Instance != null) RoomListUI.Instance.RefreshNow(); else if (NetworkManager.Instance != null) NetworkManager.Instance.RefreshRoomList(); });

            // Tombol reward (rewarded ad): teks & kelayakan dihitung RewardOffers tiap frame.
            SafeListen(rewardButton, delegate
            {
                var ro = HideSeek.Monetization.RewardOffers.Instance;
                if (ro == null) ro = HideSeek.Monetization.RewardOffers.EnsureExists();
                ro.RequestCurrentOffer();
            });

            // Tombol skill -> langsung ke komponen skill pemain lokal.
            if (!autoWireButtons) return;
            for (int i = 0; i < skills.Length; i++)
            {
                int slot = i;
                if (skills[i] != null && skills[i].button != null)
                {
                    skills[i].button.onClick.RemoveAllListeners();
                    skills[i].button.onClick.AddListener(delegate { OnSkillClicked(slot); });
                }
            }
        }

        /// <summary>Tambah listener bila autoWireButtons = true (matikan bila tombol sudah di-wire manual di Inspector).</summary>
        private void SafeListen(Button b, UnityEngine.Events.UnityAction action)
        {
            if (b == null || !autoWireButtons) return;
            b.onClick.AddListener(action);
        }

        // ============================= HUD UPDATE ===============================

        private void UpdateStatusTexts()
        {
            if (playersText != null && PhotonNetwork.InRoom && PhotonNetwork.CurrentRoom != null)
                playersText.text = "Pemain: " + PhotonNetwork.CurrentRoom.PlayerCount + "/" + PhotonNetwork.CurrentRoom.MaxPlayers;

            if (connectionText != null && NetworkManager.Instance != null)
                connectionText.text = NetworkManager.Instance.ConnectionStatus;
        }

        /// <summary>Label phase + timer besar (00:SS) + warna kritis.</summary>
        private void UpdateTimerText()
        {
            if (gm == null) return;
            // HUD v2: MM:SS + 3 state warna (biru / kuning <10s / merah <=5s) + detak saat genting.
            string t = HudV2Theme.Clock(gm.StateRemaining);
            if (t != lastTimerShown)
            {
                lastTimerShown = t;
                if (timerText != null)
                {
                    timerText.text = t;
                    timerText.color = HudV2Theme.TimerColor(gm.StateRemaining);
                }
            }
            if (timerText != null)
            {
                float k = HudV2Theme.TimerPulse(gm.StateRemaining);
                var tr = timerText.rectTransform;
                if (tr != null) tr.localScale = Vector3.one * k;
            }
            if (phaseText != null) phaseText.text = PhaseLabel(gm.State);
        }

        /// <summary>Nama fase untuk HUD (Bahasa Indonesia, singkat).</summary>
        private static string PhaseLabel(GameState s)
        {
            switch (s)
            {
                case GameState.Lobby: return "LOBBY";
                case GameState.Countdown: return "SIAP-SIAP";
                case GameState.HidePhase: return "FASE BERSEMBUNYI";
                case GameState.SeekPhase: return "FASE MENGEJAR";
                case GameState.Result: return "HASIL";
                default: return s.ToString();
            }
        }

        /// <summary>Isi HP bar / hearts / teks dari PlayerCombat lokal.</summary>
        private void UpdateHpBar()
        {
            if (localController == null || localController.Combat == null) return;
            var c = localController.Combat;
            if (c.Hp == hpShown) return;
            HandleHpChanged(c.Hp, c.MaxHp);
        }

        private void HandleHpChanged(int current, int max)
        {
            hpShown = current;
            if (hpBar != null) hpBar.fillAmount = max > 0 ? Mathf.Clamp01(current / (float)max) : 0f;
            if (hpText != null) hpText.text = "HP " + current + "/" + max;

            if (hearts != null)
            {
                for (int i = 0; i < hearts.Length; i++)
                {
                    if (hearts[i] == null) continue;
                    Color col = hearts[i].color;
                    col.a = i < current ? 1f : 0.18f;
                    hearts[i].color = col;
                    hearts[i].gameObject.SetActive(true);
                }
            }
        }

        /// <summary>Update 2 tombol skill: label sesuai role + cooldown fill + interactable.</summary>
        private void UpdateSkillButtons()
        {
            if (skills == null) return;
            HiderSkill hs = localController != null ? localController.HiderSkills : null;
            SeekerSkill ss = localController != null ? localController.SeekerSkills : null;

            for (int i = 0; i < skills.Length; i++)
            {
                SkillButtonConfig cfg = skills[i];
                if (cfg == null) continue;

                bool isSeeker = localController != null && localController.Role == GameRole.Seeker;
                bool freezeSlot = i == 2;
                // Slot ke-3 khusus Hider (Bekukan) -> disembunyikan untuk Seeker, bukan sekadar disabled.
                if (freezeSlot && cfg.button != null && cfg.button.gameObject != null)
                    cfg.button.gameObject.SetActive(!isSeeker);
                if (freezeSlot && isSeeker) continue;

                float remain = 0f, total = 1f;

                if (isSeeker && ss != null) { remain = ss.CooldownRemaining; total = Mathf.Max(0.01f, ss.cooldown); }
                else if (hs != null && freezeSlot) { remain = hs.FreezeCooldownRemaining; total = Mathf.Max(0.01f, HideSeekConstants.FreezeCooldown); }
                else if (hs != null) { remain = hs.CooldownRemaining; total = Mathf.Max(0.01f, hs.cooldown); }

                if (cfg.button != null)
                {
                    bool usable = localController != null && !localController.IsGhost && remain <= 0f &&
                                  (gm == null || gm.CanUseSkills(localController.Role));
                    cfg.button.interactable = usable;
                }
                if (cfg.cooldownFill != null)
                    cfg.cooldownFill.fillAmount = Mathf.Clamp01(remain / total);
                if (cfg.cooldownText != null)
                {
                    cfg.cooldownText.text = remain > 0.05f ? Mathf.CeilToInt(remain).ToString()
                        : (i == 0 ? (isSeeker ? "R" : "C") : i == 1 ? (isSeeker ? "B" : "P") : "F");
                    cfg.cooldownText.color = remain > 0.05f ? Color.white : new Color(1f, 1f, 1f, 0.75f);
                }
            }
        }

        /// <summary>Ganti label tombol skill sesuai role yang di-assign Host.</summary>
        private void HandleRoleAssigned(GameRole role)
        {
            if (roleText != null)
                roleText.text = role == GameRole.Seeker ? "Kamu SEEKER - kejar & sentuh!" :
                                role == GameRole.Hider ? "Kamu HIDER - sembunyi!" : "Menunggu role...";

            if (skills != null)
            {
                for (int i = 0; i < skills.Length; i++)
                {
                    var cfg = skills[i];
                    if (cfg == null || cfg.button == null) continue;
                    var lbl = cfg.button.GetComponentInChildren<Text>();
                    if (i == 2 && cfg.button != null && cfg.button.gameObject != null)
                        cfg.button.gameObject.SetActive(role != GameRole.Seeker);
                    if (lbl != null) lbl.text = role == GameRole.Seeker ? cfg.seekerLabel : cfg.hiderLabel;
                }
            }
            if (phaseHintText != null && gm != null)
                phaseHintText.text = role == GameRole.Seeker
                    ? "Tap/klik pada Hider untuk menangkap (max 3 unit)."
                    : "Skill 1: menyatu dengan warna lantai. Skill 2: jadi prop (jangan bergerak!). Skill 3: bekukan Seeker di sekitarmu.";
        }

        /// <summary>Dipanggil PlayerController.SetSpectator: matikan tombol & tampilkan mode hantu.</summary>
        public void SetGhostMode(bool ghost)
        {
            if (hudPanel != null)
            {
                // tombol skill & joystick tidak berguna untuk hantu
                for (int i = 0; i < skills.Length; i++)
                    if (skills[i] != null && skills[i].button != null) skills[i].button.interactable = !ghost;
                if (joystick != null) joystick.gameObject.SetActive(!ghost);
            }
            if (phaseHintText != null && ghost) phaseHintText.text = "Kamu jadi hantu - tidak bisa bergerak. Tunggu ronde selesai.";
        }

        // ======================== STATE / PANEL VISIBILITY ======================

        /// <summary>Sinkronkan panel dengan state game (dipanggil di Start & tiap pergantian fase).</summary>
        private void RefreshLobbyVisibility()
        {
            GameState s = gm != null ? gm.State : GameState.Lobby;
            bool lobby = s == GameState.Lobby;

            if (lobbyPanel != null) lobbyPanel.SetActive(lobby);
            if (hudPanel != null) hudPanel.SetActive(!lobby);
            if (minimapRoot != null) minimapRoot.SetActive(!lobby);
            if (resultPanel != null) resultPanel.SetActive(s == GameState.Result);
            if (joystick != null) joystick.gameObject.SetActive(!lobby);

            if (gm != null)
            {
                HandlePhaseChanged(s, gm.StateRemaining);
                HandleRoleAssigned(gm.LocalRole);
            }
        }

        /// <summary>Callback dari GameManager saat fase berganti (di semua klien).</summary>
        private void HandlePhaseChanged(GameState state, float remaining)
        {
            lastTimerShown = "";      // paksa refresh teks
            if (phaseText != null) phaseText.text = PhaseLabel(state);
            if (timerText != null) timerText.text = Net.FormatTime(remaining);

            if (hudPanel != null) hudPanel.SetActive(state != GameState.Lobby);
            if (lobbyPanel != null) lobbyPanel.SetActive(state == GameState.Lobby);
            if (countdownOverlay != null) countdownOverlay.SetActive(state == GameState.Countdown);
            if (resultPanel != null) resultPanel.SetActive(state == GameState.Result);
            if (minimapRoot != null) minimapRoot.SetActive(state != GameState.Lobby);

            switch (state)
            {
                case GameState.Countdown:
                    if (phaseHintText != null) phaseHintText.text = "Cari tempat persembunyian!";
                    break;
                case GameState.HidePhase:
                    if (phaseHintText != null) phaseHintText.text = "Hider: bergerak bebas, hindari garis pandang Seeker.";
                    break;
                case GameState.SeekPhase:
                    if (phaseHintText != null) phaseHintText.text = "Seeker bangun! Tangkap semua Hider.";
                    break;
                case GameState.Result:
                    ShowResult();
                    break;
            }
            if (localController != null) SetGhostMode(localController.IsGhost);
        }

        /// <summary>Angka besar 5-4-3-2-1 saat COUNTDOWN.</summary>
        private void HandleCountdownTick(int wholeSeconds)
        {
            if (countdownText == null) return;
            if (wholeSeconds == lastCountdown) return;
            lastCountdown = wholeSeconds;
            countdownText.text = wholeSeconds > 0 ? wholeSeconds.ToString() : "GO!";
            if (countdownOverlay != null) countdownOverlay.SetActive(true);
            StartCoroutine(CoroutinePunch(countdownText.rectTransform));
        }

        /// <summary>Efek "punch" sederhana pada angka countdown (tanpa DOTween).</summary>
        private IEnumerator CoroutinePunch(RectTransform rt)
        {
            if (rt == null) yield break;
            float t = 0f;
            Vector3 start = rt.localScale;
            while (t < 0.25f)
            {
                t += Time.deltaTime;
                float k = 1f + Mathf.Sin(Mathf.Clamp01(t / 0.25f) * Mathf.PI) * 0.4f;
                rt.localScale = start * k;
                yield return null;
            }
            rt.localScale = start;
        }

        private float rewardRefreshAt;

        /// <summary>
        /// Sinkronkan tombol rewarded-ad (~5x per detik, murah): tampil hanya bila ada
        /// penawaran aktif, ronde sedang berjalan, dan tidak ada iklan yang sedang tayang.
        /// </summary>
        private void UpdateRewardButton()
        {
            GameObject go = rewardRoot != null ? rewardRoot
                          : (rewardButton != null ? rewardButton.gameObject : null);
            if (go == null) return;
            if (Time.unscaledTime < rewardRefreshAt) return;
            rewardRefreshAt = Time.unscaledTime + 0.2f;

            var ro = HideSeek.Monetization.RewardOffers.Instance;
            if (ro == null) ro = HideSeek.Monetization.RewardOffers.EnsureExists();

            bool adsBusy = HideSeek.Monetization.AdsManager.Instance != null &&
                           HideSeek.Monetization.AdsManager.Instance.IsShowing;
            bool visible = ro.offersEnabled && !adsBusy && gm != null && gm.IsRoundRunning &&
                           ro.CurrentOffer != HideSeek.Monetization.RewardOfferType.None;

            if (go.activeSelf != visible) go.SetActive(visible);
            if (!visible) return;
            if (rewardLabel != null) rewardLabel.text = ro.OfferLabel;
            if (rewardQuotaText != null) rewardQuotaText.text = ro.QuotaLabel;
        }

        private void HandleNotice(string msg) { ShowToast(msg); }

        private void HandleRoundFinished()
        {
            ShowResult();
            // Hider menulis statistik bertahan miliknya sendiri saat ronde berakhir.
            if (localController != null && localController.Combat != null)
                localController.Combat.WriteStatsToPlayerProperties();
        }

        // ============================== TOAST ==================================

        // ============================ FREEZE (skill #3) =======================

        [Tooltip("Root transform tempat ring efek Bekukan dibuat (boleh kosong = tanpa ring).")]
        public Transform freezeFxRoot;
        [Tooltip("Prefab ring efek Bekukan (kosong = pakai kotak sementara, seperti SonicBlastEffect).")]
        public GameObject freezeRingPrefab;

        /// <summary>Posisi & sisa waktu pulsa Freeze terakhir (dipakai efek/minimap). 0 = tidak ada.</summary>
        [HideInInspector] public Vector2 lastFreezePos;
        [HideInInspector] public float lastFreezeUntil;

        /// <summary>
        /// Dipanggil HiderSkill saat skill Bekukan dipakai: simpan data pulsa + toast.
        /// Ring visual dibuat di sini (bukan di skill) supaya efek tetap konsisten di semua klien
        /// dan tidak menambah dependensi script skill ke sistem VFX.
        /// </summary>
        public void NotifyFreeze(Vector2 worldPos, float radius)
        {
            lastFreezePos = worldPos;
            lastFreezeUntil = Time.time + HideSeekConstants.FreezeDuration;
            ShowToast("Bekukan! radius " + radius.ToString("0.0") + " unit");
            if (freezeRingPrefab != null && freezeFxRoot != null)
            {
                var go = Instantiate(freezeRingPrefab, worldPos, Quaternion.identity, freezeFxRoot);
                go.transform.localScale = Vector3.one * Mathf.Max(1f, radius * 2f);
                Destroy(go, 0.6f);
            }
        }

        /// <summary>Pesan singkat di tengah-bawah layar (dipanggil juga oleh NetworkManager & skills).</summary>
        public void ShowToast(string message)
        {
            if (string.IsNullOrEmpty(message)) return;
            if (toastText != null) toastText.text = message;
            if (toastRoot != null) toastRoot.SetActive(true);
            if (toastRoutine != null) StopCoroutine(toastRoutine);
            toastRoutine = StartCoroutine(CoroutineToast(toastDuration));
        }

        private IEnumerator CoroutineToast(float duration)
        {
            yield return new WaitForSeconds(Mathf.Max(0.3f, duration));
            if (toastRoot != null) toastRoot.SetActive(false);
            toastRoutine = null;
        }

        // ============================ RESULT PANEL =============================

        /// <summary>Tampilkan panel hasil (pemenang + leaderboard).</summary>
        public void ShowResult()
        {
            if (gm == null) return;
            if (resultPanel != null) resultPanel.SetActive(true);

            string title;
            switch (gm.LastWinner)
            {
                case WinnerType.Hiders: title = "HIDER MENANG!"; break;
                case WinnerType.Seeker: title = "SEEKER MENANG!"; break;
                default: title = "RONDE SELESAI"; break;
            }
            if (resultTitleText != null)
            {
                resultTitleText.text = title;
                resultTitleText.color = gm.LastWinner == WinnerType.Hiders
                    ? new Color(0.35f, 0.85f, 1f) : new Color(1f, 0.4f, 0.35f);
            }

            if (resultDetailText != null)
            {
                string extra = gm.LastWinner == WinnerType.Hiders && !string.IsNullOrEmpty(gm.LastHiderName)
                    ? " Hider terakhir: " + gm.LastHiderName
                    : "";
                resultDetailText.text = "Ronde " + gm.Round + extra +
                                        "\nHider selamat: " + gm.LivingHiderCount +
                                        "\nWaktu sisa: " + Net.FormatTime(gm.StateRemaining);
            }
            BuildLeaderboard();

            // HUD v2: rekor lokal (PlayerPrefs, top-10) - kosmetik, sama seperti web (hideseek_scores).
            if (gm != null && HudV2LocalBoard.Available)
            {
                List<GameManager.LeaderboardEntry> rows = gm.BuildLeaderboard();
                string me = LocalPlayerName;
                for (int i = 0; i < rows.Count; i++)
                {
                    if (rows[i].name != me) continue;
                    HudV2LocalBoard.Submit(me, rows[i].score);
                    break;
                }
                HudV2LocalBoard.RefreshNow();
            }
        }

        /// <summary>Bangun ulang baris leaderboard dari data room (pooling sederhana).</summary>
        public void BuildLeaderboard()
        {
            if (leaderboardRoot == null || gm == null) return;

            List<GameManager.LeaderboardEntry> entries = gm.BuildLeaderboard();

            // Buang baris yang objeknya sudah terhapus (mis. setelah pindah scene).
            for (int i = rowPool.Count - 1; i >= 0; i--)
                if (rowPool[i] == null) rowPool.RemoveAt(i);

            for (int i = 0; i < rowPool.Count; i++)
                if (rowPool[i] != null) rowPool[i].gameObject.SetActive(i < entries.Count);

            string myName = PhotonNetwork.LocalPlayer != null ? PhotonNetwork.LocalPlayer.NickName : null;

            for (int i = 0; i < entries.Count; i++)
            {
                LeaderboardRow row = i < rowPool.Count ? rowPool[i] : CreateRow();
                if (row == null) continue;
                row.gameObject.SetActive(true);
                row.Fill(i + 1, entries[i], !string.IsNullOrEmpty(myName) && myName == entries[i].name);
            }
        }

        /// <summary>Instansiasi 1 baris leaderboard (pakai prefab bila ada, kalau tidak: baris teks sederhana).</summary>
        private LeaderboardRow CreateRow()
        {
            if (leaderboardRoot == null) return null;

            GameObject go = leaderboardRowPrefab != null
                ? Instantiate(leaderboardRowPrefab.gameObject, leaderboardRoot)
                : BuildFallbackRow();
            if (go == null) return null;

            var row = go.GetComponent<LeaderboardRow>();
            if (row == null) row = go.AddComponent<LeaderboardRow>();

            // Auto-bind child Text jika user belum assign di prefab (urut nama objek).
            if (row.nameText == null) row.nameText = FindText(go.transform, "Name");
            if (row.roleText == null) row.roleText = FindText(go.transform, "Role");
            if (row.detailText == null) row.detailText = FindText(go.transform, "Detail");
            if (row.scoreText == null) row.scoreText = FindText(go.transform, "Score");
            if (row.highlight == null) row.highlight = go.GetComponent<Image>();

            rowPool.Add(row);
            return row;
        }

        /// <summary>Baris cadangan: HorizontalLayoutGroup + 4 Text, agar leaderboard tetap muncul tanpa prefab.</summary>
        private GameObject BuildFallbackRow()
        {
            var go = new GameObject("row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(Image), typeof(LayoutElement));
            go.transform.SetParent(leaderboardRoot, false);

            var img = go.GetComponent<Image>();
            img.color = new Color(1f, 1f, 1f, 0.06f);

            var h = go.GetComponent<HorizontalLayoutGroup>();
            h.childAlignment = TextAnchor.MiddleLeft;
            h.spacing = 8;
            h.padding = new RectOffset(8, 8, 2, 2);
            h.childControlWidth = true; h.childForceExpandWidth = true;
            h.childControlHeight = true; h.childForceExpandHeight = true;
            go.GetComponent<LayoutElement>().minHeight = 28;

            CreateColumn(go.transform, "Name", 3f);
            CreateColumn(go.transform, "Role", 1.2f);
            CreateColumn(go.transform, "Detail", 2f);
            CreateColumn(go.transform, "Score", 0.9f);
            return go;
        }

        private static void CreateColumn(Transform parent, string name, float layoutPriority)
        {
            var t = new GameObject(name, typeof(RectTransform), typeof(Text));
            t.transform.SetParent(parent, false);
            var txt = t.GetComponent<Text>();
            txt.text = "-";
            txt.fontSize = 18;
            txt.alignment = TextAnchor.MiddleLeft;
            txt.color = Color.white;
            txt.horizontalOverflow = HorizontalWrapMode.Overflow;
            var le = t.AddComponent<LayoutElement>();
            le.flexibleWidth = layoutPriority;
        }

        private static Text FindText(Transform root, string name)
        {
            Transform t = root.Find(name);
            if (t != null) return t.GetComponent<Text>();
            // cari dalam 1 level child juga
            foreach (Transform child in root)
            {
                if (child.name.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    var txt = child.GetComponent<Text>();
                    if (txt != null) return txt;
                }
            }
            return null;
        }

        // ================================ MISC =================================

        /// <summary>
        /// Routing skill sesuai role lokal. propId (slot 1, Hider) = wujud hasil "tahan -> seret ->
        /// lepas" pada HudV2SkillButton; 0 = biarkan game memilih (perilaku lama).
        /// </summary>
        public void UseSkill(int slot, byte propId = 0)
        {
            if (localController == null) { ShowToast("Player belum siap."); return; }
            if (localController.IsGhost) { ShowToast("Hantu tidak bisa memakai skill."); return; }

            if (localController.Role == GameRole.Seeker && localController.SeekerSkills != null)
                localController.SeekerSkills.TryUseSkill(slot);
            else if (localController.Role == GameRole.Hider && localController.HiderSkills != null)
                localController.HiderSkills.TryUseSkill(slot, propId);
        }

        /// <summary>Tombol skill (HUD lama) -> routing yang sama dengan HUD v2.</summary>
        private void OnSkillClicked(int slot)
        {
            UseSkill(slot, 0);
        }

        /// <summary>Shortcut desktop: 1 / 2 = skill, Space = start (host). Tidak mengganggu di mobile.</summary>
        private void HandleShortcuts()
        {
            if (Input.GetKeyDown(KeyCode.Alpha1)) OnSkillClicked(0);
            if (Input.GetKeyDown(KeyCode.Alpha2)) OnSkillClicked(1);
            if (Input.GetKeyDown(KeyCode.Space) && gm != null && gm.State == GameState.Lobby) gm.RequestStartMatch();
        }

        /// <summary>Akses joystick untuk PlayerController (bisa null bila UI tidak memakainya).</summary>
        public MobileJoystick Joystick { get { return joystick; } }

        /// <summary>Controller pemain lokal (dipakai widget HUD v2 - jangan mengubah state dari sini).</summary>
        public PlayerController LocalController { get { return localController; } }

        /// <summary>Nama pemain lokal (untuk penanda baris di papan skor lokal HUD v2).</summary>
        public string LocalPlayerName
        {
            get { return PhotonNetwork.LocalPlayer != null ? PhotonNetwork.LocalPlayer.NickName : string.Empty; }
        }
        /// <summary>Akses minimap untuk SeekerSkill (bisa null).</summary>
        public MinimapRadarView Minimap { get { return minimap; } }
    }
}
