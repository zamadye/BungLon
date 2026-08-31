// ============================================================================
//  GameManager.cs   (SCRIPT #2 - wajib)
//  - STATE MACHINE: LOBBY -> COUNTDOWN(5s) -> HIDE(30s) -> SEEK(60s) -> RESULT(10s) -> COUNTDOWN
//  - AUTHORITY: hanya Host (MasterClient) yang menjalankan timer & memutuskan transisi.
//  - BROADCAST: transisi state dikirim sebagai [PunRPC] (RpcHostState pada view pemain Host,
//    yang dijamin owned -> legal di PUN2) + ditulis ke room custom property agar late joiner
//    langsung sinkron. Tick timer berfrekuensi tinggi (4Hz) dikirim lewat RaiseEvent UNRELIABLE
//    dengan RaiseEventOptions agar tidak membebani jaringan (lihat Net.RaiseAll).
//  - ASSIGN ROLE: Host mengacak 1 Seeker, sisanya Hider; tiap klien menulis custom property
//    miliknya sendiri (pola resmi PUN2 untuk player properties).
//
//  SETUP: script ini otomatis ditambahkan ke GameObject "HideSeek_GameRoot" oleh NetworkManager.
// ============================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Network;
using HideSeek.Players;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace HideSeek.Game
{
    [DefaultExecutionOrder(-10)]
    public class GameManager : MonoBehaviourPunCallbacks, IOnEventCallback
    {
        // ============================== SINGLETON ==============================
        public static GameManager Instance { get; private set; }

        // ============================ INSPECTOR ================================
        [Header("Durasi ronde (default = spesifikasi)")]
        public int countdownSeconds = HideSeekConstants.CountdownSeconds;
        public int hidePhaseSeconds = HideSeekConstants.HidePhaseSeconds;
        public int seekPhaseSeconds = HideSeekConstants.SeekPhaseSeconds;
        public int resultSeconds = HideSeekConstants.ResultSeconds;

        [Header("Auto flow")]
        [Tooltip("Minimal pemain untuk mulai ronde (1 Seeker + 1 Hider).")]
        [Range(2, HideSeekConstants.RoomHardCap)] public int minPlayersToStart = HideSeekConstants.RoomMinPlayers;

        [Tooltip("Centang agar ronde bisa dimulai walau cuma 1 orang (berguna untuk test sendiri secara online).")]
        public bool allowSoloStart = false;

        [Tooltip(">0: Host otomatis mulai hitung mundur setelah room sepi selama N detik. 0 = manual (tombol Start).")]
        public float autoStartAfterSeconds = 0f;

        [Tooltip("true: kembali otomatis ke COUNTDOWN setelah RESULT selama X detik (0 = tunggu tombol).")]
        public float autoNextRoundSeconds = 0f;

        [Tooltip("true: Host men-load scene game saat ronde dimulai (butuh AutomaticallySyncScene).")]
        public bool loadGameSceneOnStart = false;

        [Header("Debug")]
        public bool verboseLogs = true;

        // ============================== STATE ==================================
        /// <summary>State game saat ini (sinkron di semua klien).</summary>
        public GameState State { get; private set; }

        /// <summary>Detik tersisa untuk state saat ini (client-side ticking + drift correction).</summary>
        public float StateRemaining { get; private set; }

        public int Round { get; private set; }
        public WinnerType LastWinner { get; private set; }
        public int LastHiderActor { get; private set; }
        public string LastHiderName { get; private set; }

        /// <summary>Role lokal (None sampai Host meng-assign).</summary>
        public GameRole LocalRole { get; private set; }

        /// <summary>Jumlah hider yang masih hidup pada ronde ini (cache lokal, update dari RPC/event).</summary>
        public int LivingHiderCount { get; private set; }

        /// <summary>Waktu (Time.time) saat state berakhir. Sumber ticking lokal.</summary>
        private float stateEndTime;

        /// <summary>Counter untuk debounce tick countdown (agar event OnCountdownTick hanya saat angka berubah).</summary>
        private int lastWholeSecond = int.MaxValue;

        /// <summary>Timer broadcast Host -> semua klien (4Hz, unreliable).</summary>
        private float nextTimerBroadcast;

        /// <summary>Waktu sejak room dianggap "siap" untuk auto start.</summary>
        private float readySince = -1f;

        // ============================== EVENTS =================================
        /// <summary>Nama GameObject induk (dibuat oleh NetworkManager, dipakai ulang oleh RewardOffers).</summary>
        public const string GameRootName = "HideSeek_GameRoot";

        public event Action<GameState, float> OnPhaseChanged;
        public event Action<GameState, float> OnTimerTick;
        public event Action<int> OnCountdownTick;
        public event Action<GameRole> OnLocalRoleAssigned;
        public event Action OnRoundFinished;
        public event Action<string> OnNotice;
        /// <summary>Dipanggil saat Host selesai meng-assign role (untuk spawn UI skill/HUD).</summary>
        public event Action OnRolesAssigned;

        // Cache role per actor (dari event EvtAssignRole + custom property player).
        private readonly Dictionary<int, GameRole> roleByActor = new Dictionary<int, GameRole>(16);

        // ============================== LIFECYCLE ==============================
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            State = GameState.Lobby;
            StateRemaining = 0f;
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        private void Update()
        {
            if (!PhotonNetwork.InRoom) return;

            // --- Client-side ticking: semua orang menghitung mundur sendiri (smooth) ---
            if (State != GameState.Lobby)
            {
                StateRemaining = Mathf.Max(0f, stateEndTime - Time.time);

                int whole = Mathf.CeilToInt(StateRemaining);
                if (whole != lastWholeSecond)
                {
                    lastWholeSecond = whole;
                    if (State == GameState.Countdown && OnCountdownTick != null) OnCountdownTick(whole);
                    if (OnTimerTick != null) OnTimerTick(State, StateRemaining);
                }
            }

            if (!IsHost) return;

            // --- Hanya HOST yang mengevaluasi transisi state ---
            if (State != GameState.Lobby && StateRemaining <= 0f)
            {
                AdvanceState();
                return;
            }

            // Heartbeat timer (hemat: unreliable, 4Hz) supaya jam klien tidak melenceng.
            if (State != GameState.Lobby && Time.time >= nextTimerBroadcast)
            {
                nextTimerBroadcast = Time.time + HideSeekConstants.TimerBroadcastInterval;
                RaiseStateTick();
            }

            if (autoStartAfterSeconds > 0f && State == GameState.Lobby) TryAutoStart();
        }

        // ============================ PUBLIC API ===============================

        /// <summary>Tombol "Start Game" di lobby (hanya Host yang boleh eksekusi).</summary>
        public void RequestStartMatch()
        {
            if (!IsHost) { Notice("Hanya Host yang bisa memulai permainan."); return; }
            if (State != GameState.Lobby) { Notice("Ronde sedang berjalan."); return; }
            int players = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            // OfflineMode / allowSoloStart -> boleh mulai 1 orang (test sendirian di editor & device).
            int need = (allowSoloStart || PhotonNetwork.OfflineMode) ? 1 : minPlayersToStart;
            if (players < need)
            {
                Notice("Butuh minimal " + need + " pemain. (test sendirian: centang offlineMode di NetworkManager)");
                return;
            }
            StartRound();
        }

        /// <summary>Host: mulai ronde baru (assign role + COUNTDOWN).</summary>
        public void StartRound()
        {
            if (!IsHost) return;
            Round++;
            revivesByActor.Clear();     // kuota revive (rewarded ad) direset tiap ronde
            AssignRoles();

            if (loadGameSceneOnStart && NetworkManager.Instance != null)
                NetworkManager.Instance.LoadScene(NetworkManager.Instance.gameSceneName);

            EnterState(GameState.Countdown, countdownSeconds);
        }

        /// <summary>Dipanggil PlayerCombat (semua klien) saat satu Hider kehilangan nyawa terakhir.</summary>
        public void OnHiderRemoved()
        {
            PlayerRegistry.RefreshLivingHiders();
            LivingHiderCount = PlayerRegistry.LivingHiderCount;

            // Simpan identitas "Hider terakhir yang bertahan" -> dipakai panel RESULT.
            if (LivingHiderCount == 1)
            {
                PlayerController last = PlayerRegistry.LivingHiders.Count > 0 ? PlayerRegistry.LivingHiders[0] : null;
                if (last != null && last.View != null && last.View.Owner != null)
                {
                    LastHiderActor = last.View.Owner.ActorNumber;
                    LastHiderName = last.View.Owner.NickName;
                }
            }

            if (!IsHost) return;
            if (State == GameState.SeekPhase && LivingHiderCount <= 0)
            {
                // Semua hider tertangkap -> Seeker menang, akhiri ronde lebih awal.
                EndRound(WinnerType.Seeker, 0, null);
            }
        }

        /// <summary>Revive yang sudah dikabulkan per actor pada ronde ini (dikelola Host saja).</summary>
        private readonly Dictionary<int, int> revivesByActor = new Dictionary<int, int>();

        /// <summary>Dipanggil PlayerCombat.RpcRevived di semua klien: perbarui jumlah hider hidup.</summary>
        public void OnHiderRevived()
        {
            PlayerRegistry.RefreshLivingHiders();
            LivingHiderCount = PlayerRegistry.LivingHiderCount;   // UI membaca properti ini tiap frame
        }

        /// <summary>
        /// HOST saja: validasi lalu hidupkan kembali seorang Hider sebagai hadiah rewarded ad.
        /// Syarat: ronde berjalan (Hide/Seek), peminta = pemilik actor, role Hider, sedang mati,
        /// dan kuota per ronde belum habis. Bila lolos, revive disebarkan lewat PunRPC di
        /// view pemain tersebut (lihat PlayerCombat.RpcRevived).
        /// </summary>
        private void GrantRevive(int actor, int senderActor)
        {
            if (actor <= 0 || senderActor != actor) return;                              // tidak boleh revive orang lain
            if (State != GameState.HidePhase && State != GameState.SeekPhase) return;    // di luar ronde: tolak

            PlayerController pc = PlayerRegistry.Get(actor);
            if (pc == null || pc.Combat == null || !pc.Combat.IsDead) return;
            if (pc.Role != GameRole.Hider) return;

            int used;
            revivesByActor.TryGetValue(actor, out used);
            if (used >= HideSeekConstants.MaxRevivesPerRound)
            {
                Notice("Kuota revive untuk ronde ini sudah dipakai.");
                return;
            }
            revivesByActor[actor] = used + 1;

            if (pc.View == null) return;
            pc.View.RPC(nameof(PlayerCombat.RpcRevived), RpcTarget.All, HideSeekConstants.ReviveHp);
            Notice((pc.View.Owner != null ? pc.View.Owner.NickName : "Pemain") + " bangkit lagi! (1 HP)");
        }

        /// <summary>Host: catat tangkapan Seeker untuk leaderboard (Seeker menulis props-nya sendiri, jadi ini hanya toast/notify).</summary>
        public void OnSeekerCatch(int catches)
        {
            if (OnNotice != null) OnNotice("Seeker menangkap hider! (" + catches + ")");
        }

        /// <summary>Kembalikan cache & state ke nol (dipanggil NetworkManager saat LeaveRoom).</summary>
        public void ResetAllStates()
        {
            State = GameState.Lobby;
            StateRemaining = 0f;
            lastWholeSecond = int.MaxValue;
            roleByActor.Clear();
            LocalRole = GameRole.None;
            Round = 0;
            LastWinner = WinnerType.None;
            LivingHiderCount = 0;
            if (OnPhaseChanged != null) OnPhaseChanged(State, 0f);
        }

        // ======================= CALLBACK DARI NETWORK ==========================

        /// <summary>Kita baru saja masuk room: baca state dari room property (late join) atau mulai lobby.</summary>
        public void OnLocalJoinedRoom()
        {
            if (!PhotonNetwork.InRoom) return;
            RefreshRolesFromRoom();
            ApplyStateFromRoomProperties();

            if (IsHost)
            {
                if (State == GameState.Lobby) readySince = Time.time;
                LivingHiderCount = 0;
                Notice("Room dibuat/di-join. Kamu HOST (Authority).");
            }
            else
            {
                Notice("Kamu CLIENT. Host menjalankan timer & state.");
            }
        }

        /// <summary>Pemain masuk/keluar: Host menyesuaikan flow (abort ronde bila kekurangan pemain).</summary>
        public void OnPlayerCountChanged()
        {
            if (!IsHost) return;
            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;

            if (IsRoundRunning && count < minPlayersToStart)
            {
                Notice("Pemain keluar (" + count + "/" + minPlayersToStart + ") -> ronde dibatalkan.");
                EnterState(GameState.Lobby, 0f);
                readySince = Time.time;
                return;
            }

            if (State == GameState.Result && autoNextRoundSeconds <= 0f && count >= minPlayersToStart)
            {
                // RESULT manual: tunggu tombol, tapi beri tahu UI.
                if (OnRoundFinished != null) OnRoundFinished();
            }
        }

        /// <summary>Host sebelumnya keluar: klien baru jadi Authority -> ambil alih timer.</summary>
        public void OnAuthorityChanged()
        {
            if (!IsHost) return;
            Notice("Kamu sekarang HOST. Timer diambil alih.");
            stateEndTime = Time.time + StateRemaining;   // mulai hitung dari sisa waktu terakhir
            nextTimerBroadcast = 0f;
            readySince = State == GameState.Lobby ? Time.time : -1f;
        }

        /// <summary>Putus koneksi: reset agar UI kembali ke lobby.</summary>
        public void OnDisconnectedFromGame(DisconnectCause cause)
        {
            if (cause == DisconnectCause.DisconnectByClientLogic) return;
            ResetAllStates();
        }

        public override void OnPlayerEnteredRoom(Player newPlayer) { OnPlayerCountChanged(); }
        public override void OnPlayerLeftRoom(Player otherPlayer) { OnPlayerCountChanged(); }

        /// <summary>Ronde sedang berjalan? (dipakai NetworkManager untuk set spectator late join)</summary>
        public bool IsRoundRunning
        {
            get
            {
                return State == GameState.Countdown || State == GameState.HidePhase || State == GameState.SeekPhase;
            }
        }

        /// <summary>Apakah skill boleh dipakai? Hider: HIDE+SEEK, Seeker: SEEK saja (spesifikasi).</summary>
        public bool CanUseSkills(GameRole role)
        {
            if (role == GameRole.Hider) return State == GameState.HidePhase || State == GameState.SeekPhase;
            if (role == GameRole.Seeker) return State == GameState.SeekPhase;
            return false;
        }

        /// <summary>
        /// Apakah pemain dengan role ini boleh bergerak pada <paramref name="state"/>?
        /// Aturan: COUNTDOWN & RESULT = semua dikunci. HIDE_PHASE = hanya HIDER yang boleh
        /// bergerak (Seeker masih "tidur"), SEEK_PHASE = semua bebas.
        /// </summary>
        public bool CanMove(GameState state, GameRole role)
        {
            if (state == GameState.SeekPhase) return true;
            if (state == GameState.HidePhase) return role != GameRole.Seeker;
            return false;
        }

        /// <summary>Versi tanpa role: true bila fase sedang aktif (dipakai UI/telemetri).</summary>
        public bool CanMove(GameState state)
        {
            return state == GameState.HidePhase || state == GameState.SeekPhase;
        }

        /// <summary>Role untuk actor tertentu (dipakai PlayerController/Combat/UI).</summary>
        public GameRole GetRole(int actorNumber)
        {
            GameRole r;
            if (roleByActor.TryGetValue(actorNumber, out r)) return r;

            // fallback: baca custom property player (berguna setelah scene reload)
            Player p = GetPlayer(actorNumber);
            if (p != null)
            {
                r = (GameRole)HideSeekConstants.GetProp(p.CustomProperties, HideSeekConstants.PropRole, (byte)GameRole.None);
                if (r != GameRole.None) roleByActor[actorNumber] = r;
                return r;
            }
            return GameRole.None;
        }

        /// <summary>Seeker aktif (untuk SpectatorController ikut kamera).</summary>
        public PlayerController Seeker
        {
            get
            {
                foreach (KeyValuePair<int, GameRole> kv in roleByActor)
                {
                    if (kv.Value != GameRole.Seeker) continue;
                    PlayerController pc = PlayerRegistry.Get(kv.Key);
                    if (pc != null) return pc;
                }
                return null;
            }
        }

        private static Player GetPlayer(int actorNumber)
        {
            if (PhotonNetwork.CurrentRoom == null) return null;
            Player p;
            return PhotonNetwork.CurrentRoom.Players.TryGetValue(actorNumber, out p) ? p : null;
        }

        private static bool IsHost
        {
            get
            {
                var nm = NetworkManager.Instance;
                return nm != null ? nm.IsAuthority : PhotonNetwork.IsMasterClient;
            }
        }

        // ========================= STATE TRANSITIONS ============================

        /// <summary>Host: masuk ke state baru + broadcast (PunRPC, fallback RaiseEvent) + tulis room props.</summary>
        private void EnterState(GameState next, float durationSeconds)
        {
            if (!IsHost) return;

            byte winner = (byte)LastWinner;
            switch (next)
            {
                case GameState.Countdown: winner = (byte)WinnerType.None; break;
                case GameState.HidePhase:  winner = (byte)WinnerType.None; break;
                case GameState.SeekPhase:  winner = (byte)WinnerType.None; break;   // jangan bawa winner ronde lalu
            }
            if (next == GameState.Countdown) LivingHiderCount = CountAssignedHiders();

            ApplyState((byte)next, durationSeconds, Round, winner, LastHiderActor);
            // (hook per-state & broadcast OnPhaseChanged sudah terjadi di dalam ApplyState)

            // 1) Simpan ke room properties -> late joiner & reconnection tetap sinkron.
            var props = new Hashtable
            {
                { HideSeekConstants.PropState, (byte)next },
                { HideSeekConstants.PropStateRemain, durationSeconds },
                { HideSeekConstants.PropRound, Round },
                { HideSeekConstants.PropWinner, winner },
                { HideSeekConstants.PropWinnerActor, LastHiderActor },
                { HideSeekConstants.PropIsLive, next != GameState.Lobby && next != GameState.Result }
            };
            if (PhotonNetwork.CurrentRoom != null) PhotonNetwork.CurrentRoom.SetCustomProperties(props);

            // 2) Broadcast ke semua klien (ApplyState di Host sudah dieksekusi -> idempotent).
            BroadcastState((byte)next, durationSeconds, Round, winner, LastHiderActor);
        }

        /// <summary>Tombol/kondisi berikutnya pada state machine.</summary>
        private void AdvanceState()
        {
            switch (State)
            {
                case GameState.Countdown:
                    EnterState(GameState.HidePhase, hidePhaseSeconds);
                    break;
                case GameState.HidePhase:
                    EnterState(GameState.SeekPhase, seekPhaseSeconds);
                    break;
                case GameState.SeekPhase:
                    // Waktu habis & masih ada hider hidup -> Hider menang (pemenang = hider terakhir).
                    if (LivingHiderCount > 0) EndRound(WinnerType.Hiders, LastHiderActor, LastHiderName);
                    else EndRound(WinnerType.Seeker, 0, null);
                    break;
                case GameState.Result:
                    if (autoNextRoundSeconds > 0f) { EnterState(GameState.Countdown, countdownSeconds); }
                    else { EnterState(GameState.Lobby, 0f); readySince = Time.time; }
                    break;
                default:
                    break;
            }
        }

        /// <summary>Host: akhiri ronde, tentukan pemenang, lalu masuk RESULT.</summary>
        private void EndRound(WinnerType winner, int lastHiderActor, string lastHiderName)
        {
            if (!IsHost) return;
            LastWinner = winner;
            LastHiderActor = lastHiderActor;
            LastHiderName = lastHiderName;
            EnterState(GameState.Result, resultSeconds);
        }

        /// <summary>
        /// Tombol "Start"/"Next Round" di UI. Bila kita bukan Host, kirim event EvtRequestStart
        /// ke MasterClient (Host) yang akan mengeksekusi StartRound() di OnEvent.
        /// </summary>
        public void RequestNextRound()
        {
            if (IsHost)
            {
                if (State == GameState.Result || State == GameState.Lobby) StartRound();
                return;
            }
            Net.RaiseMaster(EvtRequestStart, new Hashtable { { "req", PhotonNetwork.LocalPlayer != null ? PhotonNetwork.LocalPlayer.ActorNumber : 0 } }, true);
        }

        /// <summary>Event code: permintaan "mulai ronde" dari klien ke Host (di luar rentang 200..210 milik state/skill).</summary>
        public const byte EvtRequestStart = 212;

        private void TryAutoStart()
        {
            if (readySince < 0f || State != GameState.Lobby) return;
            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            if (count < minPlayersToStart) { readySince = Time.time; return; }
            if (Time.time - readySince >= autoStartAfterSeconds) StartRound();
        }

        // ====================== SYNC / APPLY (SEMUA KLIEN) =====================

        /// <summary>
        /// Broadcast transisi state. Prioritas: [PunRPC] pada PhotonView milik HOST
        /// (view pemain host dijamin owned -> legal), fallback: RaiseEvent RELIABLE.
        /// </summary>
        private void BroadcastState(byte state, float duration, int round, byte winner, int winnerActor)
        {
            var content = new Hashtable
            {
                { "s", state }, { "d", duration }, { "r", round }, { "w", winner }, { "a", winnerActor }
            };
            // Room property sudah menyimpan versi stabil; untuk realtime kita coba RPC dulu.
            if (TrySendStateRpc(content, state, duration, round, winner, winnerActor)) return;
            Net.RaiseAll(HideSeekConstants.EvtStateChange, content, true);
        }

        /// <summary>Kirim lewat PunRPC di view pemain Host. Return false bila view belum ada.</summary>
        private bool TrySendStateRpc(Hashtable content, byte state, float duration, int round, byte winner, int winnerActor)
        {
            if (PhotonNetwork.LocalPlayer == null) return false;
            PlayerController hostPlayer = PlayerRegistry.Get(PhotonNetwork.LocalPlayer.ActorNumber);
            if (hostPlayer == null || !hostPlayer.IsOwnerOfView) return false;
            hostPlayer.SendHostStateRpc(state, duration, round, winner, winnerActor);
            return true;
        }

        /// <summary>Host tick 4Hz: kirim sisa waktu (unreliable) agar jam klien presisi.</summary>
        private void RaiseStateTick()
        {
            var content = new Hashtable { { "s", (byte)State }, { "d", StateRemaining } };
            Net.RaiseAll(HideSeekConstants.EvtStateTick, content, false);
        }

        /// <summary>
        /// Terima event jaringan (state tick, state change, role assign, toast, slow).
        /// Satu tempat untuk semua event non-player agar mudah di-debug.
        /// </summary>
        public void OnEvent(EventData photonEvent)
        {
            var p = photonEvent.CustomData as Hashtable;
            switch (photonEvent.Code)
            {
                case HideSeekConstants.EvtStateTick:
                    if (p == null || IsHost) break;
                    ApplyTick(p.GetOrDefault<byte>("s", (byte)GameState.Lobby), p.GetOrDefault<float>("d", 0f));
                    break;

                case HideSeekConstants.EvtStateChange:
                    if (p == null) break;
                    ApplyState(p.GetOrDefault<byte>("s", (byte)State),
                               p.GetOrDefault<float>("d", 0f),
                               p.GetOrDefault<int>("r", Round),
                               p.GetOrDefault<byte>("w", (byte)WinnerType.None),
                               p.GetOrDefault<int>("a", 0));
                    break;

                case HideSeekConstants.EvtAssignRole:
                    if (p == null) break;
                    HandleRoleAssigned(p.GetOrDefault<int>("a", 0), (GameRole)p.GetOrDefault<byte>("r", (byte)GameRole.None));
                    break;

                case HideSeekConstants.EvtToast:
                    if (p == null) break;
                    Notice(p.GetOrDefault<string>("m", ""));
                    break;

                case HideSeekConstants.EvtRewardRevive:
                    // Klien (hider yang sudah jadi hantu) minta bangkit setelah nonton rewarded ad.
                    // Hanya Host yang mengeksekusi, dan hanya untuk peminta sendiri -> anti "revive orang".
                    if (!IsHost || p == null) break;
                    GrantRevive(p.GetOrDefault<int>("a", 0), photonEvent.Sender);
                    break;

                case EvtRequestStart:
                    // Klien menekan "Start/Next Round": hanya Host yang mengeksekusi.
                    if (!IsHost) break;
                    if (State == GameState.Lobby) StartRound();
                    else if (State == GameState.Result) StartRound();
                    break;
            }
        }

        /// <summary>
        /// Aplikasi state (IDEMPOTEN - boleh dipanggil 2x oleh RPC & event).
        /// Dipanggil dari PlayerController.RpcHostState (PunRPC) dan dari OnEvent (fallback).
        /// </summary>
        public void ApplyState(byte state, float duration, int round, byte winner, int winnerActor)
        {
            GameState next = (GameState)state;
            bool changed = (next != State) || (round != Round);

            State = next;
            Round = round;
            LastWinner = (WinnerType)winner;
            if (winnerActor != 0) LastHiderActor = winnerActor;

            stateEndTime = Time.time + Mathf.Max(0f, duration);
            lastWholeSecond = int.MaxValue;
            StateRemaining = Mathf.Max(0f, duration);

            // HANYA saat benar-benar berganti: panggil hook (reset pemain, notice, UI event).
            if (changed) OnStateEnteredLocal(next, StateRemaining);

            if (verboseLogs) Log("State -> " + next + " (" + duration.ToString("0.0") + "s) round=" + Round +
                                 (changed ? "" : " [duplicate/ignored]"));
        }

        /// <summary>Koreksi halus jam klien dari tick host (hindari jitter saat selisih kecil).</summary>
        private void ApplyTick(byte state, float remain)
        {
            GameState s = (GameState)state;
            if (s == State)
            {
                float diff = remain - StateRemaining;
                if (Mathf.Abs(diff) > 0.75f) stateEndTime = Time.time + remain;
                StateRemaining = Mathf.Max(0f, stateEndTime - Time.time);
            }
            else
            {
                // Kita ketinggalan transisi (mis. paket unreliable hilang saat state berganti):
                // minta ulang data lengkap dari room property.
                ApplyStateFromRoomProperties();
            }
            if (OnTimerTick != null) OnTimerTick(State, StateRemaining);
        }

        /// <summary>Baca state dari room properties (late join / reconnect / scene reload).</summary>
        public void ApplyStateFromRoomProperties()
        {
            Room r = PhotonNetwork.CurrentRoom;
            if (r == null) return;
            byte state = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropState, (byte)GameState.Lobby);
            float remain = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropStateRemain, 0f);
            int round = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropRound, 0);
            byte winner = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropWinner, (byte)WinnerType.None);
            ApplyState(state, remain, round, winner, 0);
        }

        // ============================== ROLES ==================================

        /// <summary>
        /// HOST: acak 1 Seeker, sisanya Hider. Hasil disimpan di `roleByActor` (host) dan
        /// disiarkan per-aktor lewat event RELIABLE; tiap klien menulis custom property
        /// miliknya sendiri (pola resmi PUN2, karena properti player hanya boleh ditulis ownernya).
        /// </summary>
        private void AssignRoles()
        {
            roleByActor.Clear();
            if (PhotonNetwork.CurrentRoom == null) return;

            var actors = new List<int>(PhotonNetwork.CurrentRoom.Players.Keys);
            actors.Sort();                                        // urut agar sama di semua klien

            // Shuffle deterministik: seed dari host + round (semua klien bisa recompute kalau perlu).
            int seed = unchecked(PhotonNetwork.LocalPlayer.ActorNumber * 39916801 + Round * 7919);
            Shuffle(actors, new System.Random(seed));

            // Minimal 2 pemain: 1 seeker. Kalau cuma 1 orang (testing) -> dia jadi Hider agar bisa latihan skill.
            GameRole firstRole = actors.Count >= 2 ? GameRole.Seeker : GameRole.Hider;

            for (int i = 0; i < actors.Count; i++)
            {
                GameRole role = (i == 0) ? firstRole : GameRole.Hider;
                roleByActor[actors[i]] = role;

                var content = new Hashtable { { "a", actors[i] }, { "r", (byte)role } };
                Net.RaiseAll(HideSeekConstants.EvtAssignRole, content, true);
            }

            // Host juga langsung memproses event untuk dirinya sendiri.
            for (int i = 0; i < actors.Count; i++)
                HandleRoleAssigned(actors[i], (i == 0) ? firstRole : GameRole.Hider);

            if (OnRolesAssigned != null) OnRolesAssigned();
            LivingHiderCount = CountAssignedHiders();
            Log("Roles assigned: " + roleByActor.Count + " pemain, hider=" + LivingHiderCount);
        }

        /// <summary>Refresh cache role dari custom property semua pemain (dipakai setelah reload scene).</summary>
        public void RefreshRolesFromRoom()
        {
            if (PhotonNetwork.CurrentRoom == null) return;
            foreach (KeyValuePair<int, Player> kv in PhotonNetwork.CurrentRoom.Players)
            {
                GameRole r = (GameRole)HideSeekConstants.GetProp(kv.Value.CustomProperties,
                                                                HideSeekConstants.PropRole, (byte)GameRole.None);
                if (r != GameRole.None) roleByActor[kv.Key] = r;
            }
            if (OnRolesAssigned != null) OnRolesAssigned();
        }

        /// <summary>Dipanggil saat menerima event role (termasuk untuk diri sendiri).</summary>
        private void HandleRoleAssigned(int actorNumber, GameRole role)
        {
            if (actorNumber <= 0) return;
            roleByActor[actorNumber] = role;

            PlayerController pc = PlayerRegistry.Get(actorNumber);
            if (pc != null) pc.SetRole(role);

            bool me = PhotonNetwork.LocalPlayer != null && PhotonNetwork.LocalPlayer.ActorNumber == actorNumber;
            if (!me) return;

            LocalRole = role;
            if (OnLocalRoleAssigned != null) OnLocalRoleAssigned(role);

            // Tulis custom property player (HANYA owner yang boleh) -> sync ke semua klien & late joiner.
            if (PhotonNetwork.LocalPlayer != null)
            {
                PhotonNetwork.LocalPlayer.SetCustomProperties(new Hashtable
                {
                    { HideSeekConstants.PropRole, (byte)role },
                    { HideSeekConstants.PropAlive, true },
                    { HideSeekConstants.PropHp, role == GameRole.Hider ? HideSeekConstants.HiderMaxHp : 0 },
                    { HideSeekConstants.PropCatches, 0 },
                    { HideSeekConstants.PropSurviveMs, 0 }
                });
            }
        }

        private int CountAssignedHiders()
        {
            int n = 0;
            foreach (KeyValuePair<int, GameRole> kv in roleByActor)
                if (kv.Value == GameRole.Hider) n++;
            return n;
        }

        /// <summary>Fisher-Yates shuffle dengan Random ber-seed (deterministik antar klien).</summary>
        private static void Shuffle<T>(IList<T> list, System.Random rng)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                T tmp = list[i]; list[i] = list[j]; list[j] = tmp;
            }
        }

        // ============================= ROUND RESET =============================

        /// <summary>
        /// Reset pemain dipicu OTOMATIS oleh setiap klien saat state COUNTDOWN masuk
        /// (lihat OnStateEnteredLocal) -> tidak perlu event/RPC tambahan.
        /// Semua klien mereset objek pemain yang ada di scene lokal mereka.
        /// </summary>
        public void ResetLocalScenePlayers()
        {
            // Reset PlayerController/Combat/HiderSkill/SeekerSkill tiap objek yang terdaftar.
            foreach (PlayerController pc in FindObjectsOfType<PlayerController>())
            {
                if (pc == null) continue;
                pc.ResetForRound();
            }
            PlayerRegistry.RefreshLivingHiders();
            LivingHiderCount = PlayerRegistry.LivingHiderCount;
        }

        /// <summary>
        /// Waktu (Time.time) saat ronde (COUNTDOWN) dimulai. Tiap Hider menghitung
        /// surviveMs = (waktu mati / akhir ronde) - RoundStartTime, lalu menulisnya ke
        /// custom property miliknya sendiri (dipakai BuildLeaderboard).
        /// </summary>
        public float RoundStartTime { get; private set; }

        // ============================ PER-STATE HOOK ============================

        /// <summary>Dipanggil setiap KLIEN saat state benar-benar berganti (bukan koreksi timer).</summary>
        private void OnStateEnteredLocal(GameState state, float duration)
        {
            switch (state)
            {
                case GameState.Countdown:
                    RoundStartTime = Time.time;
                    ResetLocalScenePlayers();
                    break;
                case GameState.HidePhase:
                    Notice(LocalRole == GameRole.Hider ? "Sembunyi! Seeker akan bangun sebentar lagi." : "Jaga titik-titik strategis...");
                    break;
                case GameState.SeekPhase:
                    PlayerRegistry.RefreshLivingHiders();
                    LivingHiderCount = PlayerRegistry.LivingHiderCount;
                    Notice("KEJAR! Sisa waktu " + Mathf.CeilToInt(duration) + " detik.");
                    break;
                case GameState.Result:
                    break;
                case GameState.Lobby:
                    break;
            }
            if (state == GameState.Result)
            {
                PlayerRegistry.RefreshLivingHiders();
                LivingHiderCount = PlayerRegistry.LivingHiderCount;
                if (OnRoundFinished != null) OnRoundFinished();
            }
            if (OnPhaseChanged != null) OnPhaseChanged(state, duration);
        }

        // ============================== LEADERBOARD ============================

        /// <summary>Entri leaderboard yang dibaca UIManager.</summary>
        public struct LeaderboardEntry
        {
            public string name;
            public GameRole role;
            public bool alive;
            public int hp;
            public int catches;
            public int surviveMs;
            public int score;
        }

        /// <summary>Bangun daftar skor (hider: HP & survival, seeker: tangkapan). Diurutkan desc by score.</summary>
        public List<LeaderboardEntry> BuildLeaderboard()
        {
            var list = new List<LeaderboardEntry>(12);
            if (PhotonNetwork.CurrentRoom == null) return list;

            foreach (KeyValuePair<int, Player> kv in PhotonNetwork.CurrentRoom.Players)
            {
                Player pl = kv.Value;
                Hashtable props = pl.CustomProperties;
                var e = new LeaderboardEntry
                {
                    name = pl.NickName,
                    role = GetRole(kv.Key),
                    alive = HideSeekConstants.GetProp(props, HideSeekConstants.PropAlive, true),
                    hp = HideSeekConstants.GetProp(props, HideSeekConstants.PropHp, 0),
                    catches = HideSeekConstants.GetProp(props, HideSeekConstants.PropCatches, 0),
                    surviveMs = HideSeekConstants.GetProp(props, HideSeekConstants.PropSurviveMs, 0)
                };
                // Skor: hider = surviveMs/1000 + hp*10 ; seeker = catches*30
                e.score = e.role == GameRole.Seeker ? e.catches * 30 : (e.surviveMs / 1000) + e.hp * 10;
                list.Add(e);
            }

            list.Sort(delegate (LeaderboardEntry a, LeaderboardEntry b)
            {
                int c = b.score.CompareTo(a.score);
                if (c != 0) return c;
                return string.Compare(a.name, b.name, StringComparison.OrdinalIgnoreCase);
            });
            return list;
        }

        // ================================ MISC =================================

        /// <summary>Tampilkan pesan singkat ke semua klien (lewat event RELIABLE).</summary>
        public void Announce(string message)
        {
            if (message == null) return;
            Net.RaiseAll(HideSeekConstants.EvtToast, new Hashtable { { "m", message } }, true);
            Notice(message);
        }

        private void Notice(string msg)
        {
            if (OnNotice != null) OnNotice(msg);
            if (verboseLogs) Log(msg);
        }

        private void Log(string msg) { if (verboseLogs) Debug.Log("[HideSeek/Game] " + msg, this); }

        /// <summary>Debug GUI/Inspector: paksa pindah ke state berikutnya (hanya Host).</summary>
        [ContextMenu("DEV: advance state")]
        public void DevAdvance() { if (IsHost) AdvanceState(); }

        /// <summary>Debug: mulai ronde sekarang (hanya Host).</summary>
        [ContextMenu("DEV: start round")]
        public void DevStart() { if (IsHost) StartRound(); }
    }

    /// <summary>Perluasan aman untuk membaca hashtable Photon dengan default.</summary>
    public static class HashtableExt
    {
        public static T GetOrDefault<T>(this Hashtable h, string key, T fallback)
        {
            if (h == null || !h.ContainsKey(key)) return fallback;
            object o = h[key];
            if (o is T) return (T)o;
            if (o == null) return fallback;
            try
            {
                if (typeof(T).IsEnum) return (T)Enum.Parse(typeof(T), o.ToString());
                return (T)Convert.ChangeType(o, typeof(T));
            }
            catch { return fallback; }
        }
    }
}
